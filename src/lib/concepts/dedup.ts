// Cosine dedup for concept candidates.
//
// Three checks, applied in order:
//   1. Within-batch — drop near-duplicates among the candidates that PASS 1
//      just produced (same Groq call sometimes emits two paraphrases).
//   2. Saved/used concepts — never re-suggest something the user has
//      already saved or used.
//   3. Saved/used legacy v2 content_ideas — same, but reads the legacy
//      table read-only so we don't re-suggest things the user kept in
//      /ideas before vNext shipped.
//
// Threshold: 0.85 cosine. Rationale (matches src/lib/ideas/v2/dedup.ts):
// MiniLM-L6-v2 clusters near-paraphrases at 0.85+; distinct angles on the
// same topic land in 0.5-0.7. 0.85 is the line where "different framing of
// the same idea" stops being interesting.

import { cosineSimilarity, parseEmbedding } from '@/lib/pillars/embeddings';
import type { SupabaseServer } from '@/lib/pillars/types';
import type { ConceptCandidate, DedupDecision } from './types';

export const CONCEPT_DEDUP_COSINE_THRESHOLD = 0.85;

export interface CandidateWithEmbedding {
    candidate: ConceptCandidate;
    embedding: number[];
}

export interface BatchDedupResult {
    kept: CandidateWithEmbedding[];
    dropped: { item: CandidateWithEmbedding; decision: DedupDecision }[];
}

// 1. Within-batch dedup.
// Greedy: walk the list in order, keep an item only if its embedding is
// below threshold against all already-kept items. Order matters; the caller
// should pass candidates ranked by composite score so the highest-scored
// duplicate wins.
export function dedupeWithinBatch(items: CandidateWithEmbedding[]): BatchDedupResult {
    const kept: CandidateWithEmbedding[] = [];
    const dropped: BatchDedupResult['dropped'] = [];

    for (const item of items) {
        let collision: { sim: number; idx: number } | null = null;
        for (let i = 0; i < kept.length; i++) {
            const sim = cosineSimilarity(item.embedding, kept[i].embedding);
            if (sim >= CONCEPT_DEDUP_COSINE_THRESHOLD) {
                if (!collision || sim > collision.sim) {
                    collision = { sim, idx: i };
                }
            }
        }
        if (collision) {
            dropped.push({
                item,
                decision: {
                    keep: false,
                    reason: 'cosine_self',
                    similarity: collision.sim,
                    againstId: kept[collision.idx].candidate.title, // best-effort handle
                },
            });
        } else {
            kept.push(item);
        }
    }

    return { kept, dropped };
}

// 2. Filter against saved/used concepts already in the concepts table.
// Reads (id, concept_embedding) for status in (saved, used) for this user
// and rejects any candidate whose cosine to any of them is >= threshold.
export async function filterAgainstSavedConcepts(
    supabase: SupabaseServer,
    userId: string,
    items: CandidateWithEmbedding[],
): Promise<BatchDedupResult> {
    if (items.length === 0) return { kept: [], dropped: [] };

    const { data: history, error } = await supabase
        .from('concepts')
        .select('id, title, concept_embedding')
        .eq('user_id', userId)
        .in('status', ['saved', 'used'])
        .not('concept_embedding', 'is', null);

    if (error) {
        console.warn(`dedup: filterAgainstSavedConcepts query failed; allowing batch through:`, JSON.stringify(error));
        return { kept: items, dropped: [] };
    }

    return filterAgainstHistoryRows(items, (history ?? []) as Array<{ id: string; title: string; concept_embedding: unknown }>, 'cosine_saved_concept');
}

// 3. Filter against legacy saved/used v2 content_ideas.
// Read-only against the legacy table. v1 rows are skipped (no embedding).
export async function filterAgainstSavedLegacyIdeas(
    supabase: SupabaseServer,
    userId: string,
    items: CandidateWithEmbedding[],
): Promise<BatchDedupResult> {
    if (items.length === 0) return { kept: [], dropped: [] };

    const { data: history, error } = await supabase
        .from('content_ideas')
        .select('id, title, idea_embedding')
        .eq('user_id', userId)
        .eq('source_version', 'v2')
        .or('is_saved.eq.true,is_used.eq.true')
        .not('idea_embedding', 'is', null);

    if (error) {
        console.warn(`dedup: filterAgainstSavedLegacyIdeas query failed; allowing batch through:`, JSON.stringify(error));
        return { kept: items, dropped: [] };
    }

    // Normalize column name: idea_embedding -> concept_embedding shape for the helper.
    const normalized = (history ?? []).map(r => ({
        id: (r as { id: string }).id,
        title: (r as { title: string }).title,
        concept_embedding: (r as { idea_embedding: unknown }).idea_embedding,
    }));

    return filterAgainstHistoryRows(items, normalized, 'cosine_saved_idea');
}

function filterAgainstHistoryRows(
    items: CandidateWithEmbedding[],
    rows: Array<{ id: string; title: string; concept_embedding: unknown }>,
    reason: 'cosine_saved_concept' | 'cosine_saved_idea',
): BatchDedupResult {
    if (rows.length === 0) return { kept: items, dropped: [] };

    const historyVecs: { id: string; vec: number[] }[] = [];
    for (const r of rows) {
        const vec = parseEmbedding(r.concept_embedding);
        if (vec) historyVecs.push({ id: r.id, vec });
    }
    if (historyVecs.length === 0) return { kept: items, dropped: [] };

    const kept: CandidateWithEmbedding[] = [];
    const dropped: BatchDedupResult['dropped'] = [];

    for (const item of items) {
        let collision: { sim: number; id: string } | null = null;
        for (const h of historyVecs) {
            const sim = cosineSimilarity(item.embedding, h.vec);
            if (sim >= CONCEPT_DEDUP_COSINE_THRESHOLD) {
                if (!collision || sim > collision.sim) {
                    collision = { sim, id: h.id };
                }
            }
        }
        if (collision) {
            dropped.push({
                item,
                decision: { keep: false, reason, similarity: collision.sim, againstId: collision.id },
            });
        } else {
            kept.push(item);
        }
    }

    return { kept, dropped };
}
