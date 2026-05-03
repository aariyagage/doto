import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getIndustryById } from '@/lib/trends/industries';
import { mapPillarToIndustry } from '@/lib/trends/industry-mapper';

export const dynamic = 'force-dynamic';

const TRENDS_LIMIT = 10;
// Stale window: cron runs daily, so anything older than 36h means at least one
// run failed. UI surfaces this so creators know the data isn't fresh.
const STALE_AFTER_MS = 36 * 60 * 60 * 1000;

type TrendRow = {
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
            .select('id, name, description, tiktok_industry_id, tiktok_industry_secondary, tiktok_industry_locked')
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

        // Lazy map: any pillar without an industry that hasn't been manually
        // locked gets auto-mapped on first read. Catches every create path
        // (tag-or-create, series-detector, regenerate, future ones) without
        // having to hook each one. Best-effort — if HF is down, fall through
        // to the needsMapping CTA so the user can pick manually.
        let primaryIndustryId = pillar.tiktok_industry_id as string | null;
        let secondaryIndustryId = pillar.tiktok_industry_secondary as string | null;
        if (!primaryIndustryId && !pillar.tiktok_industry_locked) {
            try {
                const match = await mapPillarToIndustry(pillar.name as string, (pillar.description as string | null) ?? null);
                if (match) {
                    primaryIndustryId = match.primary.id;
                    secondaryIndustryId = match.secondary?.id ?? null;
                    await supabase
                        .from('pillars')
                        .update({
                            tiktok_industry_id: primaryIndustryId,
                            tiktok_industry_secondary: secondaryIndustryId,
                        })
                        .eq('id', pillar.id);
                    console.log(`/api/trends auto-mapped pillar="${pillar.name}" → ${match.primary.name}${match.secondary ? ` + ${match.secondary.name}` : ''}`);
                }
            } catch (err) {
                console.warn(`/api/trends auto-map failed for pillar="${pillar.name}":`, err);
            }
        }

        if (!primaryIndustryId) {
            return NextResponse.json({
                trends: [],
                industryName: null,
                lastRefresh: null,
                isStale: false,
                needsMapping: true,
            });
        }

        const industryIds = [primaryIndustryId];
        if (secondaryIndustryId) industryIds.push(secondaryIndustryId);

        // Fetch enough rows to dedupe + rank across primary + secondary. Each
        // industry caps at 50/day, so 100 rows is the worst case here.
        const { data: rows, error: trendsError } = await supabase
            .from('tiktok_trends')
            .select('hashtag_id, hashtag_name, industry_id, rank, rank_diff, rank_diff_type, publish_cnt, video_views, fetched_at')
            .in('industry_id', industryIds)
            .eq('country_code', 'US')
            .eq('period', 7)
            .order('fetched_at', { ascending: false })
            .limit(150);

        if (trendsError) {
            console.error('GET /trends fetch failed:', trendsError);
            return NextResponse.json({ error: trendsError.message }, { status: 500 });
        }

        // Keep only the latest snapshot per hashtag (rows are already DESC by
        // fetched_at, so first occurrence wins).
        const seen = new Set<string>();
        const latestPerHashtag: TrendRow[] = [];
        for (const r of (rows ?? []) as TrendRow[]) {
            if (seen.has(r.hashtag_id)) continue;
            seen.add(r.hashtag_id);
            latestPerHashtag.push(r);
        }

        // Sort by rank ascending (lower rank = better) within whichever industry
        // each hashtag came from. Mixing rank across industries isn't perfect
        // ordering, but it's a fine first cut and dedupe is the bigger concern.
        latestPerHashtag.sort((a, b) => {
            const ra = a.rank ?? Number.MAX_SAFE_INTEGER;
            const rb = b.rank ?? Number.MAX_SAFE_INTEGER;
            return ra - rb;
        });

        const trends = latestPerHashtag.slice(0, TRENDS_LIMIT);
        const lastRefresh = trends.length > 0 ? trends[0].fetched_at : null;
        const isStale = lastRefresh
            ? Date.now() - new Date(lastRefresh).getTime() > STALE_AFTER_MS
            : false;

        const primaryIndustry = getIndustryById(primaryIndustryId);

        return NextResponse.json({
            trends,
            industryName: primaryIndustry?.name ?? null,
            lastRefresh,
            isStale,
            needsMapping: false,
        });
    } catch (err) {
        console.error('GET /trends error:', err);
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
