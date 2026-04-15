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
    // Video processing is expensive — allow only a handful per 10 minutes.
    videoProcess: { limit: 5, windowMs: 10 * 60 * 1000 },
    // Idea / pillar generation: bursty is fine, cap at 10/minute.
    llmGeneration: { limit: 10, windowMs: 60 * 1000 },
};
