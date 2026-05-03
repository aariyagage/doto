import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getIndustryById } from '@/lib/trends/industries';
import { mapPillarToIndustry } from '@/lib/trends/industry-mapper';
import { mapPillarToSubreddits } from '@/lib/trends/subreddit-mapper';

export const dynamic = 'force-dynamic';

const TRENDS_LIMIT = 10;
// Stale window: cron runs daily, so anything older than 36h means at least one
// run failed. UI surfaces this so creators know the data isn't fresh.
const STALE_AFTER_MS = 36 * 60 * 60 * 1000;
// Above this cosine, the TikTok industry is a strong-enough match to use TikTok
// as the trend source. Below this, fall back to Reddit (better signal for
// essay/commentary/productivity niches).
const TIKTOK_CONFIDENCE_THRESHOLD = 0.55;

type TikTokRow = {
    hashtag_id: string;
    hashtag_name: string;
    industry_id: string;
    rank: number | null;
    rank_diff: number | null;
    rank_diff_type: number | null;
    publish_cnt: number | null;
    video_views: number | null;
    fetched_at: string;
};

type RedditRow = {
    post_id: string;
    subreddit: string;
    title: string;
    score: number | null;
    num_comments: number | null;
    permalink: string | null;
    flair: string | null;
    fetched_at: string;
};

