// Daily trend refresh — TikTok Creative Center hashtags + Reddit hot posts.
//
// Lives outside src/ so Next.js never bundles Playwright. Run by GitHub Actions
// once a day; can also be run locally via `npx tsx scripts/refresh-trends.ts`.
//
// TikTok approach:
//   1. Open the Creative Center hashtag page in headless Chromium.
//   2. Intercept the auth headers (anonymous-user-id, timestamp, user-sign)
//      from the first /popular_trend/hashtag/list XHR — these are computed by
//      an obfuscated client-side signer that's been stable since 2024.
//   3. Re-issue the JSON endpoint ourselves once per industry, sleeping 1s
//      between calls (well under TikTok's ~60 req/min throttle).
//   4. Upsert results into tiktok_trends. The unique index
//      (hashtag_id, industry_id, country_code, period, fetched_date) dedupes
//      same-day re-runs so manual re-triggers are safe.
//
// Reddit approach:
//   1. GET https://www.reddit.com/r/<sub>/hot.json?limit=15 (no auth needed
//      for low volume; same surface a browser visit hits).
//   2. Identified User-Agent (Reddit blocks empty UAs).
//   3. Sleep 6.5s between subs (~9.2 req/min, under unauth 10 req/min cap).
//   4. Upsert into reddit_trends (unique on post_id+source+date).
//
// Reddit ToS note: free dev terms include a non-commercial-use clause. This
// script reads ONLY public unauth JSON at low volume, identified, never
// posting, never authenticated — a grey area but the same surface as a
// public browser visit. If Reddit changes auth requirements, swap to OAuth
// (would require a Reddit "script" app).
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { chromium, type Browser, type BrowserContext } from 'playwright';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { TIKTOK_INDUSTRIES } from '../src/lib/trends/industries';
import { SUBREDDITS } from '../src/lib/trends/subreddits';

// Loose type for the supabase client passed between helpers. The script writes
// to two well-known tables; full Database typing would force codegen we don't
// otherwise need for a cron.
type SupaClient = SupabaseClient<any, any, any>;

const COUNTRY_CODE = 'US';
const PERIOD = 7;
const PER_INDUSTRY_LIMIT = 50;
const INTER_REQUEST_DELAY_MS = 1000;
const HEADER_CAPTURE_TIMEOUT_MS = 30_000;

// Reddit unauth limit is 10 req/min from one IP. 6500ms throttle = ~9.2 req/min.
const REDDIT_INTER_REQUEST_DELAY_MS = 6500;
const REDDIT_PER_SUB_LIMIT = 15;
// HTTP headers must be ASCII-only — keep this string ASCII (no em dashes,
// smart quotes, etc.) or Node fetch will throw "ByteString" errors.
const REDDIT_USER_AGENT = 'Doto/1.0 (+https://doto.app) content-idea-trend-monitor';

type TrendRow = {
    hashtag_id: string;
    hashtag_name: string;
    industry_id: string;
    country_code: string;
    period: number;
    rank: number | null;
    rank_diff: number | null;
    rank_diff_type: number | null;
    publish_cnt: number | null;
    video_views: number | null;
    trend_data: unknown;
};

type CapturedHeaders = Record<string, string>;

function requireEnv(name: string): string {
    const v = process.env[name];
    if (!v) throw new Error(`Missing required env: ${name}`);
    return v;
}

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

async function captureAuthHeaders(browser: Browser): Promise<{ ctx: BrowserContext; headers: CapturedHeaders; cookie: string }> {
    const ctx = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await ctx.newPage();

    let headers: CapturedHeaders | null = null;
    page.on('request', (req) => {
        if (!headers && req.url().includes('/popular_trend/hashtag/list')) {
            headers = req.headers();
        }
    });

    await page.goto('https://ads.tiktok.com/business/creativecenter/inspiration/popular/hashtag/pc/en', {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
    });

    const start = Date.now();
    while (!headers && Date.now() - start < HEADER_CAPTURE_TIMEOUT_MS) {
        await sleep(500);
    }
    if (!headers) {
        await ctx.close();
        throw new Error('Timed out waiting for /popular_trend/hashtag/list request — TikTok may have changed the page structure.');
    }

    const cookies = await ctx.cookies('https://ads.tiktok.com');
    const cookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ');

    await page.close();
    return { ctx, headers, cookie };
}

