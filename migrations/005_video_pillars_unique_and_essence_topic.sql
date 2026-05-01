-- Lock down video_pillars against duplicate (video_id, pillar_id) rows,
-- and persist the v2 essence topic in its own column.
--
-- Background. Two code paths in the pillar pipeline both insert into
-- video_pillars for the same (video, pillar): tag-or-create's fast-tag branch
-- (cosine ≥ 0.55) and series-detector's per-upload pass. Without a UNIQUE
-- constraint, both rows persisted, which surfaced as the same pillar chip
-- rendering twice on the /videos card. The constraint is the durable fix; the
-- in-code "tolerate duplicate" handlers in tag-or-create and series-detector
-- already swallow 23505 unique violations, so adding the constraint is safe
-- for the existing call sites.
--
-- essence_topic. The v2 essence prompt now returns a `topic` field (concrete
-- 2-6 word noun phrase). It was being concatenated into the legacy `essence`
-- column only; promoting it to a column lets tag-or-create / series-detector
-- read it cleanly without parsing the `topic // core_idea // takeaway` string.
-- Strictly additive — nullable for legacy rows.
--
-- Run this in the Supabase SQL editor.

-- 1. Dedupe existing video_pillars rows so the UNIQUE constraint can be added
--    without rejection. ctid is the physical row identifier — using "<" picks
--    one survivor deterministically per (video_id, pillar_id) pair.
DELETE FROM video_pillars vp1
USING video_pillars vp2
WHERE vp1.ctid < vp2.ctid
  AND vp1.video_id = vp2.video_id
  AND vp1.pillar_id = vp2.pillar_id;

-- 2. Prevent future duplicates. The constraint name follows Postgres' default
--    naming so it's easy to reference if/when needed in code.
ALTER TABLE video_pillars
  ADD CONSTRAINT video_pillars_video_id_pillar_id_key UNIQUE (video_id, pillar_id);

-- 3. v2 essence topic. Nullable — older transcripts won't have it set; the
--    pillar pipeline falls back to leaving subtopics empty for those rows.
ALTER TABLE transcripts
  ADD COLUMN IF NOT EXISTS essence_topic TEXT;

-- Verification:
--   SELECT conname FROM pg_constraint WHERE conname = 'video_pillars_video_id_pillar_id_key';
--   -- expect 1 row
--
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'transcripts' AND column_name = 'essence_topic';
--   -- expect 1 row
