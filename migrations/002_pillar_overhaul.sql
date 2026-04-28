-- Pillar overhaul.
-- Adds per-transcript essences, pillar embeddings + descriptions, series flags,
-- and a richer source_origin so manual user contributions survive regenerates.
-- Run this in the Supabase SQL editor.

-- pgvector extension (already enabled because transcripts.embedding is vector(384),
-- but make this migration self-contained).
CREATE EXTENSION IF NOT EXISTS vector;

-- pillars: descriptions, embeddings, series flags, richer source.
ALTER TABLE pillars
  ADD COLUMN IF NOT EXISTS description    TEXT,
  ADD COLUMN IF NOT EXISTS embedding      vector(384),
  ADD COLUMN IF NOT EXISTS is_series      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS series_signals TEXT[],
  ADD COLUMN IF NOT EXISTS source_origin  TEXT,
  ADD COLUMN IF NOT EXISTS last_tagged_at TIMESTAMPTZ;

-- Backfill source_origin from the existing free-text source column. Anything we
-- don't recognize falls through to 'ai_detected' so old rows behave like AI ones.
UPDATE pillars
SET source_origin = CASE
    WHEN source = 'ai_detected' THEN 'ai_detected'
    ELSE 'ai_detected'
  END
WHERE source_origin IS NULL;

ALTER TABLE pillars
  ALTER COLUMN source_origin SET NOT NULL,
  ALTER COLUMN source_origin SET DEFAULT 'ai_detected';

-- Constrain to the four valid values. New ones must be added here on purpose.
ALTER TABLE pillars
  DROP CONSTRAINT IF EXISTS pillars_source_origin_check;
ALTER TABLE pillars
  ADD CONSTRAINT pillars_source_origin_check
  CHECK (source_origin IN ('ai_detected', 'ai_series', 'user_series', 'user_manual'));

-- Case-insensitive uniqueness per user. Catches race-create dupes at the DB.
CREATE UNIQUE INDEX IF NOT EXISTS pillars_user_name_lower_uniq
  ON pillars (user_id, lower(name));

-- Cosine search over pillar embeddings (small per-user list, lists=50 is plenty).
CREATE INDEX IF NOT EXISTS pillars_embedding_ivfflat
  ON pillars USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);

-- transcripts: per-video essences and their embeddings.
ALTER TABLE transcripts
  ADD COLUMN IF NOT EXISTS essence              TEXT,
  ADD COLUMN IF NOT EXISTS essence_embedding    vector(384),
  ADD COLUMN IF NOT EXISTS essence_generated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS transcripts_essence_embedding_ivfflat
  ON transcripts USING ivfflat (essence_embedding vector_cosine_ops) WITH (lists = 100);

-- Cosine match: returns top-N pillars ranked by similarity to a query embedding.
-- We expose this as an RPC so the comparison stays in SQL and we don't have to
-- pull every pillar embedding into Node on every upload.
CREATE OR REPLACE FUNCTION match_pillar_by_embedding(
  p_user_id   uuid,
  p_embedding vector(384),
  p_threshold float DEFAULT 0
)
RETURNS TABLE(id uuid, name text, description text, is_series boolean, similarity float)
LANGUAGE sql STABLE AS $$
  SELECT
    p.id,
    p.name,
    p.description,
    p.is_series,
    1 - (p.embedding <=> p_embedding) AS similarity
  FROM pillars p
  WHERE p.user_id = p_user_id
    AND p.embedding IS NOT NULL
    AND 1 - (p.embedding <=> p_embedding) >= p_threshold
  ORDER BY p.embedding <=> p_embedding
  LIMIT 5;
$$;
