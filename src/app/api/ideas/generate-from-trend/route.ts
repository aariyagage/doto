import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { generateOneIdeaFromTrend } from '@/lib/ideas/v2/trend-anchored';
import { getIndustryById } from '@/lib/trends/industries';
import type { TrendAnchor } from '@/lib/ideas/v2/idea-prompt';

export const dynamic = 'force-dynamic';

type Body = {
    pillarId?: unknown;
    kind?: unknown;
    hashtagId?: unknown;
    postId?: unknown;
};

const RANK_DIFF_TYPE_TO_DIRECTION: Record<number, 'up' | 'same' | 'down' | 'new'> = {
    1: 'up',
    2: 'same',
    3: 'down',
    4: 'new',
};

export async function POST(request: Request) {
    try {
        const supabase = createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Reuse the existing LLM rate limit so trend generation can't bypass
        // the same Groq protection that batch generation respects.
        const rl = rateLimit({ key: `ideas-generate:${user.id}`, ...RATE_LIMITS.llmGeneration });
        if (!rl.ok) {
            return NextResponse.json(
                { error: `Rate limit exceeded. Try again in ${rl.retryAfterSeconds}s.` },
                { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
            );
        }

        let body: Body = {};
        try { body = await request.json(); } catch {}
        const pillarId = typeof body.pillarId === 'string' ? body.pillarId : null;
        // Default kind = 'tiktok_hashtag' when only hashtagId is sent so the
        // existing TrendChip clients keep working without a body change.
        const kind = body.kind === 'reddit_post' ? 'reddit_post'
            : body.kind === 'tiktok_hashtag' ? 'tiktok_hashtag'
            : (typeof body.hashtagId === 'string' ? 'tiktok_hashtag' : null);

        if (!pillarId || !kind) {
            return NextResponse.json({ error: 'pillarId and a valid kind (or hashtagId) are required.' }, { status: 400 });
        }

        // Verify pillar ownership and pull mapping context.
        const { data: pillar, error: pillarError } = await supabase
            .from('pillars')
            .select('id, tiktok_industry_id, tiktok_industry_secondary, reddit_subreddits')
            .eq('id', pillarId)
            .eq('user_id', user.id)
            .maybeSingle();
        if (pillarError) {
            return NextResponse.json({ error: pillarError.message }, { status: 500 });
        }
        if (!pillar) {
            return NextResponse.json({ error: 'Pillar not found.' }, { status: 404 });
        }

        let trendAnchor: TrendAnchor;

        if (kind === 'tiktok_hashtag') {
            const hashtagId = typeof body.hashtagId === 'string' ? body.hashtagId : null;
            if (!hashtagId) {
                return NextResponse.json({ error: 'hashtagId is required for tiktok_hashtag kind.' }, { status: 400 });
            }

            const industryIds = [pillar.tiktok_industry_id, pillar.tiktok_industry_secondary].filter(Boolean) as string[];

            const { data: trendRow, error: trendError } = await supabase
                .from('tiktok_trends')
                .select('hashtag_id, hashtag_name, industry_id, rank, rank_diff_type, video_views')
                .eq('hashtag_id', hashtagId)
                .in('industry_id', industryIds.length > 0 ? industryIds : ['__none__'])
                .order('fetched_at', { ascending: false })
                .limit(1)
                .maybeSingle();
            if (trendError) {
                return NextResponse.json({ error: trendError.message }, { status: 500 });
            }
            if (!trendRow) {
                return NextResponse.json({ error: 'Trend not found for this pillar.' }, { status: 404 });
            }

            const industry = getIndustryById(trendRow.industry_id);
            trendAnchor = {
                kind: 'tiktok_hashtag',
                hashtag: trendRow.hashtag_name,
                viewCount: trendRow.video_views ?? null,
                rank: trendRow.rank ?? null,
                rankDirection: trendRow.rank_diff_type != null
                    ? (RANK_DIFF_TYPE_TO_DIRECTION[trendRow.rank_diff_type] ?? null)
                    : null,
                industryName: industry?.name ?? null,
            };
        } else {
            // reddit_post
            const postId = typeof body.postId === 'string' ? body.postId : null;
            if (!postId) {
                return NextResponse.json({ error: 'postId is required for reddit_post kind.' }, { status: 400 });
            }

            const subreddits = ((pillar.reddit_subreddits as string[] | null) ?? []).map(s => s.toLowerCase());
            if (subreddits.length === 0) {
                return NextResponse.json({ error: 'Pillar has no mapped subreddits.' }, { status: 404 });
            }

            const { data: postRow, error: postError } = await supabase
                .from('reddit_trends')
                .select('post_id, subreddit, title, score, num_comments')
                .eq('post_id', postId)
                .in('subreddit', subreddits)
                .order('fetched_at', { ascending: false })
                .limit(1)
                .maybeSingle();
            if (postError) {
                return NextResponse.json({ error: postError.message }, { status: 500 });
            }
            if (!postRow) {
                return NextResponse.json({ error: 'Reddit post not found for this pillar.' }, { status: 404 });
            }

            trendAnchor = {
                kind: 'reddit_post',
                title: postRow.title,
                subreddit: postRow.subreddit,
                score: postRow.score ?? null,
                commentCount: postRow.num_comments ?? null,
            };
        }

        const result = await generateOneIdeaFromTrend({
            supabase,
            userId: user.id,
            pillarId,
            trendAnchor,
        });

        if (result.kind === 'no_fit') {
            return NextResponse.json({ noFit: true, reason: result.reason });
        }
        if (result.kind === 'error') {
            return NextResponse.json({ error: result.error }, { status: 400 });
        }
        return NextResponse.json({ idea: result.idea });
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.error('POST /api/ideas/generate-from-trend error:', err);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
