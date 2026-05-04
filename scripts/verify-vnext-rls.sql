-- Schema-level verification for migrations 008-011.
--
-- Run this in the Supabase SQL editor AFTER applying 008, 009, 010, 011.
-- Every "ok" row that prints means the migration landed correctly.
--
-- This script verifies SHAPE: tables exist, RLS is enabled, policies are
-- present, check constraints are present, FKs are wired, RPCs are
-- registered, the admin view exists.
--
-- It does NOT verify cross-user policy enforcement at runtime — Supabase
-- Studio runs as the postgres role which bypasses RLS, so a SQL-only test
-- can't simulate two authenticated users. The real cross-user RLS test
-- runs in Vitest with two Supabase auth users at M8 hardening (planned).

-- 1. Tables exist.
SELECT
  CASE WHEN to_regclass('public.concepts')         IS NOT NULL THEN 'ok' ELSE 'MISSING' END AS concepts,
  CASE WHEN to_regclass('public.brainstorm_notes') IS NOT NULL THEN 'ok' ELSE 'MISSING' END AS brainstorm_notes,
  CASE WHEN to_regclass('public.concept_events')   IS NOT NULL THEN 'ok' ELSE 'MISSING' END AS concept_events,
  CASE WHEN to_regclass('public.pipeline_runs')    IS NOT NULL THEN 'ok' ELSE 'MISSING' END AS pipeline_runs;

-- 2. RLS is enabled on all four user-owned tables.
SELECT
  relname,
  CASE WHEN relrowsecurity THEN 'ok' ELSE 'RLS DISABLED' END AS rls_state
FROM pg_class
WHERE relname IN ('concepts', 'brainstorm_notes', 'concept_events', 'pipeline_runs')
ORDER BY 1;

-- 3. Policy count per table.
--    Expected:
--      concepts:         4 (select, insert, update, delete)
--      brainstorm_notes: 4 (select, insert, update, delete)
--      concept_events:   2 (select, insert) -- append-only, no update/delete
--      pipeline_runs:    3 (select, insert, update)
SELECT
  c.relname,
  COUNT(p.polname) AS policy_count,
  string_agg(p.polname, ', ' ORDER BY p.polname) AS policies
FROM pg_class c
LEFT JOIN pg_policy p ON p.polrelid = c.oid
WHERE c.relname IN ('concepts', 'brainstorm_notes', 'concept_events', 'pipeline_runs')
GROUP BY c.relname
ORDER BY 1;

-- 4. Check constraints on concepts.
--    Expected:
--      concepts_status_check       (status in 6 values)
--      concepts_source_kind_check  (source_kind in 5 values)
SELECT conname
FROM pg_constraint
WHERE conrelid = 'concepts'::regclass AND contype = 'c'
ORDER BY 1;

-- 5. Check constraints on brainstorm_notes / pipeline_runs / concept_events.
SELECT conrelid::regclass AS table_name, conname
FROM pg_constraint
WHERE conrelid IN (
        'brainstorm_notes'::regclass,
        'pipeline_runs'::regclass,
        'concept_events'::regclass
      )
  AND contype = 'c'
ORDER BY 1, 2;

-- 6. Foreign keys closed correctly.
--    Expected:
--      brainstorm_notes_converted_concept_id_fkey -> concepts(id)  (closed in 008)
--      concepts_pipeline_run_id_fkey              -> pipeline_runs (closed in 010)
SELECT conrelid::regclass AS table_name,
       conname,
       confrelid::regclass AS references_table
FROM pg_constraint
WHERE contype = 'f'
  AND conname IN (
        'brainstorm_notes_converted_concept_id_fkey',
        'concepts_pipeline_run_id_fkey'
      )
ORDER BY 1;

-- 7. IVFFlat indexes on the embedding columns.
SELECT indexname
FROM pg_indexes
WHERE indexname IN (
        'concepts_embedding_ivfflat',
        'brainstorm_notes_embedding_ivfflat'
      )
ORDER BY 1;

-- 8. RPCs registered.
SELECT proname
FROM pg_proc
WHERE proname IN (
        'match_concepts_by_embedding',
        'match_brainstorm_by_embedding'
      )
ORDER BY 1;

-- 9. Admin view exists.
SELECT
  CASE WHEN to_regclass('public.admin_pipeline_quality') IS NOT NULL
       THEN 'ok' ELSE 'MISSING' END AS admin_pipeline_quality_view;
