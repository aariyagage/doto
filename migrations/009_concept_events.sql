-- Concept events — append-only audit log for the concepts state machine.
--
-- Every status change, edit, validate, style, and refine writes a row here.
-- Used for:
--   - per-concept history timeline on /concepts/[id]
--   - quality-outcome metrics (save_rate, reject_rate, edit_rate per
--     pipeline_run; see docs/observability.md and the admin view in 010)
--   - prompt-iteration feedback loop in M6+
--
-- bigserial id because rows are write-heavy (every status change, every
-- edit) and we prefer ordered insertion + cheap pagination over UUID PKs.
--
-- Run this in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS concept_events (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  concept_id  UUID NOT NULL REFERENCES concepts(id)   ON DELETE CASCADE,

  event_type  TEXT NOT NULL,
  from_status TEXT,
  to_status   TEXT,

  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE concept_events
  DROP CONSTRAINT IF EXISTS concept_events_event_type_check;
ALTER TABLE concept_events
  ADD CONSTRAINT concept_events_event_type_check
  CHECK (event_type IN (
    'created',
    'validated',
    'styled',
    'reviewed',
    'saved',
    'used',
    'rejected',
    'archived',
    'edited',
    'refined'
  ));

CREATE INDEX IF NOT EXISTS concept_events_user_created
  ON concept_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS concept_events_concept_created
  ON concept_events (concept_id, created_at DESC);

CREATE INDEX IF NOT EXISTS concept_events_user_event_type_created
  ON concept_events (user_id, event_type, created_at DESC);

-- RLS — owner-only. Inserts come from API routes that already filter by
-- auth.uid(); the policy is defense-in-depth.
ALTER TABLE concept_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS concept_events_owner_select ON concept_events;
DROP POLICY IF EXISTS concept_events_owner_insert ON concept_events;
-- Append-only: no UPDATE/DELETE policies. Even owners cannot modify or
-- remove events. If a concept is deleted, ON DELETE CASCADE removes its
-- events; that's the only path for removal.

CREATE POLICY concept_events_owner_select ON concept_events
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY concept_events_owner_insert ON concept_events
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Verification:
--   SELECT to_regclass('public.concept_events');  -- expect 'concept_events'
--
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'concept_events';
--   -- expect t
--
--   SELECT polname, polcmd FROM pg_policy
--   WHERE polrelid = 'concept_events'::regclass
--   ORDER BY 1;
--   -- expect 2 rows: concept_events_owner_insert (a), concept_events_owner_select (r)
--   -- (r=SELECT, a=INSERT, w=UPDATE, d=DELETE — and we deliberately have no w/d)
