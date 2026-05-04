// POST /api/brainstorm/[id]/expand
//
// 1 Groq call. Cleans up rough raw_text into 1-3 sharper sentences.
// Writes expanded_text back to the note. Idempotent for the most part —
// running it again will overwrite expanded_text with a fresh attempt.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { flagFor } from '@/lib/env';
import { rateLimit, RATE_LIMITS, checkPerUserGroqQuota, projectedGroqCallsForKind } from '@/lib/rate-limit';
import {
    expandBrainstormNote,
    openPipelineRun,
    closePipelineRun,
} from '@/lib/concepts';

export const dynamic = 'force-dynamic';

export async function POST(_request: Request, { params }: { params: { id: string } }) {
    try {
        const supabase = createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        if (!flagFor(user.id, 'brainstormInbox')) {
            return NextResponse.json({ error: 'feature_disabled', feature: 'BRAINSTORM_INBOX' }, { status: 503 });
        }

        const rl = rateLimit({ key: `brainstorm.expand:${user.id}`, ...RATE_LIMITS.llmGeneration });
        if (!rl.ok) {
            return NextResponse.json(
                { error: 'rate_limit', retry_after_seconds: rl.retryAfterSeconds },
                { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
            );
        }
        const quota = await checkPerUserGroqQuota(supabase, user.id, projectedGroqCallsForKind('expand'));
        if (!quota.ok) {
            return NextResponse.json(
                { error: 'rate_limit', retry_after_seconds: quota.retryAfterSeconds, used_in_window: quota.usedInWindow },
                { status: 429, headers: { 'Retry-After': String(quota.retryAfterSeconds) } },
            );
        }

        const { data: note, error: fetchErr } = await supabase
            .from('brainstorm_notes')
            .select('id, raw_text')
            .eq('user_id', user.id)
            .eq('id', params.id)
            .single();
        if (fetchErr || !note) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        const row = note as { id: string; raw_text: string };

        const runHandle = await openPipelineRun({
            supabase,
            userId: user.id,
            kind: 'expand',
            metadata: { note_id: row.id },
        });

        try {
            const r = await expandBrainstormNote(row.raw_text);
            if (runHandle) runHandle.groqCalls = r.groqCalls;

            const { error: updateErr } = await supabase
                .from('brainstorm_notes')
                .update({ expanded_text: r.expanded, updated_at: new Date().toISOString() })
                .eq('user_id', user.id)
                .eq('id', row.id);

            if (updateErr) {
                console.error('expand update failed:', JSON.stringify(updateErr));
                if (runHandle) await closePipelineRun({ supabase, handle: runHandle, status: 'failed', errorKind: 'unknown' });
                return NextResponse.json({ error: updateErr.message }, { status: 500 });
            }

            if (runHandle) await closePipelineRun({ supabase, handle: runHandle, status: 'succeeded' });
            return NextResponse.json({ expanded_text: r.expanded });
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (runHandle) {
                await closePipelineRun({
                    supabase, handle: runHandle, status: 'failed',
                    errorKind: msg.includes('JSON') ? 'parse_error' : 'unknown',
                    metadata: { message: msg },
                });
            }
            throw err;
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('POST /brainstorm/[id]/expand:', err);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
