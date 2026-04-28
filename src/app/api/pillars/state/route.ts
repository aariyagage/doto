import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const SOFT_CAP = 8;
const STALE_NUDGE_THRESHOLD = 3;

// Single endpoint that powers the empty-state branching, soft-cap nudge, and
// stale-pillar nudge in /ideas. Keeps the UI from having to compute these.
export async function GET() {
    try {
        const supabase = createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // 1. Pillar count.
        const { count: pillarCount, error: pErr } = await supabase
            .from('pillars')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id);
        if (pErr) throw new Error(`Failed to count pillars: ${pErr.message}`);

        // 2. Eligible (non-hidden) transcript count.
        const { count: transcriptCount, error: tErr } = await supabase
            .from('transcripts')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .or('is_hidden.is.null,is_hidden.eq.false');
        if (tErr) throw new Error(`Failed to count transcripts: ${tErr.message}`);

        // 3. Recent untagged videos (status=done, has essence_embedding, no
        //    video_pillars row, created in last 14 days).
        //    Two queries because Supabase's filter chain doesn't express the
        //    LEFT JOIN cleanly. First: candidate video IDs. Second: filter
        //    out any that have a tag.
        const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

        const { data: candidateVideos, error: vErr } = await supabase
            .from('videos')
            .select('id, transcripts!inner(essence_embedding)')
            .eq('user_id', user.id)
            .eq('status', 'done')
            .gte('created_at', fourteenDaysAgo);
        if (vErr) throw new Error(`Failed to fetch recent videos: ${vErr.message}`);

        const recentVideoIds = (candidateVideos || [])
            .filter(v => {
                const ts = v.transcripts as unknown as Array<{ essence_embedding: number[] | null }>
                    | { essence_embedding: number[] | null }
                    | null;
                if (!ts) return false;
                const arr = Array.isArray(ts) ? ts : [ts];
                return arr.some(r => Array.isArray(r.essence_embedding) && r.essence_embedding.length > 0);
            })
            .map(v => v.id as string);

        let untaggedRecentVideos = 0;
        if (recentVideoIds.length > 0) {
            const { data: tagged, error: tagErr } = await supabase
                .from('video_pillars')
                .select('video_id')
                .in('video_id', recentVideoIds);
            if (tagErr) throw new Error(`Failed to fetch video_pillars: ${tagErr.message}`);
            const taggedSet = new Set((tagged || []).map(r => r.video_id as string));
            untaggedRecentVideos = recentVideoIds.filter(id => !taggedSet.has(id)).length;
        }

        return NextResponse.json({
            pillarCount: pillarCount || 0,
            isOverSoftCap: (pillarCount || 0) >= SOFT_CAP,
            softCap: SOFT_CAP,
            untaggedRecentVideos,
            staleNudgeThreshold: STALE_NUDGE_THRESHOLD,
            shouldShowStaleNudge: untaggedRecentVideos >= STALE_NUDGE_THRESHOLD && (pillarCount || 0) > 0,
            eligibleTranscriptCount: transcriptCount || 0,
        });
    } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error('GET /pillars/state Error:', errorMessage);
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}
