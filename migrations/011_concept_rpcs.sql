-- Concept and brainstorm cosine-search RPCs.
--
-- Same pattern as match_pillar_by_embedding (002) and
-- match_transcripts_by_essence (004): the comparison stays in SQL so we
-- never pull every embedding into Node on every read.
--
-- Both RPCs are owner-scoped. The caller must pass p_user_id explicitly;
-- the API layer always passes session.user.id from the server-side
-- Supabase client. Combined with RLS on the underlying tables, an attacker
-- cannot retrieve another user's vectors even by spoofing p_user_id —
-- because the RLS policy filters by auth.uid() before this function ever
-- sees the rows.
--
-- Run this in the Supabase SQL editor.

-- match_concepts_by_embedding — used by:
--   - within-batch dedup at PASS 1 (also runs locally via cosine_self check)
--   - history dedup at PASS 2 (against saved/used concepts)
--   - text-query search on /concepts (when ?q= is provided)
CREATE OR REPLACE FUNCTION match_concepts_by_embedding(
  p_user_id   uuid,
  p_embedding vector(384),
  p_threshold float DEFAULT 0,
  p_limit     int   DEFAULT 10,
  p_statuses  text[] DEFAULT NULL  -- NULL = all statuses
)
RETURNS TABLE(
  id          uuid,
  title       text,
  hook        text,
  status      text,
  pillar_id   uuid,
  similarity  float
)
LANGUAGE sql STABLE AS $$
  SELECT
    c.id,
    c.title,
    c.hook,
    c.status,
    c.pillar_id,
    1 - (c.concept_embedding <=> p_embedding) AS similarity
  FROM concepts c
  WHERE c.user_id = p_user_id
    AND c.concept_embedding IS NOT NULL
    AND 1 - (c.concept_embedding <=> p_embedding) >= p_threshold
    AND (p_statuses IS NULL OR c.status = ANY(p_statuses))
  ORDER BY c.concept_embedding <=> p_embedding
  LIMIT p_limit;
$$;

-- match_brainstorm_by_embedding — used by /api/brainstorm/cluster.
-- The caller groups inbox notes by similarity; this RPC returns all notes
-- above threshold for a given query vector (typically another note's
-- embedding) so the caller can do greedy clustering in app code.
CREATE OR REPLACE FUNCTION match_brainstorm_by_embedding(
  p_user_id   uuid,
  p_embedding vector(384),
  p_threshold float DEFAULT 0.78,
  p_limit     int   DEFAULT 50,
  p_statuses  text[] DEFAULT ARRAY['inbox', 'clustered']
)
RETURNS TABLE(
  id         uuid,
  raw_text   text,
  cluster_id uuid,
  similarity float
)
LANGUAGE sql STABLE AS $$
  SELECT
    n.id,
    n.raw_text,
    n.cluster_id,
    1 - (n.note_embedding <=> p_embedding) AS similarity
  FROM brainstorm_notes n
  WHERE n.user_id = p_user_id
    AND n.note_embedding IS NOT NULL
    AND 1 - (n.note_embedding <=> p_embedding) >= p_threshold
    AND n.status = ANY(p_statuses)
  ORDER BY n.note_embedding <=> p_embedding
  LIMIT p_limit;
$$;

-- Verification:
--   SELECT proname FROM pg_proc
--   WHERE proname IN ('match_concepts_by_embedding', 'match_brainstorm_by_embedding')
--   ORDER BY 1;
--   -- expect 2 rows
--
-- Smoke test (run as an authenticated user with at least one concept):
--   SELECT id, similarity
--   FROM match_concepts_by_embedding(
--     auth.uid(),
--     (SELECT concept_embedding FROM concepts
--      WHERE user_id = auth.uid() AND concept_embedding IS NOT NULL
--      LIMIT 1),
--     0.0,
--     5
--   );
--   -- expect at least 1 row, similarity = 1.0 for self-match
