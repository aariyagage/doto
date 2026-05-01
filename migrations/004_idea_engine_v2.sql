-- Idea engine v2.
-- Additive schema for the creator-aware idea engine. Strictly additive: no drops,
-- no renames, all new columns nullable or defaulted so v1 rows keep working.
-- Phase 1 only — gap detection / hybrid retrieval / scoring land in later phases
-- but the columns they need are added here so we don't churn migrations later.
-- Run this in the Supabase SQL editor.

-- transcripts: structured essence parts + hook embedding for future retrieval.
-- The legacy `essence` column stays as the source of truth until v2 backfills it.
ALTER TABLE transcripts
  ADD COLUMN IF NOT EXISTS essence_core_idea TEXT,
  ADD COLUMN IF NOT EXISTS essence_hook      TEXT,
  ADD COLUMN IF NOT EXISTS essence_takeaway  TEXT,
  ADD COLUMN IF NOT EXISTS hook_embedding    vector(384);

CREATE INDEX IF NOT EXISTS transcripts_hook_embedding_ivfflat
  ON transcripts USING ivfflat (hook_embedding vector_cosine_ops) WITH (lists = 100);

-- voice_profile: PRD §4.3 structured fields. Existing fields (tone_descriptors,
-- recurring_phrases, content_style, niche_summary, signature_argument,
-- enemy_or_foil, would_never_say) all stay and continue to be used. The v2
-- prompt extracts these new ones in addition; the v2 idea prompt prefers the
-- new fields when present and falls back to existing fields otherwise.
ALTER TABLE voice_profile
  ADD COLUMN IF NOT EXISTS primary_style    TEXT,
  ADD COLUMN IF NOT EXISTS secondary_styles TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS hook_patterns    TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS sentence_style   TEXT,
  ADD COLUMN IF NOT EXISTS energy           TEXT;

-- content_ideas: angle + packaging type + score + idea embedding + source_version.
-- Phase 1 dedup is within-batch only plus a saved/used cosine check, so we add
-- the embedding column here but skip the ivfflat index until full history dedup
-- ships (Phase 2/3). source_version lets us A/B v1 vs v2 outputs in the same UI.
ALTER TABLE content_ideas
  ADD COLUMN IF NOT EXISTS angle           TEXT,
  ADD COLUMN IF NOT EXISTS packaging_type  TEXT,
  ADD COLUMN IF NOT EXISTS score           JSONB,
  ADD COLUMN IF NOT EXISTS idea_embedding  vector(384),
  ADD COLUMN IF NOT EXISTS source_version  TEXT NOT NULL DEFAULT 'v1';

-- Cross-pillar transcript similarity search. Phase 2 will use this for the 30%
-- cross-pillar slice in hybrid retrieval. We add the RPC now so v2 code can
-- evolve without another migration round-trip.
CREATE OR REPLACE FUNCTION match_transcripts_by_essence(
  p_user_id           uuid,
  p_embedding         vector(384),
  p_exclude_pillar_id uuid DEFAULT NULL,
  p_limit             int  DEFAULT 5
)
RETURNS TABLE(transcript_id uuid, similarity float, essence text)
LANGUAGE sql STABLE AS $$
  SELECT
    t.id,
    1 - (MIN(t.essence_embedding <=> p_embedding)) AS similarity,
    MAX(t.essence) AS essence
  FROM transcripts t
  LEFT JOIN video_pillars vp ON vp.video_id = t.video_id
  WHERE t.user_id = p_user_id
    AND t.essence_embedding IS NOT NULL
    AND COALESCE(t.is_hidden, false) = false
    AND (p_exclude_pillar_id IS NULL OR vp.pillar_id IS DISTINCT FROM p_exclude_pillar_id)
  GROUP BY t.id
  ORDER BY MIN(t.essence_embedding <=> p_embedding) ASC
  LIMIT p_limit;
$$;
