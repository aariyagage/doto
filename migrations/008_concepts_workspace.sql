-- Concepts workspace.
-- Adds the new central workspace object (concepts) and the brainstorm
-- inbox (brainstorm_notes) that feeds into it. Strictly additive: existing
-- tables (content_ideas, pillars, transcripts, voice_profile) are untouched.
--
-- Concepts is the persistent object across the creator workflow:
--   raw input -> draft concept -> reviewed -> saved -> used -> archived
--
-- Voice profile is deliberately NOT a column on this table. PASS 3 (the
-- stylist) writes voice_adapted_title/hook/text after the concept already
-- exists. PASS 1 (concept generator) and PASS 2 (validator) never see the
-- voice profile. See docs/prompt-architecture.md for the rule.
--
-- Run this in the Supabase SQL editor.

CREATE EXTENSION IF NOT EXISTS vector;

-- 1. brainstorm_notes — captured user-typed thoughts.
--    converted_concept_id FK is added at the end (circular dependency with
--    concepts.source_brainstorm_id; brainstorm_notes is created first so
--    concepts.source_brainstorm_id resolves immediately).
CREATE TABLE IF NOT EXISTS brainstorm_notes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  raw_text        TEXT NOT NULL,
  expanded_text   TEXT,
  cluster_id      UUID,
  pillar_id       UUID REFERENCES pillars(id) ON DELETE SET NULL,
  note_embedding  vector(384),
  status          TEXT NOT NULL DEFAULT 'inbox',
  converted_concept_id UUID, -- FK added below
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE brainstorm_notes
  DROP CONSTRAINT IF EXISTS brainstorm_notes_status_check;
ALTER TABLE brainstorm_notes
  ADD CONSTRAINT brainstorm_notes_status_check
  CHECK (status IN ('inbox', 'clustered', 'converted', 'archived'));

