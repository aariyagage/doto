// POST /api/brainstorm/[id]/promote
//
// Convert a brainstorm note into a draft concept by running PASS 1 only
// (concept-generator with the note as a seed). Single Groq call + 1 HF
// embed. Returns the new concept's id. The note's status flips to
// 'converted' and converted_concept_id is set.
//
// Body (optional): {pillar_id} — if the note's pillar_id is null, the
// caller must supply one.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { flagFor } from '@/lib/env';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import {
    promoteBrainstormToDraftConcept,
    openPipelineRun,
    closePipelineRun,
    recordConceptEvent,
    type PipelineErrorKind,
} from '@/lib/concepts';

export const dynamic = 'force-dynamic';

interface Body {
    pillar_id?: string | null;
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
    try {
        const supabase = createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        if (!flagFor(user.id, 'brainstormInbox')) {
            return NextResponse.json({ error: 'feature_disabled', feature: 'BRAINSTORM_INBOX' }, { status: 503 });
        }

        const rl = rateLimit({ key: `brainstorm.promote:${user.id}`, ...RATE_LIMITS.llmGeneration });
        if (!rl.ok) {
            return NextResponse.json(
                { error: 'rate_limit', retry_after_seconds: rl.retryAfterSeconds },
                { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
            );
        }

        let body: Body = {};
        try {
            body = await request.json();
        } catch {
            // empty body is allowed; pillar_id can come from the note
        }

        const runHandle = await openPipelineRun({
            supabase,
            userId: user.id,
            kind: 'generate',
            metadata: { from_brainstorm: params.id },
        });

        try {
            const result = await promoteBrainstormToDraftConcept({
                supabase,
                userId: user.id,
                noteId: params.id,
                pillarIdOverride: body.pillar_id ?? undefined,
            });

            if (runHandle) {
                runHandle.groqCalls = result.groqCalls;
                runHandle.hfCalls = result.hfCalls;
            }

            // concept_events 'created' for the new concept.
            await recordConceptEvent({
                supabase,
                userId: user.id,
                conceptId: result.conceptId,
                eventType: 'created',
                toStatus: 'draft',
                metadata: { source_kind: 'brainstorm', source_brainstorm_id: result.note.id },
            });

            // Tie the run to the concept (FK via pipeline_run_id).
            await supabase
                .from('concepts')
                .update({ pipeline_run_id: runHandle?.id ?? null })
                .eq('user_id', user.id)
                .eq('id', result.conceptId);

            if (runHandle) {
                await closePipelineRun({
                    supabase, handle: runHandle, status: 'succeeded',
                    metadata: { concept_id: result.conceptId },
                });
            }

            return NextResponse.json({ concept_id: result.conceptId });
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (runHandle) {
                await closePipelineRun({
                    supabase, handle: runHandle, status: 'failed',
                    errorKind: classifyError(msg),
                    metadata: { message: msg },
                });
            }
            throw err;
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('POST /brainstorm/[id]/promote:', err);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}

function classifyError(msg: string): PipelineErrorKind {
    if (msg.includes('rate') && msg.includes('limit')) return 'rate_limit';
    if (msg.includes('timeout')) return 'timeout';
    if (msg.includes('JSON')) return 'parse_error';
    if (msg.includes('No pillar') || msg.includes('not found')) return 'validation';
    return 'unknown';
}
