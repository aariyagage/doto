// Concept top-up — analog of pillars/auto-ideas.ts but writes to the
// concepts table via the 3-pass pipeline (PASS 1 + PASS 2 only by
// default; PASS 3 styling stays lazy on first card open to keep the
// post-upload Groq cost low).
//
// Called in two places:
//   1. After a video is uploaded + tagged (/api/videos/process), when
//      NEXT_PUBLIC_CONCEPT_PIPELINE=true the upload flow calls this
//      instead of the legacy topUpIdeasForPillars.
//   2. From the public POST /api/pillars/[id]/concepts/topup route for
//      manual triggers from the workspace.
//
// Cost per pillar topped up: 2 Groq + ~2 HF (count=2). Pillars that
// already have >= TARGET_UNUSED_PER_PILLAR active concepts are skipped
// entirely.

import { runConceptGenerator } from './concept-generator';
import { runValidator } from './validator';
import { recordConceptEventsBulk } from './events';
import {
    openPipelineRun,
    closePipelineRun,
    type PipelineRunHandle,
} from './pipeline-run';
import type { SupabaseServer } from '@/lib/pillars/types';

// Auto-topup is intentionally lower than the manual generate count.
// The user gets fresh concepts after every upload without burning
// 5x the Groq budget per upload.
const TARGET_UNUSED_PER_PILLAR = 2;
const PER_PILLAR_COUNT = 2;

// Active = not yet acted on. Draft + reviewed both count as "unused"
// for the topup decision; saved/used/rejected/archived do not.
const ACTIVE_STATUSES = ['draft', 'reviewed'] as const;

export interface TopUpConceptsArgs {
    supabase: SupabaseServer;
    userId: string;
    pillarIds: string[]; // typically the pillars a just-uploaded video tagged to
}

export interface TopUpConceptsResult {
    generated: number;
    pillarsToppedUp: number;
    pillarIds: string[]; // which pillars actually got new concepts
}

export async function topUpConceptsForPillars(args: TopUpConceptsArgs): Promise<TopUpConceptsResult> {
    const { supabase, userId, pillarIds } = args;
    if (pillarIds.length === 0) return { generated: 0, pillarsToppedUp: 0, pillarIds: [] };

    // 1. Count active concepts per pillar in one query.
    const { data: existing, error: countErr } = await supabase
        .from('concepts')
        .select('pillar_id, status')
        .eq('user_id', userId)
        .in('pillar_id', pillarIds)
        .in('status', ACTIVE_STATUSES);

    if (countErr) {
        console.error('topUpConcepts count failed (non-fatal):', countErr.message);
        return { generated: 0, pillarsToppedUp: 0, pillarIds: [] };
    }

    const counts = new Map<string, number>();
    for (const id of pillarIds) counts.set(id, 0);
    for (const row of existing ?? []) {
        const pid = (row as { pillar_id: string | null }).pillar_id;
        if (!pid) continue;
        counts.set(pid, (counts.get(pid) ?? 0) + 1);
    }

    const needsTopUp = pillarIds.filter(id => (counts.get(id) ?? 0) < TARGET_UNUSED_PER_PILLAR);
    if (needsTopUp.length === 0) return { generated: 0, pillarsToppedUp: 0, pillarIds: [] };

    let totalGenerated = 0;
    const toppedUpPillars: string[] = [];

    for (const pillarId of needsTopUp) {
        try {
            const inserted = await runTopUpForOnePillar(supabase, userId, pillarId);
            if (inserted > 0) {
                totalGenerated += inserted;
                toppedUpPillars.push(pillarId);
            }
        } catch (err) {
            // Per-pillar failure is non-fatal — keep going with the next
            // pillar so a single rate-limit hiccup doesn't lose work.
            console.error(`topUpConcepts pillar=${pillarId} failed (non-fatal):`, err instanceof Error ? err.message : String(err));
        }
    }

    return {
        generated: totalGenerated,
        pillarsToppedUp: toppedUpPillars.length,
        pillarIds: toppedUpPillars,
    };
}

