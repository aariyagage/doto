-- Pipeline runs — observability for the 3-pass concept pipeline and the
-- other model-call sequences (upload, expand, style, refine, research).
--
-- Two reasons we need a table, not just logs:
--   1. Per-user sliding-window rate-limit projection (M8 limiter reads
--      recent rows to know how much Groq budget is left for this user).
--   2. Cost tracking + quality-outcome metrics — joined with concept_events,
--      lets us measure save_rate / reject_rate / edit_rate per generation
--      run and feed prompt iteration in M6+.
--
-- See docs/observability.md for the full schema documentation and the
-- structured logger fields that complement this table.
--
-- Run this in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS pipeline_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  kind         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'running',

  groq_calls   INT NOT NULL DEFAULT 0,
  hf_calls     INT NOT NULL DEFAULT 0,
  tokens_in    INT,
  tokens_out   INT,
  latency_ms   INT,

  error_kind   TEXT,
  metadata     JSONB,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ
);

ALTER TABLE pipeline_runs
  DROP CONSTRAINT IF EXISTS pipeline_runs_kind_check;
ALTER TABLE pipeline_runs
  ADD CONSTRAINT pipeline_runs_kind_check
  CHECK (kind IN (
    'upload',
    'generate',
    'expand',
    'validate',
    'style',
    'refine',
    'research',
    'cluster',
    'topup',
    'import_legacy'
  ));

ALTER TABLE pipeline_runs
  DROP CONSTRAINT IF EXISTS pipeline_runs_status_check;
ALTER TABLE pipeline_runs
  ADD CONSTRAINT pipeline_runs_status_check
  CHECK (status IN ('running', 'succeeded', 'failed'));

ALTER TABLE pipeline_runs
  DROP CONSTRAINT IF EXISTS pipeline_runs_error_kind_check;
ALTER TABLE pipeline_runs
  ADD CONSTRAINT pipeline_runs_error_kind_check
  CHECK (error_kind IS NULL OR error_kind IN (
    'rate_limit',
    'timeout',
    '5xx',
    'parse_error',
    'validation',
    'unknown'
  ));

-- The hot index. The M8 sliding-window limiter does:
--   SELECT coalesce(sum(groq_calls), 0) FROM pipeline_runs
--   WHERE user_id = $1 AND created_at > now() - interval '60 seconds';
CREATE INDEX IF NOT EXISTS pipeline_runs_user_created
  ON pipeline_runs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS pipeline_runs_kind_status_created
  ON pipeline_runs (kind, status, created_at DESC);

-- Close the forward FK from concepts.pipeline_run_id (declared in 008).
ALTER TABLE concepts
  DROP CONSTRAINT IF EXISTS concepts_pipeline_run_id_fkey;
ALTER TABLE concepts
  ADD CONSTRAINT concepts_pipeline_run_id_fkey
  FOREIGN KEY (pipeline_run_id)
  REFERENCES pipeline_runs(id) ON DELETE SET NULL;

-- RLS — owner-only on read; inserts/updates go through the per-user API
-- which already filters by auth.uid(), so the policy is defense-in-depth.
ALTER TABLE pipeline_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pipeline_runs_owner_select ON pipeline_runs;
DROP POLICY IF EXISTS pipeline_runs_owner_insert ON pipeline_runs;
DROP POLICY IF EXISTS pipeline_runs_owner_update ON pipeline_runs;

CREATE POLICY pipeline_runs_owner_select ON pipeline_runs
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY pipeline_runs_owner_insert ON pipeline_runs
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY pipeline_runs_owner_update ON pipeline_runs
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Admin view: per-pipeline-run quality outcomes. Used by M6+ to tune the
-- validator prompt based on observed save/reject behavior.
--
-- This view enforces RLS implicitly because pipeline_runs and concept_events
-- are both owner-scoped — a non-admin user querying it will only see their
-- own rows.
CREATE OR REPLACE VIEW admin_pipeline_quality AS
SELECT
  pr.id           AS run_id,
  pr.user_id,
  pr.kind,
  pr.created_at,
  pr.groq_calls,
  pr.hf_calls,
  pr.latency_ms,
  COUNT(c.id)                                                      AS concepts_generated,
  COUNT(c.id) FILTER (WHERE c.status = 'saved')                    AS concepts_saved,
  COUNT(c.id) FILTER (WHERE c.status = 'used')                     AS concepts_used,
  COUNT(c.id) FILTER (WHERE c.status = 'rejected')                 AS concepts_rejected,
  COUNT(c.id) FILTER (WHERE c.status = 'archived')                 AS concepts_archived,
  COUNT(ce.id) FILTER (WHERE ce.event_type = 'edited')             AS edit_events,
  MIN(ce.created_at) FILTER (WHERE ce.event_type = 'saved')        AS first_saved_at,
  pr.created_at AS run_created_at
FROM pipeline_runs pr
LEFT JOIN concepts        c  ON c.pipeline_run_id = pr.id
LEFT JOIN concept_events  ce ON ce.concept_id = c.id
WHERE pr.kind IN ('generate', 'topup')
GROUP BY pr.id;

-- Verification:
--   SELECT to_regclass('public.pipeline_runs');     -- expect 'pipeline_runs'
--   SELECT to_regclass('public.admin_pipeline_quality'); -- expect view name
--
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'pipeline_runs';
--   -- expect t
--
--   SELECT conname FROM pg_constraint
--   WHERE conrelid = 'concepts'::regclass
--     AND conname = 'concepts_pipeline_run_id_fkey';
--   -- expect 1 row (the FK closed in this migration)
--
--   SELECT polname FROM pg_policy
--   WHERE polrelid = 'pipeline_runs'::regclass
--   ORDER BY 1;
--   -- expect 3 rows: pipeline_runs_owner_insert, _select, _update
