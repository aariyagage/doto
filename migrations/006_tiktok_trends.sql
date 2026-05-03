-- TikTok trends per pillar.
-- Adds a daily-refreshed trend feed sourced from TikTok Creative Center, scoped
-- to each pillar via an industry mapping. The trend table is shared across all
-- users (public reference data — same trends apply to every "Productivity"
-- creator), so no user_id and no RLS. The pillar mapping is per-pillar and
-- inherits whatever RLS already governs pillars.
--
-- Strictly additive. All new columns nullable or defaulted so existing pillars
-- and ideas keep working without a backfill.
--
-- Run this in the Supabase SQL editor.

-- 1. Pillar → TikTok industry mapping.
--    primary_industry_id is required for trend lookup; secondary is an optional
--    blend (e.g. "Productivity" maps to Education + Business Services).
--    locked=true means the user manually picked the industry — the auto-mapper
--    must skip these rows on subsequent pillar updates.
ALTER TABLE pillars
  ADD COLUMN IF NOT EXISTS tiktok_industry_id          TEXT,
  ADD COLUMN IF NOT EXISTS tiktok_industry_secondary   TEXT,
  ADD COLUMN IF NOT EXISTS tiktok_industry_locked      BOOLEAN NOT NULL DEFAULT false;

-- 2. Source trend on a generated idea.
--    NULL for normal generations; set to the hashtag (e.g. "#prom2026") when an
--    idea was generated via the trend-anchored path. Lets the UI badge ideas as
--    "trend-anchored" and lets us measure trend conversion later.
ALTER TABLE content_ideas
  ADD COLUMN IF NOT EXISTS source_trend_hashtag TEXT;

-- 3. Daily trend snapshot.
--    rank_diff_type follows TikTok's enum: 1=up, 2=same, 3=down, 4=new on board.
--    fetched_date is generated from fetched_at so the unique index can dedupe
--    on (hashtag, industry, country, period, day) cleanly.
CREATE TABLE IF NOT EXISTS tiktok_trends (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hashtag_id      TEXT NOT NULL,
  hashtag_name    TEXT NOT NULL,
  industry_id     TEXT NOT NULL,
  country_code    TEXT NOT NULL DEFAULT 'US',
  period          INT  NOT NULL DEFAULT 7,
  rank            INT,
  rank_diff       INT,
  rank_diff_type  INT,
  publish_cnt     BIGINT,
  video_views     BIGINT,
  trend_data      JSONB,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- AT TIME ZONE 'UTC' makes the cast IMMUTABLE (a plain ::date on a
  -- timestamptz is only STABLE because it depends on the session's timezone,
  -- which Postgres rejects for generated columns).
  fetched_date    DATE GENERATED ALWAYS AS (((fetched_at AT TIME ZONE 'UTC')::date)) STORED
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_trend_per_day
  ON tiktok_trends (hashtag_id, industry_id, country_code, period, fetched_date);

CREATE INDEX IF NOT EXISTS idx_trends_lookup
  ON tiktok_trends (industry_id, country_code, period, fetched_at DESC);

-- 4. Row-level security.
--    Trends are public reference data — every "Productivity" creator sees the
--    same hashtags — so reads are open to any authenticated user. Writes are
--    only allowed through the service-role key used by the daily cron, which
--    bypasses RLS by design. We deliberately create NO insert/update/delete
--    policies, which means the anon/authenticated keys can't mutate this
--    table even though service_role still can.
ALTER TABLE tiktok_trends ENABLE ROW LEVEL SECURITY;

CREATE POLICY tiktok_trends_read_authenticated
  ON tiktok_trends
  FOR SELECT
  TO authenticated
  USING (true);

-- Verification:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'pillars' AND column_name LIKE 'tiktok_%';
--   -- expect 3 rows
--
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'content_ideas' AND column_name = 'source_trend_hashtag';
--   -- expect 1 row
--
--   SELECT to_regclass('public.tiktok_trends');
--   -- expect 'tiktok_trends'
--
--   SELECT indexname FROM pg_indexes WHERE tablename = 'tiktok_trends';
--   -- expect uniq_trend_per_day, idx_trends_lookup, plus the PK index
--
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'tiktok_trends';
--   -- expect t (true)
--
--   SELECT polname FROM pg_policy WHERE polrelid = 'tiktok_trends'::regclass;
--   -- expect tiktok_trends_read_authenticated
