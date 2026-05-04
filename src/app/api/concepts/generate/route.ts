// POST /api/concepts/generate
//
// The marquee endpoint. Runs the 3-pass pipeline:
//   PASS 1: concept-generator   (1 Groq + N HF)
//   PASS 2: validator + dedup   (1 Groq)
//   PASS 3: stylist top-K eager (1 Groq, K=3)
//
// Total: 3 Groq + N HF calls regardless of N candidates. Tail concepts
// are lazy-styled by /api/concepts/[id]/style on first card open.
//
// Inserts N concepts with status=draft + writes concept_events 'created'
// per concept + opens/closes a pipeline_runs row for observability.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { flagFor } from '@/lib/env';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import {
    runConceptGenerator,
    runValidator,
    runStylistBatch,
    openPipelineRun,
    closePipelineRun,
    recordConceptEventsBulk,
    type ConceptSeed,
    type ConceptSourceKind,
    type PipelineErrorKind,
    type PipelineRunHandle,
} from '@/lib/concepts';
import type { StylistVoiceProfile } from '@/lib/concepts/prompts/stylist-prompt';

export const dynamic = 'force-dynamic';

const DEFAULT_COUNT = 5;
const MAX_COUNT = 8;
const STYLIST_TOP_K = 3;

interface GenerateBody {
    pillar_id: string;
    count?: number;
    seed?: {
        kind: 'brainstorm' | 'transcript' | 'trend';
        ref_id: string;
    };
}

