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

(Filled in by M1 once migrations 008–011 land. The table definitions in `migrations/008_concepts_workspace.sql` and `migrations/009_concept_events.sql` are the source of truth.)

Top-level tables:

- `concepts` — the central workspace object.
- `brainstorm_notes` — raw user-typed thoughts; can be promoted to concepts.
- `concept_events` — append-only audit/quality log.
- `pipeline_runs` — observability layer (see `docs/observability.md`).

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
