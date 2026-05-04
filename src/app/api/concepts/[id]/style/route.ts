// POST /api/concepts/[id]/style
//
// Lazy stylist endpoint. The /api/concepts/generate route only eager-styles
// top-3 concepts to keep Groq cost flat. Tail concepts get null
// voice_adapted_* fields and trigger PASS 3 here on first card open.
//
// Cost: 1 Groq call. No HF calls (no re-embed).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { flagFor } from '@/lib/env';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import {
    runStylist,
    recordConceptEvent,
    openPipelineRun,
    closePipelineRun,
} from '@/lib/concepts';
import type { StylistVoiceProfile } from '@/lib/concepts/prompts/stylist-prompt';

export const dynamic = 'force-dynamic';

export async function POST(_request: Request, { params }: { params: { id: string } }) {
    try {
        const supabase = createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        if (!flagFor(user.id, 'conceptPipeline')) {
            return NextResponse.json({ error: 'feature_disabled', feature: 'CONCEPT_PIPELINE' }, { status: 503 });
        }

        const rl = rateLimit({
            key: `concepts.style:${user.id}`,
            ...RATE_LIMITS.llmGeneration,
        });
        if (!rl.ok) {
            return NextResponse.json(
                { error: 'rate_limit', retry_after_seconds: rl.retryAfterSeconds },
                { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
            );
        }

        const { data: concept, error: fetchErr } = await supabase
            .from('concepts')
            .select('id, user_id, title, hook, angle, structure, voice_adapted_text')
            .eq('user_id', user.id)
            .eq('id', params.id)
            .single();

        if (fetchErr || !concept) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const row = concept as {
            id: string;
            title: string;
            hook: string | null;
            angle: string | null;
            structure: unknown | null;
            voice_adapted_text: string | null;
        };

        // Idempotent: if already styled, return current values without
        // burning another Groq call.
        if (row.voice_adapted_text) {
            return NextResponse.json({
                voice_adapted_title: (concept as { voice_adapted_title?: string }).voice_adapted_title ?? null,
                voice_adapted_hook:  (concept as { voice_adapted_hook?: string }).voice_adapted_hook ?? null,
                voice_adapted_text:  row.voice_adapted_text,
                already_styled: true,
            });
        }

        const { data: vpData } = await supabase
            .from('voice_profile')
            .select('*')
            .eq('user_id', user.id)
            .single();

        if (!vpData) {
            // No voice profile yet (creator hasn't uploaded enough videos).
            // Soft-fail: return the original title/hook so the UI can
            // display unstyled output without erroring.
            return NextResponse.json({
                voice_adapted_title: row.title,
                voice_adapted_hook:  row.hook,
                voice_adapted_text:  row.title,
                no_voice_profile: true,
            });
        }

        const runHandle = await openPipelineRun({
            supabase,
            userId: user.id,
            kind: 'style',
            metadata: { concept_id: row.id },
        });

        let groqCalls = 0;
        try {
            const r = await runStylist({
                concept: {
                    title: row.title,
                    hook: row.hook ?? '',
                    angle: row.angle ?? '',
                    structure: row.structure,
                },
                voiceProfile: vpData as StylistVoiceProfile,
            });
            groqCalls = r.groqCalls;

            const update = {
                voice_adapted_title: r.output.voice_adapted_title,
                voice_adapted_hook:  r.output.voice_adapted_hook,
                voice_adapted_text:  r.output.voice_adapted_text,
                updated_at: new Date().toISOString(),
            };

            const { error: updateErr } = await supabase
                .from('concepts')
                .update(update)
                .eq('user_id', user.id)
                .eq('id', row.id);

            if (updateErr) {
                console.error('lazy stylist update failed:', JSON.stringify(updateErr));
                if (runHandle) {
                    runHandle.groqCalls = groqCalls;
                    await closePipelineRun({ supabase, handle: runHandle, status: 'failed', errorKind: 'unknown' });
                }
                return NextResponse.json({ error: updateErr.message }, { status: 500 });
            }

            await recordConceptEvent({
                supabase, userId: user.id, conceptId: row.id, eventType: 'styled',
            });

            if (runHandle) {
                runHandle.groqCalls = groqCalls;
                await closePipelineRun({ supabase, handle: runHandle, status: 'succeeded' });
            }

            return NextResponse.json(r.output);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (runHandle) {
                runHandle.groqCalls = groqCalls;
                await closePipelineRun({
                    supabase, handle: runHandle, status: 'failed',
                    errorKind: 'unknown',
                    metadata: { message: msg },
                });
            }
            throw err;
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('POST /concepts/[id]/style Error:', err);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
