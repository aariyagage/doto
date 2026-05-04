# API Reference (vNext)

Every new `/api/*` route added by the concepts workspace migration. Each row lists the auth requirement, payload, model passes triggered, and free-tier cost.

This doc is updated whenever a new route lands. Existing legacy routes (`/api/ideas/*`, `/api/voice-profile`, `/api/videos/process`, `/api/pillars/*`, `/api/transcripts/*`, `/api/trends`, `/api/dashboard/stats`) stay as-is — their behavior is documented in `docs/idea-engine-v2.md` and `docs/pillar-system.md`.

---

## Table of contents

1. [Auth model](#auth-model)
2. [Brainstorm routes](#brainstorm-routes)
3. [Concepts routes](#concepts-routes)
4. [Research route](#research-route)
5. [Pillar workspace routes (additions)](#pillar-workspace-routes-additions)
6. [Cost summary](#cost-summary)
7. [Error response shape](#error-response-shape)

---

## Auth model

All vNext routes require an authenticated Supabase session:

- The route's handler obtains a server-side Supabase client via `createServerClient()` from `src/lib/supabase/server.ts`.
- The handler calls `supabase.auth.getUser()` and 401s if there's no session.
- Mutations always use `auth.uid()` from the server-side session. Client-supplied `user_id` fields are ignored.
- RLS on every new table enforces owner-only access as a defense-in-depth.

Routes gated behind feature flags return **503 Service Unavailable** with `{error: "feature_disabled", feature: "<flag_name>"}` when their flag is off, rather than 404, so the client can distinguish "not found" from "not enabled."

## Brainstorm routes

Gated by `BRAINSTORM_INBOX` (which requires `CONCEPT_PIPELINE`).

### `POST /api/brainstorm`

Create a brainstorm note. Embeds `raw_text` immediately so cluster + promote can use the embedding.

- **Body:** `{raw_text: string (≤2000 chars), pillar_id?: uuid}`
- **Returns:** the created `brainstorm_notes` row.
- **Cost:** 0 Groq, 1 HF.

### `GET /api/brainstorm`

List the caller's notes.

- **Query:** `status=inbox|clustered|converted|archived` (default: all non-archived).
- **Returns:** `{notes: BrainstormNote[]}`, ordered by `created_at desc`.
- **Cost:** 0.

### `PATCH /api/brainstorm/[id]`

Edit raw_text, change pillar_id, change status (e.g. archive).

- **Body:** partial `{raw_text?, pillar_id?, status?}`.
- **Returns:** updated row.
- **Cost:** 0 (unless raw_text changed → 1 HF re-embed; flagged in response).

### `DELETE /api/brainstorm/[id]`

Hard delete.

- **Cost:** 0.

### `POST /api/brainstorm/[id]/expand`

Run Groq Llama-3.3 to clean and sharpen the rough thought into 1–3 clearer sentences. Writes `expanded_text`.

- **Body:** none.
- **Returns:** `{expanded_text: string}`.
- **Cost:** 1 Groq.

### `POST /api/brainstorm/cluster`

Soft-cluster all `inbox` notes for the caller via cosine similarity (≥0.78 join). Assigns `cluster_id` to each note. Pure pgvector — no model calls.

- **Body:** none.
- **Returns:** `{clusters: {cluster_id, note_ids[]}[]}`.
- **Cost:** 0.

### `POST /api/brainstorm/[id]/promote`

Convert a brainstorm note into a draft concept. Runs PASS 1 only, seeded by the note's text + pillar context.

- **Body:** `{pillar_id?: uuid}` (defaults to note's existing `pillar_id`).
- **Returns:** `{concept: Concept}` with `status='draft'`.
- **Cost:** 1 Groq + 1 HF (for concept embedding).

## Concepts routes

Gated by `CONCEPT_PIPELINE`.

### `GET /api/concepts`

List concepts with filters.

- **Query:** `status?`, `pillar_id?`, `q?` (text query — runs HF embed + cosine search if present).
- **Returns:** `{concepts: Concept[]}`.
- **Cost:** 0–1 HF (only if `q` provided).

### `POST /api/concepts/generate`

Run the **3-pass pipeline**: PASS 1 generates N candidates, PASS 2 validates and scores, PASS 3 styles top K eagerly. Inserts N rows; top-K have `voice_adapted_text` populated, tail rows are lazy.

- **Body:** `{pillar_id: uuid, count?: int (default 5), seed?: {kind: 'brainstorm'|'transcript'|'trend', ref_id: string}}`.
- **Returns:** `{pipeline_run_id: uuid, concepts: Concept[]}`.
- **Cost:** 3 Groq + 1 HF batched (regardless of N).

### `GET /api/concepts/[id]`

Fetch concept + events timeline.

- **Returns:** `{concept: Concept, events: ConceptEvent[]}`.
- **Cost:** 0.

### `PATCH /api/concepts/[id]`

Edit fields and/or change status. Writes a `concept_events` row.

- **Body:** partial `{title?, hook?, angle?, structure?, status?, pillar_id?}`.
- **Returns:** updated row.
- **Cost:** 0 (1 HF re-embed only if title or hook changed).

### `POST /api/concepts/[id]/style`

Lazy stylist: runs PASS 3 on a concept whose `voice_adapted_text` is null.

- **Body:** none.
- **Returns:** `{voice_adapted_title, voice_adapted_hook, voice_adapted_text}`.
- **Cost:** 1 Groq.

### `POST /api/concepts/[id]/refine`

PASS 4 — outline or full script. Gated by `SCRIPT_REFINER` (off in vNext merge; lands in M10).

- **Body:** `{mode: 'outline'|'script'}`.
- **Returns:** `{voice_adapted_text: string}` (extended).
- **Cost:** 1 Groq.

### `POST /api/concepts/import-legacy`

One-shot opt-in backfill from `content_ideas` (saved/used v2 rows) into `concepts`. Idempotent — won't duplicate-import.

- **Body:** none.
- **Returns:** `{imported: int}`.
- **Cost:** 0.

### `POST /api/pillars/[id]/concepts/topup`

Concept top-up for a pillar (replaces `auto-ideas` when `CONCEPT_PIPELINE=true`). Same 3-pass pipeline as `/api/concepts/generate` with `count=2` (auto-topup default).

- **Body:** none.
- **Returns:** `{pipeline_run_id, concepts: Concept[]}`.
- **Cost:** 3 Groq + 1 HF batched.

## Research route

Gated by `RESEARCH_PASS`. Independent of `CONCEPT_PIPELINE` (a future surface might call it standalone).

### `POST /api/research`

Pulls own-corpus context (transcripts via `match_transcripts_by_essence`, recent `tiktok_trends` / `reddit_trends` for the pillar's industry) and summarizes. **No web scraping.**

- **Body:** `{topic: string, pillar_id?: uuid}`.
- **Returns:** `{summary: string, citations: {source, ref_id, snippet}[]}`.
- **Cost:** 1 Groq.

## Pillar workspace routes (additions)

Gated by `WORKSPACE_V1`.

### `POST /api/pillars/merge`

Move all concepts and `video_pillars` rows from the source pillar into the target, then delete the source.

- **Body:** `{from_id: uuid, into_id: uuid}`.
- **Returns:** `{moved_concepts: int, moved_videos: int}`.
- **Cost:** 0.

### `POST /api/pillars/split`

Create a new pillar and move a specified set of concepts into it.

- **Body:** `{pillar_id: uuid, concept_ids: uuid[], new_name: string}`.
- **Returns:** `{new_pillar: Pillar, moved_concepts: int}`.
- **Cost:** 1 HF (new pillar embedding).

## Cost summary

| Action | Groq | HF |
|---|---|---|
| `POST /api/brainstorm` | 0 | 1 |
| `POST /api/brainstorm/[id]/expand` | 1 | 0 |
| `POST /api/brainstorm/cluster` | 0 | 0 |
| `POST /api/brainstorm/[id]/promote` | 1 | 1 |
| `POST /api/concepts/generate` | 3 | 1 batched |
| `POST /api/concepts/[id]/style` | 1 | 0 |
| `POST /api/concepts/[id]/refine` | 1 | 0 |
| `POST /api/research` | 1 | 0 |
| `POST /api/pillars/[id]/concepts/topup` | 3 | 1 batched |
| `POST /api/pillars/split` | 0 | 1 |

Per-user sliding-window Groq limiter (M8): max 25 calls / 60s under the 30 RPM ceiling.

## Error response shape

All errors return `{error: string, error_kind?: string, trace_id?: string}` with appropriate status:

- `400` — validation (`error_kind: 'validation'`)
- `401` — no session
- `403` — RLS denied / not owner
- `404` — concept/note not found
- `429` — rate limit (`error_kind: 'rate_limit'`, `Retry-After` header set)
- `500` — internal (`error_kind: 'unknown'`)
- `502` — upstream model error (`error_kind: '5xx'`)
- `503` — feature flag disabled (`error_kind: 'feature_disabled'`)
- `504` — upstream timeout (`error_kind: 'timeout'`)

All response headers, including `x-trace-id` and any `error_kind` header values, are validated ASCII via `assertAsciiHeader()` (M8) — UTF-8 in header values silently breaks Node fetch.
