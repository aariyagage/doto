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
| M1 | Schema (008–011) | pending | additive migrations + RLS tests |
| M2 | Concept pipeline backend (voice-isolated) | pending | the load-bearing voice fix |
| M3 | Concept Library UI | pending | first user-visible release |
| M4 | Brainstorm Inbox | pending | depends on M2 |
| M5 | Pillar Workspace + DnD | pending | depends on M2 |
| M6 | Research pass + multi-candidate ranking | pending | depends on M2 |
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

### M0 — Branch + tooling (in progress)

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
