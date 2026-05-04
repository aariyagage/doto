# Concepts Architecture

The data model and lifecycle for the new `concepts` domain — the central object between raw input (transcript, brainstorm, trend) and final output (script, published video).

This doc reflects the schema as of the latest migration. Updated whenever migrations 008+ change.

---

## Table of contents

1. [Why concepts exist](#why-concepts-exist)
2. [Data model](#data-model)
3. [Status state machine](#status-state-machine)
4. [Source kinds](#source-kinds)
5. [Relationship to legacy `content_ideas`](#relationship-to-legacy-content_ideas)
6. [Embeddings and vector search](#embeddings-and-vector-search)
7. [RPC inventory](#rpc-inventory)
8. [Backfill from legacy](#backfill-from-legacy)
9. [Open questions](#open-questions)

---

## Why concepts exist

The legacy `content_ideas` table treats every generated idea as a final output: title, hook, structure, save/use flags. That's wrong for a workspace product. A creator's actual workflow is:

1. Capture rough thought (brainstorm note, transcript essence, trend).
2. Turn rough thought into a **concept** — still editable, still rankable.
3. Iterate on the concept (rewrite hook, change pillar, add research).
4. Decide: save it, mark it used, reject it, archive it.
5. Optionally refine into a script.

`concepts` is the persistent object across steps 2–4. `content_ideas` continues to exist for legacy `/ideas` users.

## Data model

The migration files in `/migrations/008_concepts_workspace.sql`, `009_concept_events.sql`, `010_pipeline_runs.sql`, and `011_concept_rpcs.sql` are the source of truth. This section summarizes the shapes; column-level docs live in the SQL comments.

### `concepts`

- `id` uuid PK
- `user_id` uuid → `auth.users(id)` ON DELETE CASCADE
- `pillar_id` uuid → `pillars(id)` ON DELETE SET NULL (nullable)
- `title` text NOT NULL, `hook`, `angle`, `structure` (jsonb)
- `research_summary`, `ai_reason`, `score` (jsonb: `{novelty, fit, specificity, composite}`)
- `voice_adapted_title`, `voice_adapted_hook`, `voice_adapted_text` — populated by PASS 3 stylist; nullable until styled
- `status` text — see [state machine](#status-state-machine), default `draft`
- `source_kind` text — see [source kinds](#source-kinds)
- `source_brainstorm_id` / `source_transcript_id` / `source_trend_hashtag` / `source_trend_reddit_post` / `source_content_idea_id` — provenance pointers; one of these is meaningful per `source_kind`
- `concept_embedding` vector(384) — `sentence-transformers/all-MiniLM-L6-v2`
- `pipeline_run_id` uuid → `pipeline_runs(id)` ON DELETE SET NULL
- `created_at`, `updated_at`, `reviewed_at`, `saved_at`, `used_at`

Indexes: `(user_id, status)`, `(user_id, pillar_id, status) WHERE pillar_id IS NOT NULL`, `(pipeline_run_id)`, `(source_content_idea_id)`, IVFFlat on `concept_embedding` (lists=100, vector_cosine_ops).

### `brainstorm_notes`

- `id`, `user_id` (CASCADE)
- `raw_text` text NOT NULL (cap 2000 chars at API boundary)
- `expanded_text` text (Groq-cleaned version after `/api/brainstorm/[id]/expand`)
- `cluster_id` uuid (soft cluster grouping; nullable until `/api/brainstorm/cluster` runs)
- `pillar_id` uuid → `pillars(id)` ON DELETE SET NULL
- `note_embedding` vector(384)
- `status` text — `inbox` / `clustered` / `converted` / `archived`
- `converted_concept_id` uuid → `concepts(id)` ON DELETE SET NULL
- `created_at`, `updated_at`

Indexes: `(user_id, status, created_at desc)`, `(user_id, cluster_id) WHERE cluster_id IS NOT NULL`, IVFFlat on `note_embedding`.

### `concept_events`

- `id` BIGSERIAL PK (write-heavy; ordered insertion preferred over UUID)
- `user_id`, `concept_id` (both CASCADE on parent delete)
- `event_type` text — see [event types](#event-types)
- `from_status`, `to_status`, `metadata` (jsonb)
- `created_at`

Indexes: `(user_id, created_at desc)`, `(concept_id, created_at desc)`, `(user_id, event_type, created_at desc)`.

**Append-only:** RLS has SELECT and INSERT policies only. No UPDATE or DELETE. Removal is via `ON DELETE CASCADE` from the parent concept.

### `pipeline_runs`

See `docs/observability.md` for the full schema and field semantics.

### Event types

Allowed values for `concept_events.event_type`: `created`, `validated`, `styled`, `reviewed`, `saved`, `used`, `rejected`, `archived`, `edited`, `refined`.

## Status state machine

```
       (created)
           |
           v
     [ draft ] ----edit/research---> [ reviewed ]
        |  |                            |  |
        |  |                            |  |
        |  +--save----+   +--save-------+  |
        |             |   |                |
        |             v   v                |
        |          [ saved ]               |
        |             |                    |
        |             +--mark used--+      |
        |                           |      |
        |                           v      |
        |                       [ used ]   |
        |                                  |
        +--reject--> [ rejected ]----------+
                          |
                          v
                     [ archived ]
```

Allowed transitions (enforced at API layer + checked by tests):

- `draft → reviewed | saved | rejected | archived`
- `reviewed → saved | rejected | archived`
- `saved → used | rejected | archived`
- `used → archived`
- `rejected → draft | archived`
- `archived → draft` (un-archive)

Every transition writes a `concept_events` row.

## Source kinds

`concepts.source_kind` distinguishes provenance:

| `source_kind` | Created by | Source FKs |
|---|---|---|
| `brainstorm` | promoting a `brainstorm_notes` row | `source_brainstorm_id` |
| `transcript` | post-upload auto-generation | `source_transcript_id` |
| `trend` | trend-anchored generation | `source_trend_hashtag` or `source_trend_reddit_post` |
| `manual` | user typed directly into `/concepts` | none |
| `autogen` | post-essence top-up | optionally `source_transcript_id` |

## Relationship to legacy `content_ideas`

- `content_ideas` is **not modified** by vNext.
- `/ideas` (legacy UI) reads/writes `content_ideas` only.
- `/concepts` (new UI) reads/writes `concepts` only.
- During concept generation's dedup pass, the validator queries `content_ideas` (saved + used rows) read-only so we never re-suggest something already in legacy.
- Optional one-shot import via `POST /api/concepts/import-legacy` lazily promotes saved/used v2 `content_ideas` into `concepts` with `source_content_idea_id` set. Idempotent, opt-in.

After vNext fully ships and stabilizes (see `docs/migration-vnext.md` cutover plan), `/ideas` becomes a redirect to `/concepts?legacy=1`. The `content_ideas` table itself is retained indefinitely for audit; v1 row deletion is a separate post-merge cleanup PR.

## Embeddings and vector search

- `concepts.concept_embedding` — `vector(384)` from `sentence-transformers/all-MiniLM-L6-v2`. Embedded once at PASS 1 generation; never re-embedded unless title/hook is edited by the user.
- `brainstorm_notes.note_embedding` — same model, same dimension. Embedded on note creation.
- IVFFlat indexes on both, lists=100, vector_cosine_ops.

Cosine threshold conventions (matches existing v2 pipeline):

- Concept dedup (within batch + against saved/used history): **0.85** reject.
- Brainstorm soft-cluster: **0.78** join cluster.
- Pillar near-duplicate (existing): **0.82** reject.

## RPC inventory

(Defined in `migrations/011_concept_rpcs.sql` — fill in once M1 lands.)

- `match_concepts_by_embedding(uid uuid, q vector(384), threshold float, k int)` — returns owner-only concept matches above threshold.
- `match_brainstorm_by_embedding(uid uuid, q vector(384), threshold float, k int)` — same shape for brainstorm notes.

All RPCs filter by `user_id` server-side. The API layer always passes `session.user.id` from the server-side Supabase client; client-supplied user IDs are never trusted.

## Backfill from legacy

`POST /api/concepts/import-legacy` runs:

```sql
insert into concepts (..., source_content_idea_id, status, ...)
select
  ...,
  ci.id as source_content_idea_id,
  case when ci.is_used then 'used'
       when ci.is_saved then 'saved'
       else 'archived' end as status,
  ...
from content_ideas ci
where ci.user_id = auth.uid()
  and ci.source_version = 'v2'
  and ci.is_saved = true
  and not exists (
    select 1 from concepts c2
    where c2.source_content_idea_id = ci.id
  );
```

Idempotent. v1 rows are never imported (they lack `idea_embedding`).

## Open questions

(Append as they arise during M2+.)

- Whether `concept_events` should also fire on `content_ideas` legacy mutations for unified analytics, or stay concepts-only.
- Whether to expose `concept_embedding` directly to the UI for "find similar concepts" search before M6 research pass, or keep it backend-only.
