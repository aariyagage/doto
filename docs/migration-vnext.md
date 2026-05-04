# Migration: vNext Creator Workspace

The runbook for evolving Doto from a transcript-and-voice-profile-driven idea generator into a creator workspace with brainstorm inbox, editable concept cards, drag/drop pillar workspace, and a research-backed 3-pass concept pipeline.

This doc is **living** — each milestone (M0–M9) updates the relevant section as work lands.

---

## Table of contents

1. [Why vNext exists](#why-vnext-exists)
2. [Branch & deployment topology](#branch--deployment-topology)
3. [Milestone status](#milestone-status)
4. [Per-milestone changelog](#per-milestone-changelog)
5. [Cutover checklist](#cutover-checklist)
6. [Rollback procedure](#rollback-procedure)
7. [Cross-references](#cross-references)

---

## Why vNext exists

Doto today is a single-pipeline LLM wrapper: video → transcript → essence → pillar → ideas. The voice profile is injected directly into idea-generation prompts, which makes generated ideas feel like remixes of what the creator already does rather than genuinely new concepts. The PRD asks for a creator workspace where:

- Creators can capture rough thoughts (brainstorm inbox) and have AI expand/cluster them.
- Pillars are draggable, mergeable, splittable, user-controllable.
- Ideas live as **concepts** with status (`draft`/`reviewed`/`saved`/`used`/`rejected`/`archived`) instead of as final outputs.
- Concept generation is **voice-agnostic**; voice/style only enters in a later refinement pass.

vNext does this without rewriting prod. New tables, new API routes, new UI surfaces all land additively behind feature flags.

## Branch & deployment topology

- `main` — current production. Stays deployed throughout vNext development. Only takes hotfixes during the vNext window.
- `release/v1` — frozen rescue branch from the pre-vNext `main` HEAD. Never receives commits. Used for one-click Vercel rollback if needed.
- `v1.0-prod-snapshot` — annotated tag at the same commit as `release/v1`'s creation point.
- `vnext-workspace` — active development branch for everything in this doc.
- Short-lived `vnext/<feature>` branches branch off `vnext-workspace`, merge back via squash PR.
- Final cutover: fast-forward merge `vnext-workspace` → `main`, tag `v2.0-vnext-cutover`.

**Single Supabase project** for both prod and vNext. Migrations 008+ are strictly additive (only new tables/indexes/RPCs; nothing altered or dropped). New tables sit empty in prod until vNext code starts writing to them. Legacy `/ideas` keeps reading `content_ideas` exactly as it does today.

**Separate Groq + HF API keys per environment** so vNext quota burn cannot starve prod's free-tier RPM/RPD windows.

Vercel: `main` stays Production. `vnext-workspace` is added as a tracked Preview branch, ideally with a stable alias (e.g. `vnext.<project>.vercel.app`) so the dogfooder always lands on the latest vNext build.

## Milestone status

| # | Milestone | Status | Notes |
|---|---|---|---|
| M0 | Branch + tooling | in progress | tag, branches, deps, vitest, doc skeletons |
| M1 | Schema (008–011) | done | additive migrations + schema-level verify script |
| M2 | Concept pipeline backend (voice-isolated) | done | 3-pass pipeline + voice-leak regression test (12/12 green) |
| M3 | Concept Library UI | done | first user-visible release; /concepts + /concepts/[id] |
| M4 | Brainstorm Inbox | done | /inbox + brainstorm.ts + brainstorm API surface |
| M5 | Pillar Workspace + DnD | done | /workspace + drag-drop + merge + split |
| M6 | Research pass + multi-candidate ranking | done | research.ts + /api/research + auto-enrichment in generate |
| M7 | Auto-ideas dual-write cutover | pending | depends on M2 |
| M8 | Hardening (rate limits, headers, E2E) | pending | depends on M3+M4+M5 |
| M9 | Prod cutover | pending | merge + flag flip |

## Per-milestone changelog

Each milestone appends a section here when it lands. Format:

> ### Mn — Title (YYYY-MM-DD)
> - what shipped
> - schema/migration changes
> - new flags introduced
> - test/coverage additions
> - any deviations from the plan

(Sections appended below as milestones complete.)

### M6 — Research pass + multi-candidate ranking (2026-05-03)

A pre-pass for `/concepts/generate` that grounds PASS 1 in real signal — the user's own past transcripts (via the existing `match_transcripts_by_essence` RPC) plus current `tiktok_trends` and `reddit_trends` rows for the pillar's industry/subreddits. **No web scraping**, no external HTTP egress; all signal comes from data we already have. The free-tier rule is preserved.

- `src/lib/concepts/research.ts` — `runResearch({supabase, userId, topic, pillarId})`. Embeds the topic (1 HF call), pulls top-5 transcripts above similarity 0.45, recent 5 TikTok trends matching the pillar's `tiktok_industry_id`, recent 5 Reddit posts from the pillar's `reddit_subreddits`, then summarizes via 1 Groq call with strict-JSON output. **Citations are deterministic** — built from the rows we pulled, not invented by the LLM, so the UI can link back to original transcripts/trends.
- `src/app/api/research/route.ts` — `POST {topic, pillar_id?}` returns `{summary, citations}`. Gated by `NEXT_PUBLIC_RESEARCH_PASS` (independent of `CONCEPT_PIPELINE` so a future standalone surface can use it). Per-user rate limit reuses the `llmGeneration` bucket. 1 Groq + 1 HF.
- `src/app/api/concepts/generate/route.ts` — wires research in. When `RESEARCH_PASS=true`:
    1. Build the topic from the seed (`brainstorm.raw_text` / `transcript.essence` / `trend.label`) or from the pillar's name + description.
    2. Call `runResearch` (try/catch, **non-fatal**: if HF cold-starts or no signal exists, generation continues without enrichment).
    3. Pass `researchSummary` to `runConceptGenerator` (PASS 1 already accepted this argument since M2; the prompt block was waiting).
    4. Persist the summary on every inserted concept's `research_summary` column so the detail page renders it (the field was already wired in M3 UI).
    5. Return `research_summary` + `research_citations` in the response so the library page can show "research-grounded" UI later.
- `src/lib/concepts/index.ts` — barrel re-exports `runResearch`, `RESEARCH_SYSTEM_MESSAGE`, types.

**Cost when flag is on:** 4 Groq + ~6 HF calls per generation (was 3 + ~5). Per-user 10/min rate limit unchanged. Under the 30 RPM Groq ceiling, the pre-pass is ~7 generations/min/user worst case — still comfortably free-tier.

What's deliberately NOT in M6:

- No external web research (no scraping, no paid APIs, no SerpAPI). Strictly own-corpus + already-cached trends.
- No citation rendering UI. The data is in the response and on the concept row; a "research" expandable section on cards/detail page is fine to add later as polish, but the underlying data exists today.
- No "research mode" toggle in the UI (e.g. let the user opt-in per generation rather than env-flag globally). Defer to M8 polish.
- No prompt-iteration tuning of the validator using collected `concept_events` data. The plan called this out as a Phase 3 deliverable but it needs real usage data first; it's a post-merge follow-up.

Verification:

- `npm test` → 12/12 (no new tests; research module is mostly a context-builder + LLM call, integration-tested by future Playwright runs).
- `npx tsc --noEmit` → clean.

### M5 — Pillar Workspace + DnD (2026-05-03)

- `src/app/workspace/page.tsx` — `/workspace` UI. Horizontally scrollable row of pillar columns (folder visual at the header using existing `displayBg` + `getPairedTextColor` helpers). Each column lists its active concepts (status in `draft`, `reviewed`, `saved`) sorted by composite score desc. Cards use `@dnd-kit/core` `useDraggable`; columns use `useDroppable`. Dropping a card on another column fires `PATCH /api/concepts/[id]` with the new `pillar_id` (optimistic update with revert-on-fail).
- Pillar header actions: rename inline (Enter saves, Esc cancels, blur autosaves), merge dropdown (lists every other pillar; click target → confirm dialog → merge), and a column-level concept count.
- Page-level **split mode** toggle: enter → cards become click-to-select with checkboxes; type a name; "split N" button creates a new pillar and moves selected concepts. All selected concepts must come from the same source pillar (validated client-side; server rejects cross-pillar mixes anyway via the explicit `pillar_id` filter).
- `src/app/api/pillars/merge/route.ts` — `POST` body `{from_id, into_id}`. Five sequential ops:
    1. Drop `video_pillars` rows that would collide with the target's existing rows on the unique `(video_id, pillar_id)` constraint.
    2. Re-point remaining `video_pillars` to `into_id`.
    3. Re-point `concepts.pillar_id` to `into_id`.
    4. Re-point legacy `content_ideas.pillar_id` to `into_id` (so `/ideas` stays consistent).
    5. Re-point `brainstorm_notes.pillar_id` to `into_id`.
    6. Delete the source pillar.
   Not transactional. If the API process dies mid-merge the data ends in a half-merged state; recovery is manual via Supabase Studio. Concept merges are user-initiated and rare so this is acceptable for v1; if it bites later, replace with a SECURITY INVOKER Postgres function.
- `src/app/api/pillars/split/route.ts` — `POST` body `{pillar_id, concept_ids[], new_name, new_description?, color?}`. Creates a new pillar with HF embedding (non-fatal if HF cold-starts; pillar persists without embedding and tag-or-create still works), moves the requested concepts. Surfaces 409 on case-insensitive name conflicts via the existing `pillars_user_name_lower_uniq` index. Rolls back the new pillar if the concept move fails.
- `src/components/AppLayout.tsx` — adds a `workspace` nav item between `concepts` and `voice`, gated on `featureFlags.workspaceV1()` (which transitively requires `conceptPipeline`).

What's deliberately NOT in M5:

- No transactional merge. Sequential ops are fine for solo creator usage.
- No drag-and-drop reordering within a column. Sort is by composite score; the workspace is for cross-pillar moves, not within-pillar ranking.
- No keyboard accessibility for drag (dnd-kit supports `useKeyboardSensor` but the activation requires more UI affordances; defer to M8 polish).
- No pillar create from `/workspace`. Stays on `/ideas` until a future polish PR.
- No undo on merge. Confirm dialog is the only safety net.

Verification:

- `npm test` → 12/12 (no new tests; merge/split + DnD lives in Playwright in M8).
- `npx tsc --noEmit` → clean.

### M4 — Brainstorm Inbox (2026-05-03)

A capture surface for rough thoughts. Three operations: expand (Groq cleanup), cluster (pgvector greedy grouping at cosine ≥0.78, no model calls), and promote (PASS 1 only seeded by the note → draft concept).

- `src/lib/concepts/brainstorm.ts` — `expandBrainstormNote`, `clusterInboxNotes`, `promoteBrainstormToDraftConcept`, `reembedBrainstormNote`. Voice-AGNOSTIC throughout. `<USER_NOTE>` fence + sanitization on the rough text before any LLM call. Cluster runs entirely in-app via cosine math; no Groq, no HF (embeddings already cached on note creation).
- `src/lib/concepts/index.ts` — barrel re-exports the new helpers.
- `src/app/api/brainstorm/route.ts` — GET list (default hides archived) + POST create. POST embeds via HF; if HF cold-starts and 503s, the note still inserts without an embedding (graceful degradation; cluster will skip it).
- `src/app/api/brainstorm/[id]/route.ts` — PATCH edit/retag/status + DELETE. Re-embeds when raw_text changes; surfaces `reembed_failed` flag if HF was unavailable.
- `src/app/api/brainstorm/[id]/expand/route.ts` — 1 Groq call. Updates `expanded_text`. Idempotent in spirit (re-running overwrites).
- `src/app/api/brainstorm/cluster/route.ts` — 0 model calls. Greedy: walks notes in insertion order; first unclustered note seeds a cluster, pulls in everyone above 0.78. Singletons stay `inbox`. Re-runnable.
- `src/app/api/brainstorm/[id]/promote/route.ts` — 1 Groq + 1 HF (PASS 1 with the note as seed). Inserts a draft concept, links via `source_brainstorm_id`, marks the note `converted` with `converted_concept_id`.
- `src/app/inbox/page.tsx` — `/inbox` UI. Quick-capture textarea (Cmd/Ctrl+Enter to save, 2000 char cap with live counter). List grouped by `cluster_id` (clusters first with a "related" header, then unclustered notes). Per-note actions: sharpen (expand), pillar dropdown, "to concept" promote button (disabled until a pillar is picked), archive, delete. Bulk action: "group similar" runs the cluster RPC.
- `src/components/AppLayout.tsx` — added `inbox` nav item between `dashboard` and `upload`. Gated on `featureFlags.brainstormInbox()` which transitively requires `conceptPipeline()`.

What's deliberately NOT in M4:

- No bulk expand. Each note expand is a separate Groq call to keep cost transparent.
- No automatic re-cluster on every new note. The user clicks "group similar" when they want it; this avoids burning HF re-embeds on every keystroke.
- No "promote without a pillar" path. Concept generation needs pillar context for PASS 1 — promoting from null pillar is rejected at the API layer.
- No SSE / pass-progress streaming on promote. Same call-it-and-wait pattern as `/concepts/generate`.

Verification:

- `npm test` → 12/12 (no new tests; brainstorm cluster could use a unit test in M8 alongside the rest of the integration coverage).
- `npx tsc --noEmit` → clean.

### M3 — Concept Library UI (2026-05-03)

The first user-visible vNext release.

- `src/app/concepts/page.tsx` — `/concepts` library. Pillar chip filter (single-select for the generate flow), 4 status tabs (All / Saved / Used / Archive), 2-col card grid, optimistic save/used/reject/archive transitions, lazy-stylist trigger button on unstyled cards, score badge (composite %) with hover tooltip showing novelty/fit/specificity, empty-state CTA to import legacy v2 saved ideas. Voice-adapted toggle in the top bar swaps between original PASS 1 output and PASS 3 styled output for cards that have both.
- `src/app/concepts/[id]/page.tsx` — concept detail. Edit-in-place title (Enter to save, Esc to cancel) and hook (Cmd/Ctrl+Enter to save). Side-by-side display of original vs voice-adapted text. Score breakdown, angle, ai_reason, structure, research_summary all rendered when present. Status menu shows only the legal next-states from the state machine. Events timeline reads `concept_events` and renders chronologically.
- `src/components/AppLayout.tsx` — added `concepts` nav item between `ideas` and `voice`. Gated on `featureFlags.conceptPipeline()` so it only appears when `NEXT_PUBLIC_CONCEPT_PIPELINE=true`.
- `src/lib/env.ts` — flags renamed to `NEXT_PUBLIC_*` so client components can gate UI without a server round-trip. `docs/feature-flags.md` updated to match. The flags aren't secrets, so exposing them in the browser bundle is fine.

What's deliberately NOT in M3 yet:

- No SSE / polling for pipeline pass progress. Generation shows a generic spinner skeleton; observers can watch `pipeline_runs` rows directly. Real-time UI is M3 polish or M8.
- No multi-pillar batch generate. The endpoint takes a single `pillar_id`; the UI requires single-select. Multi-pillar would 3x Groq cost per click; defer.
- No regenerate-single-concept button on cards (legacy `/ideas` has it). Defer to M8 polish.
- Pillar create/rename/delete still happens on `/ideas`. M5 workspace will move it.

Verification:

- `npm test` → 12/12 green (no new tests added in M3; UI tests are M8).
- `npx tsc --noEmit` → clean.
- `npm run build` → clean. New routes: `/concepts` (7.39 kB), `/concepts/[id]` (5.34 kB).
- Manual smoke test: with `NEXT_PUBLIC_CONCEPT_PIPELINE` unset, the `concepts` nav item is hidden and direct visits to `/concepts` show the disabled-feature message. With it set to `true`, the page renders, generate is disabled until a pillar is picked, and all status transitions work.

### M2 — Concept pipeline backend, voice-isolated (2026-05-03)

The load-bearing milestone. Voice profile is read in exactly one place in the new pipeline (`src/lib/concepts/stylist.ts`); the architectural-rule guardrail enforces it.

- `src/lib/env.ts` — added `featureFlags` object (`conceptPipeline`, `brainstormInbox`, `workspaceV1`, `researchPass`, `scriptRefiner`) with layering rules. `flagFor(userId, flag)` adds the per-user allowlist gate for M9 dark-launch.
- `src/lib/concepts/types.ts` — `Concept`, `BrainstormNote`, `ConceptEvent`, `PipelineRun`, `Score`, `ConceptCandidate`, `ValidatorOutput`, `StylistOutput`, `ConceptSeed`, `DedupDecision`. Mirrors migrations 008–010.
- `src/lib/concepts/prompts/concept-prompt.ts` — PASS 1 system + user message builders. **Voice profile signature is intentionally absent.** `<USER_NOTE>` fence + sanitization on brainstorm seed text.
- `src/lib/concepts/prompts/validator-prompt.ts` — PASS 2 rubric (novelty/fit/specificity, composite = 0.4n + 0.35f + 0.25s). Also voice-AGNOSTIC.
- `src/lib/concepts/prompts/stylist-prompt.ts` — PASS 3 voice-applied rewrite of title + hook only. **The only place voice profile is read.**
- `src/lib/concepts/concept-generator.ts` — PASS 1 runner. Single Groq call → N candidates → sequential HF embed of each.
- `src/lib/concepts/validator.ts` — PASS 2 runner. Rubric Groq call + 3-stage cosine dedup (within-batch, vs saved/used concepts, vs saved/used legacy v2 ideas).
- `src/lib/concepts/stylist.ts` — PASS 3 runner. Single Groq call rewrites a concept; non-fatal on failure (concept ships unstyled and lazy-styles on first card open).
- `src/lib/concepts/dedup.ts` — pure cosine dedup helpers. Threshold 0.85 matches existing v2 dedup.
- `src/lib/concepts/events.ts` — `recordConceptEvent` and `recordConceptEventsBulk` writers for `concept_events` (append-only audit log).
- `src/lib/concepts/pipeline-run.ts` — `openPipelineRun` / `closePipelineRun` / `tallyGroqCall` / `tallyHfCall`. Powers per-user rate-limit projection in M8.
- `src/lib/concepts/index.ts` — barrel.

API routes (all gated by `CONCEPT_PIPELINE` flag → 503 when disabled):

- `GET /api/concepts` — list with status + pillar_id filters.
- `GET /api/concepts/[id]` — concept + events timeline.
- `PATCH /api/concepts/[id]` — edit fields and/or change status. Enforces the status state machine (draft → reviewed/saved/rejected/archived; saved → used; etc.). Writes a `concept_events` row per change.
- `DELETE /api/concepts/[id]`.
- `POST /api/concepts/generate` — the **3-pass pipeline marquee endpoint**. Opens `pipeline_runs`, runs PASS 1/2/3 (top-K eager style), inserts N concepts with `status='draft'`, writes `concept_events` rows. Total cost: 3 Groq + N HF.
- `POST /api/concepts/[id]/style` — lazy stylist for tail concepts. Idempotent (returns cached values when already styled). Soft-fails when no voice profile exists yet.
- `POST /api/concepts/import-legacy` — opt-in backfill from saved/used v2 `content_ideas` into `concepts`. Idempotent.

Tests:

- `tests/prompts/voice-leak.test.ts` (**load-bearing**, 5 tests) — asserts no voice-profile marker strings appear in PASS 1/PASS 2 messages. Includes fence-escape attempt + literal `</USER_NOTE>` sanitization check.
- `tests/concepts/dedup.test.ts` (7 tests) — manufactured vectors at sim=1.0/0.90/0.85/0.80; threshold boundary inclusive on the reject side; greedy order-dependence test.

Verification:

- `npm test` — 12/12 green.
- `npx tsc --noEmit` — clean.
- `npm run build` — clean. All 5 new `/api/concepts/*` routes registered; existing routes unchanged.

What's deliberately NOT in M2:

- No UI yet — the new endpoints are dogfoodable via curl with a session cookie, but `/concepts`/`/inbox`/`/workspace` pages don't exist. M3 ships the first user-visible UI.
- No `brainstorm.ts` lib module — that's M4 alongside the inbox UI.
- No `research.ts` — that's M6.
- No per-user sliding-window Groq limiter — M8 hardening. Current code reuses the existing `llmGeneration` rate-limit bucket (10/min) so single-user bursts can't run wild.

### M1 — Schema (2026-05-03)

- `migrations/008_concepts_workspace.sql` — `concepts` and `brainstorm_notes` tables with `vector(384)` embeddings, IVFFlat indexes, owner-only RLS on all four verbs, status + source_kind CHECK constraints, circular FK closed at end of file.
- `migrations/009_concept_events.sql` — `concept_events` append-only audit log; only SELECT and INSERT policies (no UPDATE/DELETE — events are immutable; cascade-delete with parent concept).
- `migrations/010_pipeline_runs.sql` — `pipeline_runs` observability table + `concepts.pipeline_run_id` FK closed back-reference + `admin_pipeline_quality` view for save/reject/edit-rate metrics per run.
- `migrations/011_concept_rpcs.sql` — `match_concepts_by_embedding(uid, q, threshold, limit, statuses?)` and `match_brainstorm_by_embedding(uid, q, threshold, limit, statuses?)` RPCs. Both filter by `p_user_id` server-side.
- `scripts/verify-vnext-rls.sql` — schema-level verification (tables, policies, FKs, IVFFlat indexes, RPCs, view). Run in Supabase SQL editor after applying 008-011.

**Cross-user RLS at runtime is deferred to M8** — a SQL-only test cannot simulate two authenticated users (Studio runs as `postgres` which bypasses RLS). The Vitest two-user fixture lands in M8 hardening.

**To apply:** open Supabase SQL editor on the prod project, paste 008 → 009 → 010 → 011 in order and run each. Migrations are idempotent (`IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS`) so re-running is safe. New tables sit empty; legacy `/ideas` flow is unaffected.

### M0 — Branch + tooling (2026-05-03)

- Tagged `v1.0-prod-snapshot` at pre-vNext `main` HEAD (annotated tag, local only until pushed).
- Created `release/v1` (frozen) and `vnext-workspace` (active) branches from `main`.
- Installed `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` (drag/drop runtime for M5 workspace).
- Installed `vitest@^3` + `@vitest/ui@^3` as devDependencies (Node 22.8 compatible; v4 line requires Node ≥22.13). Added `npm test` / `test:watch` / `test:ui` / `e2e` scripts. `vitest.config.ts` mirrors the `@/*` → `src/*` TS path alias.
- Created skeletons in `/docs`: this file, `concepts-architecture.md`, `prompt-architecture.md`, `feature-flags.md`, `observability.md`, `api-reference.md`.

## Cutover checklist

To run at M9, in order:

1. Confirm vNext preview is green on its own DB tables (concepts, brainstorm_notes, concept_events, pipeline_runs all populated, RLS verified).
2. Confirm prod `/ideas` and `/upload` flows still work unchanged on `main` (untouched by 008–011 migrations).
3. Merge `vnext-workspace` → `main` via fast-forward.
4. Allowlist `soohum@gptintegrators.com` only (hardcoded in `src/lib/env.ts`); flip `CONCEPT_PIPELINE`, `BRAINSTORM_INBOX`, `WORKSPACE_V1`, `RESEARCH_PASS` to `true` in Vercel Production env, but only for that user via the allowlist gate.
5. 48h soak: monitor Groq/HF call counts in `pipeline_runs`, watch error logs, confirm no regression in legacy `/ideas` traffic.
6. If clean: remove the allowlist gate, flag-flip global. Tag `v2.0-vnext-cutover`.
7. If anything regresses: leave allowlist in place, debug, repeat.

## Rollback procedure

Three rollback levels, in order of severity:

1. **Flag flip only.** Turn `CONCEPT_PIPELINE` (and dependents) off in Vercel env vars; redeploy. Legacy `/ideas` resumes serving everyone. New tables stay populated but unused.
2. **Code revert.** If a bug reaches prod beyond what flags gate, `git revert` the offending commit on `main`; redeploy.
3. **Full rescue.** If a deploy breaks prod entirely, in Vercel "Promote to Production" the last `main` deploy from before the vNext merge. `release/v1` stays as the secondary parachute — checkout, force-push to `main` if even Vercel rollback fails. (This is the nuclear option; used only if the prior two don't restore service.)

Migrations 008–011 are additive and require no rollback. They can sit unused indefinitely.

## Cross-references

- `docs/concepts-architecture.md` — concept domain model and state machine.
- `docs/prompt-architecture.md` — 3-pass pipeline and voice-isolation rule.
- `docs/feature-flags.md` — flag matrix and dark-launch process.
- `docs/observability.md` — `pipeline_runs` schema, log fields, trace_id propagation.
- `docs/api-reference.md` — every new `/api/*` route.
- `docs/idea-engine-v2.md` — legacy `/ideas` pipeline, retained.
- `docs/pillar-system.md` — pillar model, updated in M5 with merge/split.