export async function GET(request: Request) {
    try {
        const supabase = createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const pillarId = searchParams.get('pillarId');
        if (!pillarId) {
            return NextResponse.json({ error: 'pillarId is required' }, { status: 400 });
        }

        const { data: pillar, error: pillarError } = await supabase
            .from('pillars')
            .select('id, name, description, tiktok_industry_id, tiktok_industry_secondary, tiktok_industry_locked, tiktok_industry_score, reddit_subreddits, reddit_subreddits_locked')
            .eq('id', pillarId)
            .eq('user_id', user.id)
            .maybeSingle();

        if (pillarError) {
            console.error('GET /trends pillar fetch failed:', pillarError);
            return NextResponse.json({ error: pillarError.message }, { status: 500 });
        }
        if (!pillar) {
            return NextResponse.json({ error: 'Pillar not found' }, { status: 404 });
        }

        // Lazy map: any pillar that hasn't been mapped (and isn't locked) gets
        // auto-mapped on first read for both TikTok industry and Reddit
        // subreddits. Self-healing for pillars created via any path.
        let primaryIndustryId = pillar.tiktok_industry_id as string | null;
        let secondaryIndustryId = pillar.tiktok_industry_secondary as string | null;
        let industryScore = pillar.tiktok_industry_score as number | null;
        let subreddits = (pillar.reddit_subreddits as string[] | null) ?? null;

        const needsIndustryMap = !primaryIndustryId && !pillar.tiktok_industry_locked;
        const needsSubredditMap = (!subreddits || subreddits.length === 0) && !pillar.reddit_subreddits_locked;

        if (needsIndustryMap || needsSubredditMap) {
            const updates: Record<string, unknown> = {};
            if (needsIndustryMap) {
                try {
                    const match = await mapPillarToIndustry(pillar.name as string, (pillar.description as string | null) ?? null);
                    if (match) {
                        primaryIndustryId = match.primary.id;
                        secondaryIndustryId = match.secondary?.id ?? null;
                        industryScore = match.primaryScore;
                        updates.tiktok_industry_id = primaryIndustryId;
                        updates.tiktok_industry_secondary = secondaryIndustryId;
                        updates.tiktok_industry_score = industryScore;
                        console.log(`/api/trends auto-mapped pillar="${pillar.name}" industry → ${match.primary.name} (score=${match.primaryScore.toFixed(2)})`);
                    }
                } catch (err) {
                    console.warn(`/api/trends industry map failed for pillar="${pillar.name}":`, err);
                }
            }
            if (needsSubredditMap) {
                try {
                    const subMatch = await mapPillarToSubreddits(pillar.name as string, (pillar.description as string | null) ?? null);
                    if (subMatch) {
                        subreddits = subMatch.subreddits;
                        updates.reddit_subreddits = subreddits;
                        console.log(`/api/trends auto-mapped pillar="${pillar.name}" subs → ${subMatch.subreddits.join(', ')}`);
                    }
                } catch (err) {
                    console.warn(`/api/trends subreddit map failed for pillar="${pillar.name}":`, err);
                }
            }
            if (Object.keys(updates).length > 0) {
                await supabase.from('pillars').update(updates).eq('id', pillar.id);
            }
        }

        // Source decision. Manual industry-lock always wins and forces TikTok.
        // Otherwise: high-confidence industry match → TikTok; everything else
        // (low confidence or no match) → Reddit if subs are mapped.
        const tiktokForced = pillar.tiktok_industry_locked === true && !!primaryIndustryId;
        const tiktokConfident = industryScore != null && industryScore >= TIKTOK_CONFIDENCE_THRESHOLD;
        const useTikTok = !!primaryIndustryId && (tiktokForced || tiktokConfident);
        const useReddit = !useTikTok && !!(subreddits && subreddits.length > 0);

        if (!useTikTok && !useReddit) {
            // Both sources unmapped — UI shows the manual-pick CTA.
            return NextResponse.json({
                source: null,
                trends: [],
                industryName: null,
                subreddits: [],
                lastRefresh: null,
                isStale: false,
                needsMapping: true,
                industryScore,
            });
        }

        if (useTikTok) {
            const industryIds = [primaryIndustryId!];
            if (secondaryIndustryId) industryIds.push(secondaryIndustryId);

            const { data: rows, error: trendsError } = await supabase
                .from('tiktok_trends')
                .select('hashtag_id, hashtag_name, industry_id, rank, rank_diff, rank_diff_type, publish_cnt, video_views, fetched_at')
                .in('industry_id', industryIds)
                .eq('country_code', 'US')
                .eq('period', 7)
                .order('fetched_at', { ascending: false })
                .limit(150);

            if (trendsError) {
                console.error('GET /trends tiktok fetch failed:', trendsError);
                return NextResponse.json({ error: trendsError.message }, { status: 500 });
            }

            const seen = new Set<string>();
            const latest: TikTokRow[] = [];
            for (const r of (rows ?? []) as TikTokRow[]) {
                if (seen.has(r.hashtag_id)) continue;
                seen.add(r.hashtag_id);
                latest.push(r);
            }
            latest.sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER));

            const trends = latest.slice(0, TRENDS_LIMIT);
            const lastRefresh = trends.length > 0 ? trends[0].fetched_at : null;
            const isStale = lastRefresh ? Date.now() - new Date(lastRefresh).getTime() > STALE_AFTER_MS : false;

            return NextResponse.json({
                source: 'tiktok',
                trends,
                industryName: getIndustryById(primaryIndustryId)?.name ?? null,
                subreddits: subreddits ?? [],
                lastRefresh,
                isStale,
                needsMapping: false,
                industryScore,
            });
        }

        // useReddit branch.
        const subsLower = (subreddits ?? []).map(s => s.toLowerCase());
        const { data: redditRows, error: redditError } = await supabase
            .from('reddit_trends')
            .select('post_id, subreddit, title, score, num_comments, permalink, flair, fetched_at')
            .in('subreddit', subsLower)
            .order('fetched_at', { ascending: false })
            .limit(150);

        if (redditError) {
            console.error('GET /trends reddit fetch failed:', redditError);
            return NextResponse.json({ error: redditError.message }, { status: 500 });
        }

        // Latest snapshot per post.
        const seen = new Set<string>();
        const latest: RedditRow[] = [];
        for (const r of (redditRows ?? []) as RedditRow[]) {
            if (seen.has(r.post_id)) continue;
            seen.add(r.post_id);
            latest.push(r);
        }
        // Rank by score (upvotes) desc — closer proxy for "what's actually
        // resonating" than fetched_at order.
        latest.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

        const trends = latest.slice(0, TRENDS_LIMIT);
        const lastRefresh = trends.length > 0 ? trends[0].fetched_at : null;
        const isStale = lastRefresh ? Date.now() - new Date(lastRefresh).getTime() > STALE_AFTER_MS : false;

        return NextResponse.json({
            source: 'reddit',
            trends,
            industryName: null,
            subreddits: subreddits ?? [],
            lastRefresh,
            isStale,
            needsMapping: false,
            industryScore,
        });
    } catch (err) {
        console.error('GET /trends error:', err);
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
