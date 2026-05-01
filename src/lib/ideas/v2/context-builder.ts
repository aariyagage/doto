import type { SupabaseServer } from '@/lib/pillars/types';
import type { V2PillarContext } from './idea-prompt';

const TRANSCRIPT_RAW_BUDGET = 4000;
const MAX_ESSENCES = 5;
// For series pillars: trim each episode to a short excerpt so 4-5 episodes can
// share the raw-text budget evenly. Without this, the longest episode dominates
// and the LLM anchors on it for every idea in the batch.
const SERIES_PER_EPISODE_BUDGET = 700;

type PillarRow = {
    id: string;
    name: string;
    description: string | null;
    subtopics: string[] | null;
    is_series: boolean | null;
    embedding: unknown;
};

// Phase 1: per-pillar retrieval only. Phase 2 will add a 30% cross-pillar slice
// via match_transcripts_by_essence. We keep the function shape the same so
// only the body changes.
export async function buildPillarContext(args: {
    supabase: SupabaseServer;
    userId: string;
    pillar: PillarRow;
}): Promise<V2PillarContext> {
    const { supabase, userId, pillar } = args;
    const isSeries = pillar.is_series === true;

    // Find videos tagged to this pillar.
    const { data: vpRows } = await supabase
        .from('video_pillars')
        .select('video_id')
        .eq('pillar_id', pillar.id);
    const videoIds = (vpRows || []).map(r => r.video_id as string);

    // For non-series pillars, longer transcripts carry more ground truth — sort
    // by word_count. For series pillars, breadth across episodes matters more
    // than depth on any single one (a meta-format series like "Things I've Been
    // Thinking About" has 4 episodes on completely different topics, and the
    // longest-wins rule was making every idea in a batch anchor on the same
    // episode). Sort by created_at desc so the most recent episodes seed the
    // batch; the per-episode raw-text trim below ensures every episode gets
    // representation in the prompt.
    type Row = { raw_text: string | null; essence: string | null; word_count: number | null };
    let rows: Row[] = [];
    if (videoIds.length > 0) {
        const orderColumn: 'word_count' | 'created_at' = isSeries ? 'created_at' : 'word_count';
        const { data } = await supabase
            .from('transcripts')
            .select('raw_text, essence, word_count, created_at')
            .eq('user_id', userId)
            .in('video_id', videoIds)
            .or('is_hidden.is.null,is_hidden.eq.false')
            .order(orderColumn, { ascending: false })
            .limit(MAX_ESSENCES);
        rows = data || [];
    }

    // Fallback to all of the user's transcripts when the pillar has no tags
    // yet. Same rule v1 uses (generate.ts:348-356).
    if (rows.length === 0) {
        const { data } = await supabase
            .from('transcripts')
            .select('raw_text, essence, word_count')
            .eq('user_id', userId)
            .or('is_hidden.is.null,is_hidden.eq.false')
            .order('word_count', { ascending: false })
            .limit(MAX_ESSENCES);
        rows = data || [];
    }

    const transcriptEssences = rows
        .map(r => (r.essence || '').trim())
        .filter(s => s.length > 0);

    // Series pillars: short excerpt per episode so all episodes fit. Non-series:
    // top-3 in full, capped at the global budget.
    let transcriptRaw: string;
    if (isSeries) {
        const excerpts = rows
            .map(r => (r.raw_text || '').trim())
            .filter(s => s.length > 0)
            .map(s => s.length > SERIES_PER_EPISODE_BUDGET ? s.slice(0, SERIES_PER_EPISODE_BUDGET) + '…' : s);
        transcriptRaw = excerpts.join('\n---\n');
        if (transcriptRaw.length > TRANSCRIPT_RAW_BUDGET) {
            transcriptRaw = transcriptRaw.slice(0, TRANSCRIPT_RAW_BUDGET);
        }
    } else {
        transcriptRaw = rows
            .slice(0, 3)
            .map(r => r.raw_text || '')
            .filter(s => s.length > 0)
            .join('\n---\n');
        if (transcriptRaw.length > TRANSCRIPT_RAW_BUDGET) {
            transcriptRaw = transcriptRaw.slice(0, TRANSCRIPT_RAW_BUDGET);
        }
    }

    return {
        name: pillar.name,
        description: pillar.description,
        isSeries,
        subtopicsAlreadyCovered: Array.isArray(pillar.subtopics) ? pillar.subtopics : [],
        transcriptEssences,
        transcriptRaw,
    };
}