// Single-pillar runner. Loads pillar + recent essences, runs PASS 1 +
// PASS 2, inserts surviving concepts with voice_adapted_* = null (lazy
// styled when the user first opens the card). Returns # of concepts
// successfully inserted.
async function runTopUpForOnePillar(
    supabase: SupabaseServer,
    userId: string,
    pillarId: string,
): Promise<number> {
    const { data: pillarRow, error: pillarErr } = await supabase
        .from('pillars')
        .select('id, name, description, subtopics, is_series')
        .eq('user_id', userId)
        .eq('id', pillarId)
        .single();

    if (pillarErr || !pillarRow) {
        console.warn(`topUpConcepts: pillar ${pillarId} not found, skipping`);
        return 0;
    }

    const recentEssences = await loadRecentEssencesForPillar(supabase, userId, pillarId);

    // Open run for observability.
    const runHandle = await openPipelineRun({
        supabase,
        userId,
        kind: 'topup',
        metadata: { pillar_id: pillarId, count: PER_PILLAR_COUNT },
    });

    try {
        // PASS 1
        const gen = await runConceptGenerator({
            pillar: {
                name: pillarRow.name,
                description: pillarRow.description ?? null,
                subtopics: pillarRow.subtopics ?? [],
                is_series: pillarRow.is_series ?? false,
            },
            recentEssences,
            seed: null,
            count: PER_PILLAR_COUNT,
        });
        if (runHandle) {
            runHandle.groqCalls += gen.groqCalls;
            runHandle.hfCalls += gen.hfCalls;
        }

        // PASS 2
        const validated = await runValidator({
            supabase,
            userId,
            pillar: { name: pillarRow.name, description: pillarRow.description ?? null },
            candidates: gen.candidates,
            candidateEmbeddings: gen.candidateEmbeddings,
        });
        if (runHandle) runHandle.groqCalls += validated.groqCalls;

        if (validated.accepted.length === 0) {
            await closePipelineRunIfPresent(supabase, runHandle, 'failed', 'validation', { reason: 'all rejected' });
            return 0;
        }

        // No PASS 3 here -- voice_adapted_* stays null and the user gets
        // styled output lazily when they open a card. This caps cost at
        // 2 Groq per pillar instead of 3.

        const rowsToInsert = validated.accepted.map(({ candidate, embedding, score }) => ({
            user_id: userId,
            pillar_id: pillarId,
            title: candidate.title,
            hook: candidate.hook || null,
            angle: candidate.angle || null,
            structure: candidate.structure ?? null,
            ai_reason: candidate.ai_reason || null,
            score: score as unknown as Record<string, number>,
            voice_adapted_title: null,
            voice_adapted_hook: null,
            voice_adapted_text: null,
            status: 'draft' as const,
            source_kind: 'autogen' as const,
            concept_embedding: embedding,
            pipeline_run_id: runHandle?.id ?? null,
        }));

        const { data: inserted, error: insertErr } = await supabase
            .from('concepts')
            .insert(rowsToInsert)
            .select();

        if (insertErr) {
            console.error(`topUpConcepts insert failed pillar=${pillarId}:`, JSON.stringify(insertErr));
            await closePipelineRunIfPresent(supabase, runHandle, 'failed', 'unknown', { message: insertErr.message });
            return 0;
        }

        // concept_events 'created' rows — same pattern as /api/concepts/generate.
        await recordConceptEventsBulk(
            supabase,
            (inserted ?? []).map(row => ({
                userId,
                conceptId: (row as { id: string }).id,
                eventType: 'created' as const,
                toStatus: 'draft' as const,
                metadata: { source_kind: 'autogen', from_topup: true },
            })),
        );

        await closePipelineRunIfPresent(supabase, runHandle, 'succeeded', null, {
            accepted: validated.accepted.length,
            rejected: validated.rejected.length,
            inserted: inserted?.length ?? 0,
        });

        return inserted?.length ?? 0;
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        await closePipelineRunIfPresent(supabase, runHandle, 'failed', 'unknown', { message: msg });
        throw err;
    }
}

async function loadRecentEssencesForPillar(
    supabase: SupabaseServer,
    userId: string,
    pillarId: string,
): Promise<{ topic: string | null; core_idea: string | null }[]> {
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
        const r = t as { essence_topic: string | null; essence_core_idea: string | null };
        return { topic: r.essence_topic, core_idea: r.essence_core_idea };
    });
}

async function closePipelineRunIfPresent(
    supabase: SupabaseServer,
    handle: PipelineRunHandle | null,
    status: 'succeeded' | 'failed',
    errorKind: 'rate_limit' | 'timeout' | '5xx' | 'parse_error' | 'validation' | 'unknown' | null,
    metadata: Record<string, unknown>,
): Promise<void> {
    if (!handle) return;
    await closePipelineRun({ supabase, handle, status, errorKind, metadata });
}
