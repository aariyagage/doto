// Daily TikTok Creative Center trend refresh.
//
// Lives outside src/ so Next.js never bundles Playwright. Run by GitHub Actions
// once a day; can also be run locally via `npx tsx scripts/refresh-trends.ts`.
//
// Approach:
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
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { chromium, type Browser, type BrowserContext } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { TIKTOK_INDUSTRIES } from '../src/lib/trends/industries';

const COUNTRY_CODE = 'US';
const PERIOD = 7;
const PER_INDUSTRY_LIMIT = 50;
const INTER_REQUEST_DELAY_MS = 1000;
const HEADER_CAPTURE_TIMEOUT_MS = 30_000;

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

async function main() {
    const supabase = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
        auth: { persistSession: false },
    });

    const browser = await chromium.launch({ headless: true });
    let totalRows = 0;
    let failed: string[] = [];

    try {
        const { ctx, headers, cookie } = await captureAuthHeaders(browser);
        const headerSet = buildHeaderSet(headers, cookie);
        console.log(`[refresh-trends] captured headers, fetching ${TIKTOK_INDUSTRIES.length} industries`);

        for (const industry of TIKTOK_INDUSTRIES) {
            try {
                const rows = await fetchIndustry(headerSet, industry.id);
                if (rows.length === 0) {
                    console.warn(`[refresh-trends] ${industry.name}: 0 rows (skipping upsert)`);
                    await sleep(INTER_REQUEST_DELAY_MS);
                    continue;
                }
                const { error } = await supabase
                    .from('tiktok_trends')
                    .upsert(rows, { onConflict: 'hashtag_id,industry_id,country_code,period,fetched_date' });
                if (error) {
                    console.error(`[refresh-trends] upsert failed for ${industry.name}:`, error.message);
                    failed.push(industry.name);
                } else {
                    totalRows += rows.length;
                    console.log(`[refresh-trends] ${industry.name}: ${rows.length} rows`);
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`[refresh-trends] ${industry.name} failed: ${msg}`);
                failed.push(industry.name);
            }
            await sleep(INTER_REQUEST_DELAY_MS);
        }

        await ctx.close();
    } finally {
        await browser.close();
    }

    console.log(`[refresh-trends] done — ${totalRows} rows across ${TIKTOK_INDUSTRIES.length - failed.length}/${TIKTOK_INDUSTRIES.length} industries`);
    if (failed.length > 0) {
        console.error(`[refresh-trends] failures: ${failed.join(', ')}`);
        process.exit(1);
    }
}

main().catch((err) => {
    console.error('[refresh-trends] fatal:', err);
    process.exit(1);
});
