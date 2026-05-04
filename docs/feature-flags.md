# Feature Flags

The flag matrix that gates vNext from prod. Flags are read in `src/lib/env.ts` and gated at both API and UI layers.

---

## Table of contents

1. [Why flags](#why-flags)
2. [Flag matrix](#flag-matrix)
3. [Layering rules](#layering-rules)
4. [Env-var setup](#env-var-setup)
5. [Allowlist gate (dark-launch)](#allowlist-gate-dark-launch)
6. [Independent test paths](#independent-test-paths)
7. [Removal policy](#removal-policy)

---

## Why flags

Feature flags let vNext code coexist with prod on `main` after merge without exposing the new UI to end users. They also let us dark-launch to one user (`soohum@`) for 48h before flipping global.

The plan uses **env-var-only flags** (no `feature_flag_overrides` table) for v1 simplicity. The allowlist for dark-launch is a hardcoded array in `src/lib/env.ts`.

## Flag matrix

| Flag | vNext preview default | Prod default | Gates |
|---|---|---|---|
| `NEXT_PUBLIC_CONCEPT_PIPELINE` | `true` | `false` | `/concepts` UI, `/api/concepts/*`, `/api/concepts/import-legacy`. When `true`, post-essence auto-ideas writes to `concepts` instead of `content_ideas`. |
| `NEXT_PUBLIC_BRAINSTORM_INBOX` | `true` | `false` | `/inbox` UI, `/api/brainstorm/*`, brainstorm nav link. |
| `NEXT_PUBLIC_WORKSPACE_V1` | `true` | `false` | `/workspace` UI, drag/drop, `/api/pillars/merge`, `/api/pillars/split`, workspace nav link. |
| `NEXT_PUBLIC_RESEARCH_PASS` | `true` | `false` | `/api/research`, research-summary input to PASS 1 user message. |
| `NEXT_PUBLIC_SCRIPT_REFINER` | `false` | `false` | Phase 4 only. `/api/concepts/[id]/refine`, refine UI on concept detail page. |

Existing flags (untouched, listed for reference):

- `IDEA_ENGINE_V2` — toggles legacy v1↔v2 idea engine. Stays as-is.
- `NEW_PILLAR_PIPELINE` — disables the entire essence/tagging/series/voice/auto-ideas block. Stays as-is.

## Layering rules

- `NEXT_PUBLIC_BRAINSTORM_INBOX` requires `NEXT_PUBLIC_CONCEPT_PIPELINE` (promote-to-concept needs concepts).
- `NEXT_PUBLIC_WORKSPACE_V1` requires `NEXT_PUBLIC_CONCEPT_PIPELINE` (workspace surfaces concepts).
- `NEXT_PUBLIC_SCRIPT_REFINER` requires `NEXT_PUBLIC_CONCEPT_PIPELINE` (refines a concept).
- `NEXT_PUBLIC_RESEARCH_PASS` is independent — concept generator runs without it (skips research summary input to PASS 1).

API and UI gates **must check both** their own flag and the prerequisite. If `BRAINSTORM_INBOX=true` but `CONCEPT_PIPELINE=false`, brainstorm routes return 503 (or the page 404s) and log a config-error.

## Env-var setup

Vercel Production env (after vNext merge):

```
CONCEPT_PIPELINE=false
BRAINSTORM_INBOX=false
WORKSPACE_V1=false
RESEARCH_PASS=false
SCRIPT_REFINER=false
```

Vercel Preview env (vnext-workspace branch):

```
CONCEPT_PIPELINE=true
BRAINSTORM_INBOX=true
WORKSPACE_V1=true
RESEARCH_PASS=true
SCRIPT_REFINER=false
```

`src/lib/env.ts` exposes typed helpers:

```ts
export const featureFlags = {
  conceptPipeline: () => process.env.CONCEPT_PIPELINE === 'true',
  brainstormInbox: () => process.env.BRAINSTORM_INBOX === 'true' && featureFlags.conceptPipeline(),
  workspaceV1:    () => process.env.WORKSPACE_V1    === 'true' && featureFlags.conceptPipeline(),
  researchPass:   () => process.env.RESEARCH_PASS   === 'true',
  scriptRefiner:  () => process.env.SCRIPT_REFINER  === 'true' && featureFlags.conceptPipeline(),
}
```

(Exact shape lands in M2; this is the target.)

## Allowlist gate (dark-launch)

For the M9 cutover 48h soak, prod env vars stay `false` but a hardcoded allowlist forces them `true` for one user:

```ts
const ALLOWLIST_USER_IDS = [
  // soohum@gptintegrators.com — replace with actual user_id at M9
  'REPLACE_WITH_USER_ID',
]

export function flagFor(userId: string | null, flag: keyof typeof featureFlags): boolean {
  if (userId && ALLOWLIST_USER_IDS.includes(userId)) return true
  return featureFlags[flag]()
}
```

API routes and the AppLayout nav use `flagFor(session.user.id, 'conceptPipeline')` instead of reading the env var directly. This is the only place per-user gating exists in v1.

After 48h soak, remove the allowlist and let env vars do the gating globally.

## Independent test paths

Each flag combo produces a distinct user experience. Test these:

1. **All off (prod baseline)** — `/ideas` works; `/concepts`, `/inbox`, `/workspace` 404; `/api/concepts/*` returns 503.
2. **`CONCEPT_PIPELINE=true` only** — `/concepts` works; nav shows both Ideas and Concepts; `/inbox`, `/workspace` still 404.
3. **`+ BRAINSTORM_INBOX`** — `/inbox` works; promote button on note → creates draft concept.
4. **`+ WORKSPACE_V1`** — `/workspace` drag/drop functional.
5. **`+ RESEARCH_PASS`** — generated concepts include `research_summary` field populated.
6. **`SCRIPT_REFINER=true`** (only post-merge in Phase 4) — refine button on concept detail.

Playwright suite (M8) covers paths 1, 2, 3, 4 explicitly.

## Removal policy

Flags are **temporary**. Each milestone's flag is removed (always `true` in code) after:

- Feature has been GA for 30+ days with no rollback.
- All call sites have been audited to confirm they don't depend on the flag's `false` branch.
- A dedicated cleanup PR removes the flag check, the env var, and updates this doc.

Don't let flags rot. Removal target dates land here when M9 cutover ships.
