import type { SupabaseServer } from '@/lib/pillars/types';
import { cosineSimilarity, parseEmbedding } from '@/lib/pillars/embeddings';

export type IdeaWithEmbedding<T> = { idea: T; embedding: number[] };

// Removes near-duplicates from the current batch. Keeps the first occurrence
// (i.e. preserves angle/packaging assignment order). 0.85 cosine on MiniLM-384
// is empirically a tight match — distinct angles in the same pillar cluster
// around 0.5-0.7, so 0.85 catches near-paraphrases without nuking the batch.
export function dedupeWithinBatch<T>(
    items: IdeaWithEmbedding<T>[],
    threshold = 0.85,
): { kept: IdeaWithEmbedding<T>[]; dropped: IdeaWithEmbedding<T>[] } {
    const kept: IdeaWithEmbedding<T>[] = [];
    const dropped: IdeaWithEmbedding<T>[] = [];
    for (const item of items) {
        const isDup = kept.some(k => cosineSimilarity(k.embedding, item.embedding) >= threshold);
        if (isDup) dropped.push(item);
        else kept.push(item);
    }
    return { kept, dropped };
}

// Lightweight history check: drop new ideas that are too close to ideas the
// user has already saved or marked used. We only fetch rows with a non-null
// idea_embedding, so v1 history (which has no embedding) is naturally ignored
// — that's intentional per the Phase 1 scope.
export async function filterAgainstSavedUsed<T>(
    supabase: SupabaseServer,
    userId: string,
    items: IdeaWithEmbedding<T>[],
    threshold = 0.85,
): Promise<{ kept: IdeaWithEmbedding<T>[]; dropped: IdeaWithEmbedding<T>[] }> {
    if (items.length === 0) return { kept: [], dropped: [] };

    const { data: rows, error } = await supabase
        .from('content_ideas')
        .select('idea_embedding')
        .eq('user_id', userId)
        .or('is_saved.eq.true,is_used.eq.true')
        .not('idea_embedding', 'is', null)
        .limit(200); // hard cap — comparing against thousands defeats the "lightweight" spec

    if (error) {
        // Fail open — a DB hiccup must not block idea generation entirely.
        console.warn('ideas/v2 dedup: filterAgainstSavedUsed query failed, skipping:', error.message);
        return { kept: items, dropped: [] };
    }

    const history: number[][] = [];
    for (const r of rows || []) {
        const parsed = parseEmbedding((r as { idea_embedding: unknown }).idea_embedding);
        if (parsed) history.push(parsed);
    }

    if (history.length === 0) return { kept: items, dropped: [] };

    const kept: IdeaWithEmbedding<T>[] = [];
    const dropped: IdeaWithEmbedding<T>[] = [];
    for (const item of items) {
        const tooClose = history.some(h => cosineSimilarity(item.embedding, h) >= threshold);
        if (tooClose) dropped.push(item);
        else kept.push(item);
    }
    return { kept, dropped };
}

// Hook validation lifted from v1 (generate.ts:27-34). Kept inline so v2 stays
// independent of v1; if the rule changes in one place we don't accidentally
// break the other path.
export function hookIsWeak(hook: string): boolean {
    if (!hook) return true;
    const cleaned = hook.trim().replace(/^["“]|["”\.]$/g, '');
    const words = cleaned.split(/\s+/).filter(Boolean);
    if (words.length < 6) return true;
    if (/^(i|my|we)\s+\w+\s+(my|myself|yourself|ourselves|it|this|that)\.?$/i.test(cleaned)) return true;
    return false;
}

const TITLE_TEMPLATE_PATTERNS: RegExp[] = [
    /^The\s+\w+\s+(Paradox|Revolution|Effect|Leap|Surprise|Secret)\b/i,
    /^The\s+(Liberating|Unexpected|Surprising|Hidden|Unknown)\s+(Power|Truth|Path|Outcome|Cost|Price|Secret)\s+of\b/i,
    /^How\s+I\s+Learned\s+to\b/i,
    /^How\s+\w+\s+Can\s+(Lead|Transform|Change|Become)\s+(to|into)?/i,
];

export function titleLooksTemplated(title: string): boolean {
    if (!title || title.trim().length === 0) return true;
    return TITLE_TEMPLATE_PATTERNS.some(p => p.test(title));
}