CREATE INDEX IF NOT EXISTS brainstorm_notes_user_status_created
  ON brainstorm_notes (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS brainstorm_notes_user_cluster
  ON brainstorm_notes (user_id, cluster_id)
  WHERE cluster_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS brainstorm_notes_embedding_ivfflat
  ON brainstorm_notes USING ivfflat (note_embedding vector_cosine_ops)
  WITH (lists = 100);

-- 2. concepts — the central workspace object.
--    source_brainstorm_id resolves now that brainstorm_notes exists.
--    pipeline_run_id has no FK here; the FK is added in 010 once
--    pipeline_runs exists. This avoids forward references in this file.
CREATE TABLE IF NOT EXISTS concepts (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pillar_id                UUID REFERENCES pillars(id) ON DELETE SET NULL,

  -- Topical / structural content from PASS 1. Untouched by PASS 3.
  title                    TEXT NOT NULL,
  hook                     TEXT,
  angle                    TEXT,
  structure                JSONB,

  -- Validation + research artifacts.
  research_summary         TEXT,
  ai_reason                TEXT,
  score                    JSONB, -- {novelty, fit, specificity, composite}

  -- Voice-adapted output from PASS 3 stylist. Nullable until PASS 3 runs;
  -- lazy-styled tail concepts populate these on first card open.
  voice_adapted_title      TEXT,
  voice_adapted_hook       TEXT,
  voice_adapted_text       TEXT,

  -- Status state machine. Allowed transitions enforced at API layer +
  -- documented in docs/concepts-architecture.md.
  status                   TEXT NOT NULL DEFAULT 'draft',

  -- Provenance. Exactly one of the source_* fields below is meaningful per
  -- source_kind; the rest stay NULL. Not enforced as a constraint to keep
  -- backfill (import-legacy) simple.
  source_kind              TEXT NOT NULL,
  source_brainstorm_id     UUID REFERENCES brainstorm_notes(id) ON DELETE SET NULL,
  source_transcript_id     UUID REFERENCES transcripts(id)      ON DELETE SET NULL,
  source_trend_hashtag     TEXT,
  source_trend_reddit_post TEXT,
  source_content_idea_id   UUID REFERENCES content_ideas(id)    ON DELETE SET NULL,

  -- Embeddings + observability.
  concept_embedding        vector(384),
  pipeline_run_id          UUID, -- FK added in migration 010

  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at              TIMESTAMPTZ,
  saved_at                 TIMESTAMPTZ,
  used_at                  TIMESTAMPTZ
);

ALTER TABLE concepts
  DROP CONSTRAINT IF EXISTS concepts_status_check;
ALTER TABLE concepts
  ADD CONSTRAINT concepts_status_check
  CHECK (status IN ('draft', 'reviewed', 'saved', 'used', 'rejected', 'archived'));

ALTER TABLE concepts
  DROP CONSTRAINT IF EXISTS concepts_source_kind_check;
ALTER TABLE concepts
  ADD CONSTRAINT concepts_source_kind_check
  CHECK (source_kind IN ('brainstorm', 'transcript', 'trend', 'manual', 'autogen'));

CREATE INDEX IF NOT EXISTS concepts_user_status
  ON concepts (user_id, status);

CREATE INDEX IF NOT EXISTS concepts_user_pillar_status
  ON concepts (user_id, pillar_id, status)
  WHERE pillar_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS concepts_pipeline_run
  ON concepts (pipeline_run_id)
  WHERE pipeline_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS concepts_source_content_idea
  ON concepts (source_content_idea_id)
  WHERE source_content_idea_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS concepts_embedding_ivfflat
  ON concepts USING ivfflat (concept_embedding vector_cosine_ops)
  WITH (lists = 100);

-- 3. Close the circular FK: brainstorm_notes.converted_concept_id -> concepts(id)
ALTER TABLE brainstorm_notes
  DROP CONSTRAINT IF EXISTS brainstorm_notes_converted_concept_id_fkey;
ALTER TABLE brainstorm_notes
  ADD CONSTRAINT brainstorm_notes_converted_concept_id_fkey
  FOREIGN KEY (converted_concept_id)
  REFERENCES concepts(id) ON DELETE SET NULL;

-- 4. RLS — owner-only on every verb. Per-user scoping at the DB layer is the
--    primary defense; the API also passes auth.uid() server-side.
ALTER TABLE concepts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE brainstorm_notes  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS concepts_owner_select ON concepts;
DROP POLICY IF EXISTS concepts_owner_insert ON concepts;
DROP POLICY IF EXISTS concepts_owner_update ON concepts;
DROP POLICY IF EXISTS concepts_owner_delete ON concepts;

CREATE POLICY concepts_owner_select ON concepts
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY concepts_owner_insert ON concepts
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY concepts_owner_update ON concepts
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY concepts_owner_delete ON concepts
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS brainstorm_notes_owner_select ON brainstorm_notes;
DROP POLICY IF EXISTS brainstorm_notes_owner_insert ON brainstorm_notes;
DROP POLICY IF EXISTS brainstorm_notes_owner_update ON brainstorm_notes;
DROP POLICY IF EXISTS brainstorm_notes_owner_delete ON brainstorm_notes;

CREATE POLICY brainstorm_notes_owner_select ON brainstorm_notes
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY brainstorm_notes_owner_insert ON brainstorm_notes
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY brainstorm_notes_owner_update ON brainstorm_notes
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY brainstorm_notes_owner_delete ON brainstorm_notes
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Verification:
--   SELECT to_regclass('public.concepts');           -- expect 'concepts'
--   SELECT to_regclass('public.brainstorm_notes');   -- expect 'brainstorm_notes'
--
--   SELECT relrowsecurity FROM pg_class
--   WHERE relname IN ('concepts', 'brainstorm_notes');
--   -- expect t for both
--
--   SELECT polname FROM pg_policy
--   WHERE polrelid IN ('concepts'::regclass, 'brainstorm_notes'::regclass)
--   ORDER BY 1;
--   -- expect 8 rows (4 verbs x 2 tables)
--
--   SELECT conname FROM pg_constraint
--   WHERE conrelid = 'concepts'::regclass AND contype = 'c'
--   ORDER BY 1;
--   -- expect concepts_source_kind_check, concepts_status_check
