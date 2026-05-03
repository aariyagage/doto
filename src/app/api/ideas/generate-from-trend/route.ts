import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { generateOneIdeaFromTrend } from '@/lib/ideas/v2/trend-anchored';
import { getIndustryById } from '@/lib/trends/industries';
import type { TrendAnchor } from '@/lib/ideas/v2/idea-prompt';

export const dynamic = 'force-dynamic';

type Body = {
    pillarId?: unknown;
    hashtagId?: unknown;
};

const RANK_DIFF_TYPE_TO_DIRECTION: Record<number, TrendAnchor['rankDirection']> = {
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
        const hashtagId = typeof body.hashtagId === 'string' ? body.hashtagId : null;
        if (!pillarId || !hashtagId) {
            return NextResponse.json({ error: 'pillarId and hashtagId are required.' }, { status: 400 });
        }

        // Verify pillar ownership and pull mapping context for the prompt.
        const { data: pillar, error: pillarError } = await supabase
            .from('pillars')
            .select('id, tiktok_industry_id, tiktok_industry_secondary')
            .eq('id', pillarId)
            .eq('user_id', user.id)
            .maybeSingle();
        if (pillarError) {
            return NextResponse.json({ error: pillarError.message }, { status: 500 });
        }
        if (!pillar) {
            return NextResponse.json({ error: 'Pillar not found.' }, { status: 404 });
        }

        const industryIds = [pillar.tiktok_industry_id, pillar.tiktok_industry_secondary].filter(Boolean) as string[];

        // Fetch the latest snapshot of the requested hashtag scoped to the
        // pillar's mapped industries — prevents generating from a trend that
        // belongs to a totally unrelated category by accident.
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
        const trendAnchor: TrendAnchor = {
            hashtag: trendRow.hashtag_name,
            viewCount: trendRow.video_views ?? null,
            rank: trendRow.rank ?? null,
            rankDirection: trendRow.rank_diff_type != null
                ? (RANK_DIFF_TYPE_TO_DIRECTION[trendRow.rank_diff_type] ?? null)
                : null,
            industryName: industry?.name ?? null,
        };

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
