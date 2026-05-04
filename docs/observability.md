# Observability

How we log, trace, and measure the vNext concept pipeline. Two surfaces: the `pipeline_runs` table (durable record) and the structured logger (per-request stream).

---

## Table of contents

1. [Why both a table and logs](#why-both-a-table-and-logs)
2. [`pipeline_runs` schema](#pipeline_runs-schema)
3. [Structured log fields](#structured-log-fields)
4. [Trace ID propagation](#trace-id-propagation)
5. [Quality outcome tracking](#quality-outcome-tracking)
6. [Admin SQL views](#admin-sql-views)
7. [Rate-limit visibility](#rate-limit-visibility)
8. [Privacy posture](#privacy-posture)

---

## Why both a table and logs

Logs are streams. They're great for "what happened on this request" but bad for "how much Groq quota has user X burned this hour."

`pipeline_runs` is a durable, queryable record of every model-call sequence. It powers:

- Per-user rate-limit projection (M8 sliding-window limiter reads recent rows).
- Cost tracking — total Groq calls, total tokens, per kind, per user, per day.
- Quality dashboard — joined with `concept_events`, lets us measure save/reject/edit rates per generation run.

Logs handle the rest: per-line traceable error context, retry counts, payload-too-large signals, etc.

## `pipeline_runs` schema

(Defined in `migrations/010_pipeline_runs.sql` — this section is the source of truth for the column meanings.)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | Reused as `trace_id` where 1:1 |
| `user_id` | uuid not null | RLS owner |
| `kind` | text | `upload`, `generate`, `expand`, `validate`, `style`, `refine` |
| `status` | text | `running`, `succeeded`, `failed` |
| `groq_calls` | int default 0 | Cumulative count for this run |
| `hf_calls` | int default 0 | Same |
| `tokens_in` | int | Sum across all model calls |
| `tokens_out` | int | Sum across all model calls |
| `latency_ms` | int | End-to-end |
| `error_kind` | text | `rate_limit`, `timeout`, `5xx`, `parse_error`, `validation`, `unknown` |
| `metadata` | jsonb | Free-form per-kind details (concept_id, candidate count, dedup counts, etc.) |
| `created_at`, `finished_at` | timestamptz | |

`concepts.pipeline_run_id` FK lets us trace any concept back to the run that produced it.

RLS: owner-only on all four verbs.

Indexes: `(user_id, created_at desc)`, `(kind, status, created_at)`.

## Structured log fields

`src/lib/logger.ts` is extended (in M2) to always emit these fields when present in the request context:

```
trace_id
pipeline_run_id
user_id
route
kind            (upload | generate | expand | style | refine | research | …)
pass            (1 | 2 | 3 | 4 — only for multi-pass routes)
model           (groq:llama-3.3-70b-versatile | groq:whisper-large-v3 | hf:miniLM)
latency_ms
tokens_in
tokens_out
retry_count
error_kind
dedup_rejected_count
dedup_reasons   (array: cosine_self | cosine_saved_concept | cosine_saved_idea | validator_rule)
quota_groq_rpm_window  (calls remaining in user's sliding 60s)
```

Logger output stays JSON in production (one line per event) so Vercel log search filters cleanly.

## Trace ID propagation

- Edge middleware (`src/middleware.ts`) generates `x-trace-id: <uuidv4>` on every authenticated request and propagates it via the request headers.
- API routes read the header (or generate one if missing) and attach it to the per-request logger context.
- When a `pipeline_runs` row is opened, `pipeline_runs.id` reuses the trace_id where 1:1; otherwise the trace_id appears in the logger context but the run gets its own UUID.
- Response headers include `x-trace-id` so the frontend can include it in error toasts ("Trace: abc123…") for fast log-correlated debugging.

**ASCII rule:** `x-trace-id` and any error-kind header values are validated through `assertAsciiHeader()` (`src/lib/utils.ts`, added in M8). UTF-8 in header values silently breaks Node fetch with ByteString errors — see commit `5f1e481` for the precedent.

## Quality outcome tracking

`concept_events` (migration 009) writes a row on every status change. Joined with `pipeline_runs.id` (via `concepts.pipeline_run_id`), this lets us compute:

- `save_rate` = saved events / generated concepts, per pipeline_run
- `reject_rate` = rejected events / generated concepts
- `edit_rate` = edited events / generated concepts
- `time_to_first_save` = `min(saved.created_at) - generated.created_at` per run

These metrics are the feedback loop for prompt iteration in M6 and beyond.

## Admin SQL views

Shipped as part of `migrations/010_pipeline_runs.sql` tail (M1 implementation, exact view definitions land then):

```sql
create or replace view admin_pipeline_quality as
select
  pr.id           as run_id,
  pr.user_id,
  pr.kind,
  pr.created_at,
  count(c.id) filter (where c.id is not null)         as concepts_generated,
  count(ce.id) filter (where ce.event_type = 'saved') as concepts_saved,
  count(ce.id) filter (where ce.event_type = 'used')  as concepts_used,
  count(ce.id) filter (where ce.event_type = 'rejected') as concepts_rejected,
  count(ce.id) filter (where ce.event_type = 'edited') as concepts_edited
from pipeline_runs pr
left join concepts c        on c.pipeline_run_id = pr.id
left join concept_events ce on ce.concept_id = c.id
where pr.kind = 'generate'
group by pr.id;
```

(Exact shape iterated when we use it in M6.)

## Rate-limit visibility

The per-user sliding-window Groq limiter (M8) reads recent `pipeline_runs` to compute remaining budget:

```sql
select coalesce(sum(groq_calls), 0)
from pipeline_runs
where user_id = $1
  and created_at > now() - interval '60 seconds';
```

If projected calls would exceed 25 in the next 60s (5-call safety margin under the 30 RPM ceiling), the route returns 429 with `Retry-After`.

## Privacy posture

- `pipeline_runs.metadata` may contain concept-id and pillar-id references but **never** raw model inputs/outputs — those are too large and would inflate the table beyond the Supabase free 500 MB cap.
- Logs may include trimmed prompt previews **only in development** (`NODE_ENV !== 'production'`); production logs include sizes (chars, tokens) but not contents.
- User IDs in logs are the Supabase `auth.uid()` UUID, not email — the email lookup happens at admin-query time only.
