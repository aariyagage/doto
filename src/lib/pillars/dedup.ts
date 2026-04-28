import type { SupabaseServer } from './types';

export const PILLAR_DEDUP_COSINE_THRESHOLD = 0.82;

export interface PillarMatch {
    id: string;
    name: string;
    description: string | null;
    is_series: boolean;
    similarity: number;
}

// Calls the match_pillar_by_embedding RPC. Threshold defaults to 0.82 — anything
// at or above this is treated as semantically the same pillar even if names differ
// ("beauty favs" vs "product reviews"). Set threshold=0 to fetch top-N regardless.
export async function findSimilarPillars(
    supabase: SupabaseServer,
    userId: string,
    embedding: number[],
    threshold = PILLAR_DEDUP_COSINE_THRESHOLD,
): Promise<PillarMatch[]> {
    const { data, error } = await supabase.rpc('match_pillar_by_embedding', {
        p_user_id: userId,
        p_embedding: embedding,
        p_threshold: threshold,
    });

    if (error) throw new Error(`Pillar similarity search failed: ${error.message}`);
    return (data || []) as PillarMatch[];
}

export async function findClosestPillar(
    supabase: SupabaseServer,
    userId: string,
    embedding: number[],
    threshold = PILLAR_DEDUP_COSINE_THRESHOLD,
): Promise<PillarMatch | null> {
    const matches = await findSimilarPillars(supabase, userId, embedding, threshold);
    return matches.length > 0 ? matches[0] : null;
}
