import type { SupabaseServer } from '@/lib/pillars/types';
import type { V2PillarContext } from './idea-prompt';

const TRANSCRIPT_RAW_BUDGET = 4000;
const MAX_ESSENCES = 5;

type PillarRow = {
    id: string;
    name: string;
    description: string | null;
    subtopics: string[] | null;
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

    // Find videos tagged to this pillar.
    const { data: vpRows } = await supabase
        .from('video_pillars')
        .select('video_id')
        .eq('pillar_id', pillar.id);
    const videoIds = (vpRows || []).map(r => r.video_id as string);

    // Pull tagged transcripts. We sort by word_count to mirror v1 behavior —
    // longer transcripts carry more retrievable ground truth than 30-second
    // off-the-cuff clips. A future enhancement would order by cosine similarity
    // to pillar.embedding via pgvector, but Phase 1 keeps the query simple.
    let rows: { raw_text: string | null; essence: string | null; word_count: number | null }[] = [];
    if (videoIds.length > 0) {
        const { data } = await supabase
            .from('transcripts')
            .select('raw_text, essence, word_count')
            .eq('user_id', userId)
            .in('video_id', videoIds)
            .or('is_hidden.is.null,is_hidden.eq.false')
            .order('word_count', { ascending: false })
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

    let transcriptRaw = rows
        .slice(0, 3)
        .map(r => r.raw_text || '')
        .filter(s => s.length > 0)
        .join('\n---\n');
    if (transcriptRaw.length > TRANSCRIPT_RAW_BUDGET) {
        transcriptRaw = transcriptRaw.slice(0, TRANSCRIPT_RAW_BUDGET);
    }

    return {
        name: pillar.name,
        description: pillar.description,
        subtopicsAlreadyCovered: Array.isArray(pillar.subtopics) ? pillar.subtopics : [],
        transcriptEssences,
        transcriptRaw,
    };
}