export async function POST(request: Request) {
    let runHandle: PipelineRunHandle | null = null;
    let supabase: ReturnType<typeof createClient> | null = null;

    try {
        supabase = createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (!flagFor(user.id, 'conceptPipeline')) {
            return NextResponse.json(
                { error: 'feature_disabled', feature: 'CONCEPT_PIPELINE' },
                { status: 503 },
            );
        }

        // Per-user rate limit. The full M8 sliding-window-by-Groq-calls
        // limiter is deferred; for now reuse the existing llmGeneration
        // bucket so a single user can't burst beyond 10 generations/min.
        const rl = rateLimit({
            key: `concepts.generate:${user.id}`,
            ...RATE_LIMITS.llmGeneration,
        });
        if (!rl.ok) {
            return NextResponse.json(
                { error: 'rate_limit', retry_after_seconds: rl.retryAfterSeconds },
                { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
            );
        }

        let body: GenerateBody;
        try {
            body = await request.json();
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }

        if (!body.pillar_id || typeof body.pillar_id !== 'string') {
            return NextResponse.json({ error: 'pillar_id required' }, { status: 400 });
        }
        const count = clamp(body.count ?? DEFAULT_COUNT, 1, MAX_COUNT);

        // Load pillar (must belong to this user — RLS enforces, but explicit
        // filter is the established pattern in this app).
        const { data: pillarRow, error: pillarErr } = await supabase
            .from('pillars')
            .select('id, name, description, subtopics, is_series')
            .eq('user_id', user.id)
            .eq('id', body.pillar_id)
            .single();

        if (pillarErr || !pillarRow) {
            return NextResponse.json({ error: 'pillar not found' }, { status: 404 });
        }

        // Load up to 3 most-recent essences for this pillar's videos.
        const recentEssences = await loadRecentEssencesForPillar(supabase, user.id, body.pillar_id);

        // Resolve seed (if any). We only fetch the minimum the prompt needs.
        const seed = await resolveSeed(supabase, user.id, body.seed ?? null);

        // Open observability run.
        runHandle = await openPipelineRun({
            supabase,
            userId: user.id,
            kind: 'generate',
            metadata: { pillar_id: body.pillar_id, count, seed_kind: seed?.kind ?? null },
        });

        // ---- PASS 1: concept generation ----
        const gen = await runConceptGenerator({
            pillar: {
                name: pillarRow.name,
                description: pillarRow.description ?? null,
                subtopics: pillarRow.subtopics ?? [],
                is_series: pillarRow.is_series ?? false,
            },
            recentEssences,
            seed,
            count,
        });
        if (runHandle) {
            runHandle.groqCalls += gen.groqCalls;
            runHandle.hfCalls += gen.hfCalls;
        }

        // ---- PASS 2: validator + dedup ----
        const validated = await runValidator({
            supabase,
            userId: user.id,
            pillar: { name: pillarRow.name, description: pillarRow.description ?? null },
            candidates: gen.candidates,
            candidateEmbeddings: gen.candidateEmbeddings,
        });
        if (runHandle) {
            runHandle.groqCalls += validated.groqCalls;
            runHandle.hfCalls += validated.hfCalls;
        }

        if (validated.accepted.length === 0) {
            if (runHandle) {
                await closePipelineRun({
                    supabase, handle: runHandle, status: 'failed',
                    errorKind: 'validation',
                    metadata: { reason: 'all candidates rejected', rejected_count: validated.rejected.length },
                });
            }
            return NextResponse.json(
                {
                    error: 'no_concepts_passed_validation',
                    message: 'All candidates were rejected by the validator. Try again or adjust the pillar definition.',
                    rejected_count: validated.rejected.length,
                },
                { status: 200 }, // soft-fail; UI shows empty state with the reason
            );
        }

        // ---- PASS 3: stylist top-K (eager) ----
        // Voice profile is read here for the FIRST and only time in this
        // request. Tail concepts get null voice_adapted_* and lazy-style
        // on first card open.
        const voiceProfile = await loadVoiceProfileForStylist(supabase, user.id);
        const topK = validated.accepted.slice(0, STYLIST_TOP_K);
        const tail = validated.accepted.slice(STYLIST_TOP_K);

        let styledMap = new Map<string, { voice_adapted_title: string; voice_adapted_hook: string; voice_adapted_text: string }>();
        if (voiceProfile && topK.length > 0) {
            const styled = await runStylistBatch(topK, voiceProfile);
            if (runHandle) runHandle.groqCalls += styled.groqCalls;
            styledMap = new Map(
                styled.styled.map(s => [
                    s.item.candidate.title,
                    {
                        voice_adapted_title: s.output.voice_adapted_title,
                        voice_adapted_hook:  s.output.voice_adapted_hook,
                        voice_adapted_text:  s.output.voice_adapted_text,
                    },
                ]),
            );
        }

        // ---- Insert N concepts ----
        const sourceKind: ConceptSourceKind = seed?.kind === 'brainstorm' ? 'brainstorm'
            : seed?.kind === 'transcript' ? 'transcript'
            : seed?.kind === 'trend' ? 'trend'
            : 'manual';

        const sourceFields = buildSourceFields(seed);

        const rowsToInsert = validated.accepted.map(({ candidate, embedding, score }) => {
            const styled = styledMap.get(candidate.title);
            return {
                user_id: user.id,
                pillar_id: body.pillar_id,
                title: candidate.title,
                hook: candidate.hook || null,
                angle: candidate.angle || null,
                structure: candidate.structure ?? null,
                ai_reason: candidate.ai_reason || null,
                score: score as unknown as Record<string, number>,
                voice_adapted_title: styled?.voice_adapted_title ?? null,
                voice_adapted_hook:  styled?.voice_adapted_hook ?? null,
                voice_adapted_text:  styled?.voice_adapted_text ?? null,
                status: 'draft' as const,
                source_kind: sourceKind,
                ...sourceFields,
                concept_embedding: embedding,
                pipeline_run_id: runHandle?.id ?? null,
            };
        });

        const { data: inserted, error: insertErr } = await supabase
            .from('concepts')
            .insert(rowsToInsert)
            .select();

        if (insertErr) {
            console.error('POST /concepts/generate insert failed:', JSON.stringify(insertErr));
            if (runHandle) {
                await closePipelineRun({
                    supabase, handle: runHandle, status: 'failed',
                    errorKind: 'unknown',
                    metadata: { reason: 'insert failed', message: insertErr.message },
                });
            }
            return NextResponse.json({ error: insertErr.message }, { status: 500 });
        }

        // ---- Write concept_events 'created' rows (one per inserted concept). ----
        await recordConceptEventsBulk(
            supabase,
            (inserted ?? []).map(row => {
                const r = row as { id: string };
                const candidate = rowsToInsert.find(rr => rr.title === (row as { title: string }).title);
                return {
                    userId: user.id,
                    conceptId: r.id,
                    eventType: 'created' as const,
                    toStatus: 'draft' as const,
                    metadata: candidate ? {
                        score: candidate.score,
                        styled: Boolean(candidate.voice_adapted_text),
                        source_kind: candidate.source_kind,
                    } : undefined,
                };
            }),
        );

        // Plus a 'styled' event per top-K concept that succeeded styling.
        if (styledMap.size > 0) {
            const styledRows: Parameters<typeof recordConceptEventsBulk>[1] = [];
            for (const row of inserted ?? []) {
                const r = row as { id: string; title: string; voice_adapted_text: string | null };
                if (r.voice_adapted_text) {
                    styledRows.push({
                        userId: user.id,
                        conceptId: r.id,
                        eventType: 'styled',
                    });
                }
            }
            if (styledRows.length > 0) await recordConceptEventsBulk(supabase, styledRows);
        }

        // Close the run.
        if (runHandle) {
            await closePipelineRun({
                supabase, handle: runHandle, status: 'succeeded',
                metadata: {
                    accepted: validated.accepted.length,
                    rejected: validated.rejected.length,
                    styled_top_k: styledMap.size,
                    tail_unstyled: tail.length,
                },
            });
        }

        return NextResponse.json({
            pipeline_run_id: runHandle?.id ?? null,
            concepts: inserted ?? [],
            rejected_count: validated.rejected.length,
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('POST /concepts/generate Error:', err);
        if (runHandle && supabase) {
            await closePipelineRun({
                supabase, handle: runHandle, status: 'failed',
                errorKind: classifyError(err),
                metadata: { message: msg },
            });
        }
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}

// ---- helpers --------------------------------------------------------------

function clamp(n: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, Math.floor(n)));
}

function classifyError(err: unknown): PipelineErrorKind {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('rate') && msg.includes('limit')) return 'rate_limit';
    if (msg.includes('timeout') || msg.includes('ETIMEDOUT')) return 'timeout';
    if (msg.includes('unparseable JSON') || msg.includes('JSON.parse')) return 'parse_error';
    if (msg.includes('validation')) return 'validation';
    return 'unknown';
}

async function loadRecentEssencesForPillar(
    supabase: ReturnType<typeof createClient>,
    userId: string,
    pillarId: string,
): Promise<{ topic: string | null; core_idea: string | null }[]> {
    // Get the videos tagged to this pillar, then grab the most recent
    // transcripts and pull (essence_topic, essence_core_idea). We
    // deliberately do NOT pull essence_hook here — hooks carry voice signal
    // we want PASS 1 to ignore.
    const { data: vp } = await supabase
        .from('video_pillars')
        .select('video_id')
        .eq('pillar_id', pillarId);

    const videoIds = (vp ?? []).map(r => (r as { video_id: string }).video_id);
    if (videoIds.length === 0) return [];

    const { data: transcripts } = await supabase
        .from('transcripts')
        .select('essence_topic, essence_core_idea, created_at')
        .eq('user_id', userId)
        .in('video_id', videoIds)
        .order('created_at', { ascending: false })
        .limit(3);

    return (transcripts ?? []).map(t => {
        const row = t as { essence_topic: string | null; essence_core_idea: string | null };
        return {
            topic: row.essence_topic,
            core_idea: row.essence_core_idea,
        };
    });
}

async function resolveSeed(
    supabase: ReturnType<typeof createClient>,
    userId: string,
    body: GenerateBody['seed'] | null,
): Promise<ConceptSeed> {
    if (!body) return null;

    if (body.kind === 'brainstorm') {
        const { data } = await supabase
            .from('brainstorm_notes')
            .select('id, raw_text')
            .eq('user_id', userId)
            .eq('id', body.ref_id)
            .single();
        if (!data) return null;
        const row = data as { id: string; raw_text: string };
        return { kind: 'brainstorm', ref_id: row.id, raw_text: row.raw_text };
    }

    if (body.kind === 'transcript') {
        const { data } = await supabase
            .from('transcripts')
            .select('id, essence')
            .eq('user_id', userId)
            .eq('id', body.ref_id)
            .single();
        if (!data) return null;
        const row = data as { id: string; essence: string | null };
        return { kind: 'transcript', ref_id: row.id, essence: row.essence ?? '' };
    }

    if (body.kind === 'trend') {
        // ref_id is "tiktok:<hashtag>" or "reddit:<post_id>"; we use it
        // verbatim as label for now. M6 research pass will enrich this.
        return { kind: 'trend', ref_id: body.ref_id, label: body.ref_id };
    }

    return null;
}

function buildSourceFields(seed: ConceptSeed): Record<string, string | null> {
    const fields: Record<string, string | null> = {
        source_brainstorm_id: null,
        source_transcript_id: null,
        source_trend_hashtag: null,
        source_trend_reddit_post: null,
    };
    if (!seed) return fields;
    if (seed.kind === 'brainstorm') fields.source_brainstorm_id = seed.ref_id;
    else if (seed.kind === 'transcript') fields.source_transcript_id = seed.ref_id;
    else if (seed.kind === 'trend') {
        // ref_id format: "tiktok:<hashtag>" or "reddit:<post_id>"
        if (seed.ref_id.startsWith('tiktok:')) fields.source_trend_hashtag = seed.ref_id.slice('tiktok:'.length);
        else if (seed.ref_id.startsWith('reddit:')) fields.source_trend_reddit_post = seed.ref_id.slice('reddit:'.length);
    }
    return fields;
}

async function loadVoiceProfileForStylist(
    supabase: ReturnType<typeof createClient>,
    userId: string,
): Promise<StylistVoiceProfile | null> {
    const { data } = await supabase
        .from('voice_profile')
        .select('*')
        .eq('user_id', userId)
        .single();
    if (!data) return null;
    return data as StylistVoiceProfile;
}