function buildHeaderSet(captured: CapturedHeaders, cookie: string): Record<string, string> {
    const wanted = ['anonymous-user-id', 'timestamp', 'user-sign', 'web-id', 'x-secsdk-csrf-token', 'user-agent', 'referer', 'accept', 'accept-language'];
    const out: Record<string, string> = { cookie };
    for (const k of wanted) {
        const v = captured[k];
        if (v) out[k] = v;
    }
    return out;
}

async function fetchIndustry(headers: Record<string, string>, industryId: string): Promise<TrendRow[]> {
    const url = new URL('https://ads.tiktok.com/creative_radar_api/v1/popular_trend/hashtag/list');
    url.searchParams.set('page', '1');
    url.searchParams.set('limit', String(PER_INDUSTRY_LIMIT));
    url.searchParams.set('period', String(PERIOD));
    url.searchParams.set('country_code', COUNTRY_CODE);
    url.searchParams.set('industry_id', industryId);
    url.searchParams.set('sort_by', 'popular');

    const res = await fetch(url.toString(), { headers });
    if (!res.ok) {
        throw new Error(`HTTP ${res.status} for industry ${industryId}`);
    }
    const json = await res.json() as { code: number; msg: string; data?: { list?: unknown[] } };
    if (json.code !== 0) {
        throw new Error(`API error code=${json.code} msg=${json.msg} for industry ${industryId}`);
    }
    const list = json.data?.list ?? [];
    return list.map((item) => {
        const it = item as Record<string, unknown>;
        return {
            hashtag_id: String(it.hashtag_id ?? ''),
            hashtag_name: String(it.hashtag_name ?? ''),
            industry_id: industryId,
            country_code: COUNTRY_CODE,
            period: PERIOD,
            rank: typeof it.rank === 'number' ? it.rank : null,
            rank_diff: typeof it.rank_diff === 'number' ? it.rank_diff : null,
            rank_diff_type: typeof it.rank_diff_type === 'number' ? it.rank_diff_type : null,
            publish_cnt: typeof it.publish_cnt === 'number' ? it.publish_cnt : null,
            video_views: typeof it.video_views === 'number' ? it.video_views : null,
            trend_data: it,
        };
    }).filter((r) => r.hashtag_id && r.hashtag_name);
}

type RedditRow = {
    post_id: string;
    subreddit: string;
    title: string;
    score: number | null;
    num_comments: number | null;
    permalink: string | null;
    flair: string | null;
    source: string;
};

