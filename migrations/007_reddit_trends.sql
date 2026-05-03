-- Reddit trends as a fallback source for non-commerce niches.
--
-- TikTok Creative Center is built for ad buyers — its 18 industries are all
-- commerce verticals. For essay/commentary/productivity creators it's a poor
-- fit (Productivity → Education → #graduation). Reddit hot posts give the
-- discussion-driven signal those niches need.
--
-- Per-pillar source decision (in /api/trends): if the TikTok industry match
-- score is >= 0.55, use TikTok; otherwise use Reddit. We persist the score
-- on pillars so we don't recompute embeddings on every read.
--
-- Strictly additive. Existing pillars and ideas keep working without backfill.
--
-- Run this in the Supabase SQL editor.

-- 1. Pillar → subreddit mapping + persisted industry score.
ALTER TABLE pillars
  ADD COLUMN IF NOT EXISTS reddit_subreddits         TEXT[],
  ADD COLUMN IF NOT EXISTS reddit_subreddits_locked  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tiktok_industry_score     REAL;

-- 2. Source-trend column for ideas generated from Reddit posts. Sibling to the
--    existing source_trend_hashtag (TikTok). Format: "r/<sub>:<post_id>".
ALTER TABLE content_ideas
  ADD COLUMN IF NOT EXISTS source_trend_reddit_post TEXT;

-- 3. Daily Reddit hot-post snapshot.
--    Same generated-date trick as tiktok_trends — AT TIME ZONE 'UTC' makes
--    the cast IMMUTABLE so Postgres accepts it for a generated column.
CREATE TABLE IF NOT EXISTS reddit_trends (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id       TEXT NOT NULL,
  subreddit     TEXT NOT NULL,
  title         TEXT NOT NULL,
  score         INT,
  num_comments  INT,
  permalink     TEXT,
  flair         TEXT,
  source        TEXT NOT NULL DEFAULT 'hot',
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  fetched_date  DATE GENERATED ALWAYS AS (((fetched_at AT TIME ZONE 'UTC')::date)) STORED
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_reddit_trend_per_day
  ON reddit_trends (post_id, source, fetched_date);

CREATE INDEX IF NOT EXISTS idx_reddit_trends_lookup
  ON reddit_trends (subreddit, fetched_at DESC);

-- 4. RLS — same pattern as tiktok_trends. Public reference data; reads are
--    open to any authenticated user; writes only via service-role key (cron).
ALTER TABLE reddit_trends ENABLE ROW LEVEL SECURITY;

CREATE POLICY reddit_trends_read_authenticated
  ON reddit_trends
  FOR SELECT
  TO authenticated
  USING (true);

-- Verification:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'pillars' AND column_name LIKE 'reddit_%' OR column_name = 'tiktok_industry_score';
--   -- expect 3 rows
--
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'content_ideas' AND column_name = 'source_trend_reddit_post';
--   -- expect 1 row
--
--   SELECT to_regclass('public.reddit_trends');
--   -- expect 'reddit_trends'
--
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'reddit_trends';
--   -- expect t (true)
--
--   SELECT polname FROM pg_policy WHERE polrelid = 'reddit_trends'::regclass;
--   -- expect reddit_trends_read_authenticated
