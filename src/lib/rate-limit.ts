/**
 * In-memory sliding-window rate limiter keyed by identifier (user_id).
 *
 * This is intentionally simple and only suitable for a single-process deployment
 * (one Node server). On Vercel/Lambda where each cold start resets the map, it
 * will still protect against sustained abuse within a single instance but will
 * not be globally consistent. For multi-instance deployments, swap the store
 * implementation for Redis/Upstash without changing callers.
 */

type Window = { count: number; resetAt: number };

const store = new Map<string, Window>();

export type RateLimitResult =
    | { ok: true; remaining: number; resetAt: number }
    | { ok: false; retryAfterSeconds: number; resetAt: number };

export function rateLimit(opts: {
    key: string;
    limit: number;
    windowMs: number;
}): RateLimitResult {
    const now = Date.now();
    const entry = store.get(opts.key);

    if (!entry || entry.resetAt <= now) {
        const resetAt = now + opts.windowMs;
        store.set(opts.key, { count: 1, resetAt });
        return { ok: true, remaining: opts.limit - 1, resetAt };
    }

    if (entry.count >= opts.limit) {
        return {
            ok: false,
            retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000),
            resetAt: entry.resetAt,
        };
    }

    entry.count += 1;
    return { ok: true, remaining: opts.limit - entry.count, resetAt: entry.resetAt };
}

export const RATE_LIMITS = {
    // Video processing. The original 5/10min was too tight for batch testing
    // (a creator dropping 8-10 videos in a sitting). 12/10min still leaves
    // plenty of headroom under Groq free-tier limits (30 RPM, 12K TPM) since
    // the queue worker processes uploads sequentially anyway — this just
    // controls how many can sit in the queue at once.
    videoProcess: { limit: 12, windowMs: 10 * 60 * 1000 },
    // Idea / pillar generation: bursty is fine, cap at 10/minute.
    llmGeneration: { limit: 10, windowMs: 60 * 1000 },
};

// ---- DB-backed per-user Groq quota -----------------------------------------
// The in-memory rateLimit() above is per-process. On Vercel each cold start
// resets it, so a determined user could exceed limits across cold starts.
// More importantly, the in-memory limiter only sees one endpoint at a time —
// it doesn't know that the same user just spent 4 Groq calls on
// /concepts/generate two seconds ago when they hit /research now.
//
// This sliding-window limiter queries pipeline_runs for the actual sum of
// groq_calls in the last 60 seconds across ALL endpoints for the user, then
// adds the projected calls for this request. If the projected total exceeds
// PER_USER_GROQ_PER_MINUTE_CAP (default 25, with 5-call safety margin under
// Groq free-tier 30 RPM), it returns 429 with retry-after.
//
// Cost: one cheap COUNT-style query per gated request. Acceptable for
// the few endpoints that initiate Groq calls.

import type { SupabaseServer } from '@/lib/pillars/types';

// Safety margin under Groq free-tier 30 RPM. 5-call cushion absorbs
// any in-flight runs the COUNT query missed.
const PER_USER_GROQ_PER_MINUTE_CAP = 25;
const GROQ_WINDOW_SECONDS = 60;

export type GroqQuotaResult =
    | { ok: true; remaining: number; usedInWindow: number }
    | { ok: false; retryAfterSeconds: number; usedInWindow: number };

export async function checkPerUserGroqQuota(
    supabase: SupabaseServer,
    userId: string,
    projectedCalls: number,
): Promise<GroqQuotaResult> {
    if (projectedCalls <= 0) {
        return { ok: true, remaining: PER_USER_GROQ_PER_MINUTE_CAP, usedInWindow: 0 };
    }

    // Query the user's pipeline_runs for the last 60 seconds. We sum
    // groq_calls (already-finished runs) AND count "running" rows times
    // a typical-call estimate so we don't undercount in-flight work.
    // The column we actually need: pipeline_runs.groq_calls (int) plus
    // status='running' rows that haven't yet been closed.
    const sinceIso = new Date(Date.now() - GROQ_WINDOW_SECONDS * 1000).toISOString();

    const { data, error } = await supabase
        .from('pipeline_runs')
        .select('groq_calls, status, kind')
        .eq('user_id', userId)
        .gt('created_at', sinceIso);

    if (error) {
        // Fail OPEN -- if the limiter query itself fails, don't block the
        // user. The in-memory rateLimit() above still provides a backstop.
        console.warn('checkPerUserGroqQuota: pipeline_runs query failed, allowing through:', error.message);
        return { ok: true, remaining: PER_USER_GROQ_PER_MINUTE_CAP, usedInWindow: 0 };
    }

    let used = 0;
    for (const row of (data ?? []) as Array<{ groq_calls: number; status: string; kind: string }>) {
        if (row.status === 'running') {
            // Closed rows have accurate groq_calls. Running rows haven't
            // settled yet; estimate worst-case by kind so we don't
            // undercount concurrent generations.
            used += estimateGroqCallsForKind(row.kind);
        } else {
            used += row.groq_calls ?? 0;
        }
    }

    const projectedTotal = used + projectedCalls;
    if (projectedTotal > PER_USER_GROQ_PER_MINUTE_CAP) {
        return {
            ok: false,
            retryAfterSeconds: GROQ_WINDOW_SECONDS, // worst case; caller can show as "try again in <60s"
            usedInWindow: used,
        };
    }

    return {
        ok: true,
        remaining: PER_USER_GROQ_PER_MINUTE_CAP - projectedTotal,
        usedInWindow: used,
    };
}

// Worst-case Groq call count per pipeline kind, used to estimate the
// budget consumed by in-flight runs (status='running'). Match these to
// the actual call counts in src/lib/concepts/* helpers.
function estimateGroqCallsForKind(kind: string): number {
    switch (kind) {
        case 'generate':       return 4; // PASS 1 + PASS 2 + PASS 3 (top-K) + research
        case 'topup':          return 2; // PASS 1 + PASS 2
        case 'style':          return 1;
        case 'expand':         return 1;
        case 'research':       return 1;
        case 'refine':         return 1;
        case 'cluster':        return 0; // no model call
        case 'import_legacy':  return 0;
        default:               return 1;
    }
}

// Convenience helper for routes that want to count an explicit kind:
//   const projected = projectedGroqCallsForKind('generate'); // 4
export function projectedGroqCallsForKind(kind: string): number {
    return estimateGroqCallsForKind(kind);
}
