# Idea Engine v2

The full record of why we built v2, what existed before, what changed, and how to roll it out and back.

This document covers **Phase 1** in detail — the changes that have shipped. Phase 2 and Phase 3 are scoped at the bottom and will be filled in when those phases land.

---

## Table of contents

1. [Why v2 exists](#why-v2-exists)
2. [v1 — what existed before](#v1--what-existed-before)
3. [v2 Phase 1 — what changed and why](#v2-phase-1--what-changed-and-why)
4. [What was deliberately preserved](#what-was-deliberately-preserved)
5. [Database migration 004](#database-migration-004)
6. [Module layout](#module-layout)
7. [Prompt design](#prompt-design)
8. [Dedup behavior](#dedup-behavior)
9. [Cost model](#cost-model)
10. [Backward compatibility](#backward-compatibility)
11. [Rollout runbook](#rollout-runbook)
12. [Rollback runbook](#rollback-runbook)
13. [Testing checklist](#testing-checklist)
14. [Phase 2 & Phase 3 roadmap](#phase-2--phase-3-roadmap)
15. [Known issues / open questions](#known-issues--open-questions)

---

## Why v2 exists

v1 produced pillar-anchored ideas via one big LLM call per pillar. The output drifted toward sameness inside a batch: same hook register ("Most people think X"), same tension shape (usually contradiction or confession), same opening cadence. Creators reading the dashboard could feel the cluster — three ideas that "rhymed" too closely to feel like three different videos.

The product PRD (Doto v2 — AI Content Brain for Creators) reframed the goal: when a user reads an idea, they should think *"I would actually post this."* That bar requires variation along axes the v1 prompt was implicitly collapsing.

v2's structural fix is to make two of those axes **explicit and assigned per idea**:

- **Angle** — the *stance* the idea takes (unpopular opinion, beginner mistake, contrarian take, …).
- **Packaging** — the *shape* the idea takes (contradiction, POV, story, hot take, listicle, …).

Each idea is generated under exactly one (angle, packaging) tuple, and the LLM is told the hook *must* reflect the assigned packaging. tension_type and format are still emitted as descriptors but no longer drive batch diversity — packaging does.

Phase 1 also fixes essence quality (the durable artifact every downstream feature reads from) and extends the voice profile with five new fields the idea prompt actually consumes.

---

## v1 — what existed before

The v1 pipeline:

```
upload → transcribe → essence → pillar tag-or-create → idea generation
```

### v1 essence

Single Groq call per transcript (`src/lib/pillars/essence.ts`). Output is one plain-prose paragraph, 220–360 chars, captured into `transcripts.essence` with `essence_embedding` (MiniLM-384). Idempotent on `essence_generated_at`.

The prompt asked for "the actual topic, specific people/numbers/stories, and the angle or argument" but in practice the model often returned topic-only summaries — *"this video talks about productivity"* — which weakened every downstream consumer.

### v1 voice profile

Single Groq call over a user's essences (`src/lib/pillars/voice-profile.ts`). Schema in `voice_profile`:

| Column | Type | Purpose |
| --- | --- | --- |
| `tone_descriptors` | text[] | 3–5 adjectives describing speech |
| `recurring_phrases` | text[] | up to 6 phrases the creator repeats |
| `content_style` | text | one of: story-driven, listicle, how-to, conversational, educational |
| `niche_summary` | text | 1–2 sentences on niche + audience |
| `signature_argument` | text | the contrarian thesis they return to |
| `enemy_or_foil` | text[] | what they push back against |
| `would_never_say` | text[] | sentences they would never say |

This is consumed verbatim by `generateIdeasForUser`.

### v1 pillar system

Documented in detail at `docs/pillar-system.md`. Summary: bootstrap on the 2nd transcript, per-upload tag-or-create with cosine + LLM escalation thereafter. Subtopics accumulate per pillar (max 12 entries) but **were not fed into idea generation** in v1 — the idea prompt didn't see them.

### v1 idea generation

`src/lib/ideas/generate.ts` — `generateIdeasForUser(args)`. Per pillar:

1. Fetch top 5 transcripts ranked by `word_count` (not by semantic similarity).
2. Concat top 3 (cap 4000 chars).
3. Single Groq call with a long system message defining "ANCHOR MODE" (GROUNDED vs ABSTRACT), "TENSION" (six types), hook register examples, intra-batch diversity rules.
4. Filter the response: title-template regexes, weak-hook detection, GROUNDED anchor verification (must find ≥6-word window in transcripts), Jaccard dedup at 0.45.
5. Insert into `content_ideas` with `pillar_id`, `title`, `hook`, `structure`, `reasoning` (multi-part concat). No angle/packaging columns existed.

### v1 limitations the PRD called out

- **Output too repetitive** within a batch.
- **Subtopics underused** — the column exists, the data is populated, the idea generator never reads it.
- **Essence too generic** — "this video talks about productivity" weakens everything downstream.
- **Voice profile is a flat blob** — no structured hook patterns or energy/style metadata.
- **No history awareness** — ideas can repeat what the creator already filmed.
- **No packaging discipline** — every idea ends up in roughly the same shape.

---

## v2 Phase 1 — what changed and why

### 1. Essence v2 — structured, angle-anchored

**Why:** the PRD §7 calls out essence quality as upstream of everything. v1 output drifted to topic-only.

**What:** behind `IDEA_ENGINE_V2=true`, `generateEssenceV2` returns four structured fields instead of one paragraph:

| Field | Constraint | Rule |
| --- | --- | --- |
| `topic` | ≤80 chars | The concrete **subject** of the video as a 2-6 word noun phrase. Anchors topical signal so pillar tagging doesn't collapse abstract angles into one umbrella. |
| `core_idea` | ≤160 chars | The **angle** of the video. MUST include a specific mechanism, scenario, or perspective — not a general claim. |
| `hook` | ≤100 chars or `null` | The literal opening line if it functions as a hook; `null` if the transcript opens with filler. |
| `takeaway` | ≤160 chars | What the viewer is supposed to walk away believing or doing. |

**Why `topic` was added (after Phase 1 shipped):** the original v2 essence stored the legacy column as `core_idea — takeaway` — angle-and-upshot only. In production this collapsed pillar tagging: every reflective video embeds in roughly the same abstract region of MiniLM space, so bootstrap proposed one umbrella ("Personal Growth") and `TAG_FAST_THRESHOLD=0.55` auto-tagged every later upload into it. Topic-leading essences (`topic // core_idea // takeaway`) restore per-video topical separation without changing any pillar thresholds.

The prompt anchors `core_idea` quality with a bad/good example pair baked in:

> ❌ "people struggle with productivity because they lack discipline"
> ✅ "people fail at productivity because they rely on motivation instead of reducing decisions"

Persistence:
- New columns: `essence_core_idea`, `essence_hook`, `essence_takeaway`, `hook_embedding`. (`topic` is currently captured into the legacy `essence` column only — no dedicated column yet.)
- Legacy `essence` column keeps getting populated as `topic // core_idea // takeaway` so pillar tagging (which reads `essence_embedding`) carries topical signal again.
- `hook_embedding` is computed only when `hook` is non-null.
- `ESSENCE_MAX` is 480 chars to fit topic + core_idea + takeaway with separators; well under MiniLM's ~1000-char limit.

### 2. Voice profile v2 — structured rhetoric

**Why:** the PRD §4.3 demands a structured voice profile (primary_style, hook_patterns, sentence_style, energy) instead of relying on a free-text content_style.

**What:** behind the same flag, the voice profile prompt extracts five additional fields:

| Field | Type | Role in idea prompt |
| --- | --- | --- |
| `primary_style` | text | dominant rhetorical mode — preferred over `content_style` |
| `secondary_styles` | text[] | 1–3 supporting styles |
| `hook_patterns` | text[] | 3–5 actual hook templates the creator uses |
| `sentence_style` | text | rhythm characteristic |
| `energy` | text | low-key, measured, animated, intense, … |

v1 fields are not removed and not deprecated. The v2 idea prompt **falls back to v1 fields when v2 fields are null** — so a legacy voice profile still produces v2 ideas, just with thinner voice context.

### 3. Idea engine v2 — packaging × angle × subtopics

**Why:** PRD §5.4 declares "Each idea must use a different packaging type." PRD §6 declares subtopics are critical and currently unused.

**What:** new orchestrator `generateIdeasV2ForUser` under `src/lib/ideas/v2/`. Per pillar, for each requested idea (default 3, max 5):

1. Pick a distinct **angle** from the predefined pool of 6 (`unpopular_opinion`, `beginner_mistake`, `hidden_truth`, `personal_failure`, `contrarian_take`, `missing_step`).
2. Pick a distinct **packaging type** from the 8 PRD types (`contradiction`, `hyper_specific`, `pov`, `story`, `hot_take`, `listicle`, `mistake_callout`, `behind_the_scenes`) via Fisher-Yates shuffle. No two ideas in a batch share a type until the pool is exhausted.
3. Build a context block with: voice profile (v2 fields preferred), pillar name + description, **subtopics already covered** (verbatim, with instruction not to retread them), top-3 transcript essences, top-3 raw transcript excerpts (≤4000 chars).
4. Build a packaging-specific user message — the assigned packaging carries a **hook contract** baked into the prompt:
   - `contradiction` → "the hook MUST explicitly challenge a widely-held belief"
   - `pov` → "the hook MUST read first-person from a specific perspective"
   - `story` → "the hook MUST drop the viewer into a scene mid-action"
   - …(full list in `src/lib/ideas/v2/packaging.ts`)
5. Single Groq call per (pillar × angle × packaging) tuple. JSON response: `hook`, `title`, `idea`, `execution`, `anchor_quote`, `tension_type`, `format`.
6. Validate: hook 8–18 words, no pronoun-verb-reflexive shape, title 6–16 words, no templated patterns.
7. Embed accepted candidates with HF MiniLM into `idea_embedding`.
8. Within-batch dedup at cosine 0.85.
9. Lightweight saved/used filter (cosine 0.85) capped at 200 history rows.
10. Insert into `content_ideas` with `source_version='v2'`, `angle`, `packaging_type`, `idea_embedding`.

Concurrency: `PILLAR_CONCURRENCY=2` (matches v1). Within a pillar, calls are sequential to keep Groq token-rate predictable under the free-tier 12k TPM ceiling.

### 4. Flag-based gating

**Why:** the project precedent (`NEW_PILLAR_PIPELINE`) gates breaking-ish behavior changes behind an env var so production behavior is preserved on deploy.

**What:** `IDEA_ENGINE_V2` env var, read in three places:

- `src/lib/pillars/essence.ts` — switches essence prompt + persistence.
- `src/lib/pillars/voice-profile.ts` — switches voice profile prompt + persistence.
- `src/app/api/ideas/generate/route.ts` — selects `generateIdeasV2ForUser` vs `generateIdeasForUser`.

Default: unset = v1 path. To activate: set `IDEA_ENGINE_V2=true`.

---

## What was deliberately preserved

- **`src/lib/ideas/generate.ts`** (v1 generator) — unchanged. Still exported. Runs when the flag is off.
- **Pillar formation** (`src/lib/pillars/bootstrap.ts`, `tag-or-create.ts`, `series-detector.ts`) — unchanged. The original PRD scope was idea generation, essence, and voice profile. Pillar logic stayed.
- **`transcripts.embedding`** (raw transcript embedding) — unchanged.
- **`pillars.embedding`** — unchanged.
- **`match_pillar_by_embedding` RPC** — unchanged.
- **All existing API routes** — only `POST /api/ideas/generate` got two new lines (the flag branch).
- **All existing voice profile fields** — additive only. v1 columns still populated when the flag is on; the v2 prompt just emits more fields alongside.
- **Idempotency keys** — `essence_generated_at` still gates re-essence work. Existing transcripts with v1 essences won't be re-summarized when the flag flips on.

If you find yourself needing to "re-essence" old transcripts under v2, the existing `POST /api/pillars/backfill-essences` route still works — but you'll need to clear `essence_generated_at` first or the idempotency guard skips them.

---

## Database migration 004

`migrations/004_idea_engine_v2.sql`. **Strictly additive — no drops, no renames, no NOT-NULL retrofits on existing rows.** Run in the Supabase SQL editor.

### `transcripts` additions

| Column | Type | Purpose |
| --- | --- | --- |
| `essence_core_idea` | text | v2 — the angle |
| `essence_hook` | text | v2 — literal opening line, nullable |
| `essence_takeaway` | text | v2 — viewer takeaway |
| `hook_embedding` | vector(384) | v2 — MiniLM of the hook (Phase 2 retrieval will use this) |

Plus `transcripts_hook_embedding_ivfflat` (cosine, lists=100).

### `voice_profile` additions

| Column | Type | Purpose |
| --- | --- | --- |
| `primary_style` | text | v2 — dominant rhetorical mode |
| `secondary_styles` | text[] | v2 — supporting styles |
| `hook_patterns` | text[] | v2 — hook templates |
| `sentence_style` | text | v2 — rhythm characteristic |
| `energy` | text | v2 — energy descriptor |

### `content_ideas` additions

| Column | Type | Purpose |
| --- | --- | --- |
| `angle` | text | v2 — assigned angle ID |
| `packaging_type` | text | v2 — assigned packaging ID |
| `score` | jsonb | reserved for Phase 2 scoring `{originality, voice_match, hook_strength}` |
| `idea_embedding` | vector(384) | v2 — for batch dedup and (Phase 2) history awareness |
| `source_version` | text | `'v1'` (default) or `'v2'` — tells the UI/analytics which generator produced the row |

No ivfflat index on `idea_embedding` yet. Phase 1 only compares within an in-memory batch; the saved/used filter is bounded to 200 rows. Index gets added in Phase 2 when full history dedup ships.

### New RPC

```sql
match_transcripts_by_essence(p_user_id, p_embedding, p_exclude_pillar_id?, p_limit?)
```

Returns top-N transcripts ranked by cosine similarity to a query embedding, optionally excluding transcripts tagged to a given pillar. Phase 2 hybrid retrieval will use this for the 30% cross-pillar slice. **Not used by Phase 1 code yet — added now to avoid another migration round-trip later.**

### Backward compatibility verification

```sql
-- All migration columns landed?
SELECT table_name, column_name FROM information_schema.columns
WHERE (table_name = 'transcripts'    AND column_name IN ('essence_core_idea','essence_hook','essence_takeaway','hook_embedding'))
   OR (table_name = 'voice_profile'  AND column_name IN ('primary_style','secondary_styles','hook_patterns','sentence_style','energy'))
   OR (table_name = 'content_ideas'  AND column_name IN ('angle','packaging_type','score','idea_embedding','source_version'))
ORDER BY table_name, column_name;
-- expect 14 rows

SELECT proname FROM pg_proc WHERE proname = 'match_transcripts_by_essence';
-- expect 1 row
```

---

## Module layout

```
src/lib/ideas/v2/
  index.ts            generateIdeasV2ForUser — orchestrator
  context-builder.ts  per-pillar context (Phase 2 swaps in 70/30 hybrid)
  angles.ts           predefined angle pool + picker
  packaging.ts        8 PRD packaging types + Fisher-Yates shuffle
  idea-prompt.ts      V2_SYSTEM_MESSAGE + buildV2UserMessage
  dedup.ts            within-batch + saved/used cosine dedup
```

**Total new code:** 780 lines. Each module ≤330 lines, single-purpose, importable in isolation.

**Touched existing files (3):**
- `src/lib/pillars/essence.ts` — added `generateEssenceV2`, branched `ensureEssenceForTranscript` on the flag.
- `src/lib/pillars/voice-profile.ts` — branched `generateVoiceProfileFromEssences` on the flag, extended payload.
- `src/app/api/ideas/generate/route.ts` — added flag branch (2 lines).

**Untouched:** `src/lib/ideas/generate.ts`, all pillar modules, all other API routes.

---

## Prompt design

### Essence v2 system prompt

Anchored on the PRD's clarification that `core_idea` must capture the angle, not the topic. The bad/good example pair is verbatim:

> ❌ "people struggle with productivity because they lack discipline"
> ✅ "people fail at productivity because they rely on motivation instead of reducing decisions"

Hook handling explicitly returns `null` for filler intros ("hey guys", "what's up") to prevent the model from inventing hooks where none exist.

### Voice profile v2 system prompt

v1 prompt unchanged in structure; the JSON-schema instruction at the end is replaced when the flag is on to demand five additional fields. The instruction for `hook_patterns` specifies the model must derive them from how the creator's videos actually OPEN, not invent generic templates.

### Idea generation v2 system prompt

Three rules in the system message:

1. **Cardinal rule** — do not invent specifics not present in the transcripts.
2. **Packaging is the primary axis** — the assigned packaging dictates the hook shape.
3. **Avoid retreading subtopics** — `pillars.subtopics` is included verbatim.

Each call is for **exactly one idea**. The user message ends with the assigned (angle, packaging) pair plus the packaging's hook contract — the LLM is given a single clear shape to hit, not a menu to choose from.

---

## Dedup behavior

**Phase 1 only.** Two stages, both cosine-based on `idea_embedding`:

1. **Within-batch** — drop pairwise duplicates at threshold 0.85. Distinct angles in the same pillar typically cluster around 0.5–0.7 cosine, so 0.85 catches near-paraphrases without nuking the batch.
2. **Saved/used filter** — fetch up to 200 rows where `is_saved=true OR is_used=true` AND `idea_embedding IS NOT NULL`, drop new ideas at cosine ≥ 0.85.

v1 history (no `idea_embedding`) is naturally ignored. Both stages **fail open** on DB error — generation never blocks on dedup.

Full history dedup (every past idea, not just saved/used) is **out of scope for Phase 1**. The columns and behavior are in place to flip on later without another migration.

---

## Cost model

Per-idea costs under v2 vs v1:

| Step | v1 cost | v2 cost | Notes |
| --- | --- | --- | --- |
| Essence generation | 1 Groq call | 1 Groq call | Same model, same token count, slightly different prompt |
| Hook embedding | 0 | 1 HF call (only if hook ≠ null) | New |
| Voice profile | 1 Groq call | 1 Groq call | Same; v2 prompt is slightly longer |
| Idea generation per pillar | 1 Groq call (N ideas) | N Groq calls (1 idea each) | Each v2 call is shorter than the v1 mega-call |
| Idea embedding | 0 | 1 HF call per accepted idea | New |

For default `perPillarCount=3` across 4 pillars:
- Groq calls go from 4 (v1) to 12 (v2).
- HF embedding calls add ~12 (one per accepted idea) on top of the 4 hook embeddings (avg ~50% of essences emit a hook).

`PILLAR_CONCURRENCY=2` mirrors v1, sequencing within a pillar. Free-tier Groq 12k TPM remains the binding constraint; in testing, 4 pillars × 3 ideas finishes in ~25 seconds well under the rate ceiling.

HuggingFace cold-start retry (3 attempts, 20s backoff) is unchanged — `embeddings.ts:9-43`. If embedding fails for a single idea, the orchestrator drops that idea and continues; generation never blocks on HF.

---

## Backward compatibility

The flag default is **off**. With `IDEA_ENGINE_V2` unset:
- Essence generation uses the v1 prompt and writes only the legacy `essence` column.
- Voice profile uses the v1 schema.
- Idea generation runs `generateIdeasForUser` and writes rows with `source_version='v1'` (the default value of the new column).

With `IDEA_ENGINE_V2=true`:
- New essences populate the structured fields **and** the legacy column.
- New voice profiles add the v2 fields **and** keep the v1 fields.
- New ideas insert with `source_version='v2'`.
- Existing rows are not retroactively migrated.

Mixed-version DBs are explicitly supported. The dashboard UI reads only columns that have always existed (`title`, `hook`, `structure`, `reasoning`, `pillar_id`, `is_saved`, `is_used`); the new columns are passive metadata.

---

## Rollout runbook

### Pre-deploy

- [ ] All v2 commits on `main` (or feature branch ready to merge).
- [ ] `migrations/004_idea_engine_v2.sql` reviewed.
- [ ] Verification queries (above) prepared.

### Deploy

1. Merge `feature/idea-engine-v2` → `main` (fast-forward, preserves the 5 atomic commits).
2. `git push origin main`. Vercel auto-deploys.
3. **Apply the migration in Supabase prod**:
   - SQL editor → paste `migrations/004_idea_engine_v2.sql` → run.
   - Confirm the 14-rows + 1-RPC verification query.
4. **Production behavior is still v1** at this point. The flag is unset.

### Activate v2

1. Vercel → project → Settings → Environment Variables → add:
   - Key: `IDEA_ENGINE_V2`
   - Value: `true`
   - Environments: Production (or Preview + Production if you want preview deploys to use it).
2. Redeploy (Vercel will prompt; or `vercel --prod` from CLI).
3. Verify by uploading one fresh video to a test account and running the [Testing checklist](#testing-checklist) below against prod.

---

## Rollback runbook

### Soft rollback (instant)

Unset `IDEA_ENGINE_V2` in Vercel env (or set to anything other than `true`) → redeploy. All code paths fall through to v1. Existing v2 rows remain in the DB but no new ones are created. UI continues to display them normally.

This is the **first response** to any v2 quality regression. Reverting the flag does not require a code revert.

### Hard rollback (rare)

If the v2 code itself is misbehaving (not just the prompt quality):

1. `git revert <merge-commit>` on `main` and push. v1 code returns; v2 modules disappear.
2. Migration columns stay — they're nullable/defaulted and don't break v1.
3. v2 rows in `content_ideas` remain accessible in the UI.

If the migration itself needs to come out (it shouldn't — it's strictly additive), `ALTER TABLE ... DROP COLUMN` per added column. Order does not matter; the new RPC can be dropped with `DROP FUNCTION match_transcripts_by_essence`.

---

## Testing checklist

### Pre-flight

- [ ] Migration 004 applied in target DB.
- [ ] `IDEA_ENGINE_V2=true` in target environment.
- [ ] Server cold-started after env var change (env vars don't hot-reload).

### Essence

After uploading a fresh video:

- [ ] `transcripts.essence_core_idea` populated; names a specific mechanism/scenario/perspective (not topic-only).
- [ ] `transcripts.essence_takeaway` populated.
- [ ] `transcripts.essence_hook` is either a real opening line or `null` (filler intros → null is correct).
- [ ] `transcripts.essence_embedding` populated (existing column — pipeline still wired).
- [ ] `transcripts.hook_embedding` populated **iff** `essence_hook` is non-null.
- [ ] Legacy `transcripts.essence` populated (concat — used by pillar tagging).

### Voice profile

After 2 uploads (bootstrap fires):

- [ ] `voice_profile.primary_style` populated.
- [ ] `voice_profile.hook_patterns` is a non-empty array.
- [ ] `voice_profile.secondary_styles`, `sentence_style`, `energy` populated.
- [ ] All v1 fields (`tone_descriptors`, `recurring_phrases`, `signature_argument`, `enemy_or_foil`, `would_never_say`) still populated.

### Idea generation

After hitting "Generate ideas":

- [ ] `content_ideas.source_version='v2'` on every new row.
- [ ] `content_ideas.angle` ∈ {`unpopular_opinion`, `beginner_mistake`, `hidden_truth`, `personal_failure`, `contrarian_take`, `missing_step`}.
- [ ] `content_ideas.packaging_type` ∈ the 8 PRD types.
- [ ] `content_ideas.idea_embedding` populated.
- [ ] **No two ideas in the same generation batch share the same `packaging_type`.**

Content-level (read in UI):

- [ ] Hook is 8–18 words.
- [ ] Title is 6–16 words, no templated shapes.
- [ ] Hook visibly reflects the assigned packaging:
  - `contradiction` → challenges a belief
  - `pov` → first-person perspective
  - `story` → drops into a scene
  - `hot_take` → polarizing assertion
  - `listicle` → enumeration with a number
  - `mistake_callout` → second-person callout
  - `behind_the_scenes` → reveals insider knowledge
  - `hyper_specific` → contains precise number/timeframe
- [ ] Ideas don't retread `pillars.subtopics` for the relevant pillar.

### Backward-compat smoke test

- [ ] Set `IDEA_ENGINE_V2=false` (or remove) → restart → generate → new rows have `source_version='v1'`, no `angle`, no `packaging_type`.
- [ ] Existing v2 ideas still display in the UI alongside new v1 ideas.

### Logs to watch

```
ideas/v2 summary — pillars=N per_pillar=3 accepted=X inserted=Y failed=Z total_rejected=W
```

`accepted` should equal `inserted`. `total_rejected > 0` is fine in moderation; consistent rejection of every candidate signals over-constrained validation.

---

## Phase 2 & Phase 3 roadmap

### Phase 2 — quality layer (next)

Already provisioned in the schema. Will need new code only:

- **Gap detection** — LLM call that compares a pillar's transcript essences against the pillar's centroid embedding and proposes 3–5 underexplored angles. Cached per `(user_id, pillar_id, transcript_count)` to avoid re-firing on every regenerate. Output feeds the angle pool alongside `PREDEFINED_ANGLES`.
- **Hybrid retrieval (70/30)** — `context-builder.ts` will switch from pillar-only transcript fetch to a 70% pillar / 30% cross-pillar mix via the existing `match_transcripts_by_essence` RPC.
- **Scoring layer** — single batched Groq call that scores all candidates in a pillar on `{originality, voice_match, hook_strength}`. Returns rank only (no filter cuts) per the user direction. Score persists to `content_ideas.score (jsonb)`.
- **Full history dedup** — flip the saved/used filter to scan all of `content_ideas`, add `idea_embedding_ivfflat` index.

### Phase 3 — user controls

Pure UI / API surface, no further migration:

- Style toggle (more storytelling / more viral / more educational) — modulates the angle pool and packaging weights at request time.
- Packaging preference (allow/disallow types).
- Explore-new-ideas slider — increases gap-derived angle weight.
- Remix button — rewrites a selected idea under a different packaging type.

---

## Known issues / open questions

- **Pillar formation breadth** — bootstrap currently demands broad pillars. For multi-mode creators (thought pieces + productivity + vlogs in one account), this can still collapse distinct content territories under a single umbrella like "Personal Growth." The topic-leading essence (added post-Phase-1) restored most of the per-video separation that pure angle/takeaway essences had erased, but the underlying threshold/prompt design hasn't been revisited.
- **Voice profile coherence** — when an account's transcripts represent multiple creator personas (e.g. test data from different sources), the voice profile averages them. Not a bug; a property of the design.
- **Free-tier rate limits** — `videoProcess: 5/10min`, `llmGeneration: 10/min` (`src/lib/rate-limit.ts:45-50`). Not specific to v2 but worth knowing during testing.
- **Idempotency lock-out** — existing v1 essences won't be re-generated under v2. If you want a clean v2 test, upload fresh videos rather than expecting old transcripts to upgrade.
- **Embedding cold-start latency** — first HF call after a quiet period can take ~20s while the model warms. Existing 3-attempt retry handles it but a creator's first generate-ideas of the day may feel slower.