async function fetchSubreddit(name: string): Promise<RedditRow[]> {
    const url = `https://www.reddit.com/r/${name}/hot.json?limit=${REDDIT_PER_SUB_LIMIT}`;
    const res = await fetch(url, {
        headers: { 'User-Agent': REDDIT_USER_AGENT },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json() as { data?: { children?: { data?: Record<string, unknown> }[] } };
    const children = json.data?.children ?? [];
    const subLower = name.toLowerCase();
    return children
        .map((c) => c.data ?? {})
        .filter((d) => {
            // Skip stickied posts (mod announcements, FAQs) and pinned content —
            // they're not trends, just shelf decoration.
            return !d.stickied && !d.pinned;
        })
        .map((d) => ({
            post_id: String(d.id ?? ''),
            subreddit: subLower,
            title: String(d.title ?? '').trim(),
            score: typeof d.score === 'number' ? d.score : null,
            num_comments: typeof d.num_comments === 'number' ? d.num_comments : null,
            permalink: typeof d.permalink === 'string' ? d.permalink : null,
            flair: typeof d.link_flair_text === 'string' ? d.link_flair_text : null,
            source: 'hot',
        }))
        .filter((r) => r.post_id && r.title);
}

async function refreshTikTok(supabase: SupaClient): Promise<{ rows: number; failed: string[] }> {
    const browser = await chromium.launch({ headless: true });
    let rows = 0;
    const failed: string[] = [];
    try {
        const { ctx, headers, cookie } = await captureAuthHeaders(browser);
        const headerSet = buildHeaderSet(headers, cookie);
        console.log(`[refresh-trends/tiktok] captured headers, fetching ${TIKTOK_INDUSTRIES.length} industries`);

        for (const industry of TIKTOK_INDUSTRIES) {
            try {
                const data = await fetchIndustry(headerSet, industry.id);
                if (data.length === 0) {
                    console.warn(`[refresh-trends/tiktok] ${industry.name}: 0 rows (skipping upsert)`);
                    await sleep(INTER_REQUEST_DELAY_MS);
                    continue;
                }
                const { error } = await supabase
                    .from('tiktok_trends')
                    .upsert(data, { onConflict: 'hashtag_id,industry_id,country_code,period,fetched_date' });
                if (error) {
                    console.error(`[refresh-trends/tiktok] upsert failed for ${industry.name}:`, error.message);
                    failed.push(`tiktok:${industry.name}`);
                } else {
                    rows += data.length;
                    console.log(`[refresh-trends/tiktok] ${industry.name}: ${data.length} rows`);
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`[refresh-trends/tiktok] ${industry.name} failed: ${msg}`);
                failed.push(`tiktok:${industry.name}`);
            }
            await sleep(INTER_REQUEST_DELAY_MS);
        }
        await ctx.close();
    } finally {
        await browser.close();
    }
    return { rows, failed };
}

async function refreshReddit(supabase: SupaClient): Promise<{ rows: number; failed: string[] }> {
    let rows = 0;
    const failed: string[] = [];
    console.log(`[refresh-trends/reddit] fetching ${SUBREDDITS.length} subreddits`);

    for (const sub of SUBREDDITS) {
        try {
            const data = await fetchSubreddit(sub.name);
            if (data.length === 0) {
                console.warn(`[refresh-trends/reddit] r/${sub.name}: 0 posts (skipping upsert)`);
                await sleep(REDDIT_INTER_REQUEST_DELAY_MS);
                continue;
            }
            const { error } = await supabase
                .from('reddit_trends')
                .upsert(data, { onConflict: 'post_id,source,fetched_date' });
            if (error) {
                console.error(`[refresh-trends/reddit] upsert failed for r/${sub.name}:`, error.message);
                failed.push(`reddit:${sub.name}`);
            } else {
                rows += data.length;
                console.log(`[refresh-trends/reddit] r/${sub.name}: ${data.length} posts`);
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[refresh-trends/reddit] r/${sub.name} failed: ${msg}`);
            failed.push(`reddit:${sub.name}`);
        }
        await sleep(REDDIT_INTER_REQUEST_DELAY_MS);
    }
    return { rows, failed };
}

async function main() {
    const supabase = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
        auth: { persistSession: false },
    });

    const tiktokResult = await refreshTikTok(supabase);
    const redditResult = await refreshReddit(supabase);

    const totalRows = tiktokResult.rows + redditResult.rows;
    const allFailed = [...tiktokResult.failed, ...redditResult.failed];

    console.log(
        `[refresh-trends] done — tiktok=${tiktokResult.rows} reddit=${redditResult.rows} total=${totalRows} failed=${allFailed.length}`,
    );
    if (allFailed.length > 0) {
        console.error(`[refresh-trends] failures: ${allFailed.join(', ')}`);
        // Don't fail the whole run if just some sources failed — partial data is
        // better than none. Only exit non-zero if NOTHING was written.
        if (totalRows === 0) process.exit(1);
    }
}

main().catch((err) => {
    console.error('[refresh-trends] fatal:', err);
    process.exit(1);
});
