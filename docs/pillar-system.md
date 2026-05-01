# Pillar System

How Doto turns a creator's uploaded videos into a stable, semantically-deduplicated set of content pillars — and how those pillars drive idea generation.

## What pillars are (and why they matter)

A pillar is a broad content territory. "Productivity", "Beauty", "Founder Diaries" — 1-3 words, broad enough to host future videos. Each video gets tagged to one (or two) pillars; ideas are generated per-pillar so the creator can pick which territory to focus on.

Pillars are the spine of the product. If they're wrong — too narrow, too overlapping, too unstable — every downstream feature degrades.

## The system in one paragraph

When a creator uploads a video, we transcribe it once and generate a ~300-character "essence" summary plus its embedding. Pillars get formed automatically on the second upload (the bootstrap moment). After that, every new upload runs through a tag-or-create decision: cosine similarity against existing pillar embeddings, escalating to an LLM in the ambiguous band, with a final embedding-based dedup gate. Series are detected via regex pre-filter on the transcript intro plus a confirming LLM call. The creator can manually declare series, and a manual Regenerate button re-derives the entire pillar set from scratch while preserving anything user-declared or already flagged as a series.

## Lifecycle

### 1. Onboarding (0–1 transcripts)

No pillars. The UI says *"Upload at least 2 videos to discover your pillars."* This avoids the failure mode of generating 2-3 narrow pillars from a single 5-minute video before we know the creator's range.

### 2. Bootstrap (2nd transcript)

The only automatic pillar-creation moment. We pull both essences, send them to Groq with a prompt that demands BROAD pillars (with concrete examples like *"time blocking + morning routine → ONE pillar: Productivity"*), embed each proposal, persist with subtopics, and retroactively tag both videos. The voice profile is also generated here from the same essences.

### 3. Steady state (3rd+ transcript)

Every subsequent upload runs `tagOrCreatePillarsForVideo`:

| Cosine similarity (top match) | Action |
| --- | --- |
| ≥ 0.55 | Fast tag, no LLM call. Multi-tag if a second pillar also scores ≥ 0.60. |
| 0.30 – 0.55 | LLM is asked to either tag against an existing pillar (with strong reuse bias, examples included) or propose a new one. |
| < 0.30 | LLM proposes a new pillar; goes through the 0.78 dedup gate. |

The LLM call always sees the full pillar list with descriptions, not just cosine top-N. This catches duplicates of pillars that weren't in the cosine top-5.

### 4. Series detection

Runs on every upload. Two layers:
1. **Regex pre-filter** on the first 500 chars: `episode|series|welcome to (my|the)|part \d|chapter \d|ep\.?\s*\d`. If no match, we skip the LLM entirely.
2. **LLM confirmation** if the regex hits — extracts the series name and signals.

If the creator's series name embeds close to an existing pillar, that pillar is promoted to `is_series=true` (with `source_origin` rewritten to `ai_series`). Otherwise a new series pillar is created.

### 5. Manual Regenerate

A button in `/ideas`. Throws away all auto-derived pillars and re-derives them from scratch using all essences as one batch. Preserves anything where `source_origin IN ('user_series', 'user_manual', 'ai_series')` OR `is_series = true`. Re-runs series detection across every transcript, batch re-tags every video, refreshes the voice profile.

This is an escape hatch, not a daily action. It's there for content drift, niche pivots, or cleaning up after a large delete.

## Why this design (the journey)

The previous system was broken in five ways:

1. **6,000-char truncation.** Pillar generation joined all transcripts and sliced off everything past ~7 minutes of speech. A creator with 10 videos had pillars derived from only the first 1–2.
2. **Every upload re-ran full generation.** Wasteful Groq calls, churned the pillar list, made drift worse.
3. **Pillars only grew, never consolidated.** Only exact-lowercase-name dedup. "Mindset" and "Mindset Shifts" both survived.
4. **`description` was generated but never persisted.** The tagging prompt had no idea what each pillar meant.
5. **Series content was invisible.** Recurring branded segments ("Thought Daughter Diaries") clustered as topical pillars.

The fixes, in the same order:

1. **Per-transcript essences.** ~300 chars × N videos = ~15k chars even at 50 videos. Fits any context window. Generated once, reused everywhere.
2. **Bootstrap-only auto-creation.** Steady state never triggers full generation; it tag-or-creates instead.
3. **Embedding dedup at 0.78** + LLM prompt that includes the full existing pillar list. Belt-and-suspenders.
4. **`description` and `embedding` columns** on `pillars`. Embeddings are over `name + ". " + description` for granularity comparable to essences.
5. **Series detector** with regex pre-filter to keep cost low + LLM confirmation. Promotes existing pillars when semantically close, creates new ones otherwise.

A sixth issue surfaced after launch: **pillars came out too narrow.** "Time Management Tips" and "Productivity Hacks" as separate pillars when both should live under one umbrella. Fix: rewrote bootstrap, tag-or-create, and regenerate prompts with explicit examples of the broad-vs-narrow split, lowered the fast-tag threshold to 0.55 (more videos auto-tag to existing pillars), and added a `subtopics` column so each broad pillar can carry the specific aspects ("time blocking", "focus rituals") for downstream idea generation.

## Idea generation (per-pillar)

Originally `/api/ideas/generate` produced N total ideas spread across all pillars by asking the LLM to balance. The LLM didn't balance — it clustered on whichever pillar had the strongest transcripts.

Current behavior:
- "All Ideas" filter on, no specific pillar selected → generate N ideas **for each** pillar (parallel Groq calls, one per pillar).
- One pillar selected → N ideas for that pillar.
- N is per-pillar (default 3, capped at 5).

Each per-pillar call sees only that pillar's tagged transcripts, not the full library. This gives the LLM focused source material and prevents cross-contamination. Cross-pillar dedup runs once across the union before insertion.

## Schema

```
pillars
  id              uuid pk
  user_id         uuid
  name            text
  description     text                                  -- one sentence; embedded with name
  embedding       vector(384)                           -- MiniLM-L6-v2 over "name. description"
  is_series       boolean default false
  series_signals  text[]                                -- phrases that triggered AI series detection
  source          text                                  -- legacy, retained
  source_origin   text                                  -- ai_detected | ai_series | user_series | user_manual
  subtopics       text[] default '{}'                   -- specific topics under this broad pillar
  last_tagged_at  timestamptz                           -- drives soft-cap "least-tagged" hint
  color           text                                  -- bg color from PILLAR_COLORS palette
  created_at      timestamptz

transcripts (additions for this system)
  essence              text                             -- ~300 char single-paragraph summary
  essence_embedding    vector(384)                      -- MiniLM-L6-v2 over the essence
  essence_generated_at timestamptz                      -- idempotency marker
```

Plus: unique index on `(user_id, lower(name))` to catch race-create dupes at the DB; ivfflat indexes on both embeddings; an RPC `match_pillar_by_embedding(user_id, embedding, threshold)` that keeps cosine search in SQL.

## Code map

```
src/lib/pillars/
  embeddings.ts          embedText (MiniLM via HF), cosineSimilarity, parseEmbedding
  essence.ts             generateEssence, ensureEssenceForTranscript (idempotent), backfillEssencesForUser
  dedup.ts               findSimilarPillars, findClosestPillar — wraps the SQL RPC
  voice-profile.ts       generateVoiceProfileFromEssences, regenerateVoiceProfileForUser
  series-detector.ts     looksLikeSeriesIntro (regex), detectSeriesSignals, detectAndPersistSeriesIfApplicable
  bootstrap.ts           bootstrapPillarsForUser — runs at the 2-transcript moment
  tag-or-create.ts       tagOrCreatePillarsForVideo — steady-state per-upload decision
  regenerate.ts          regeneratePillarsForUser — manual full re-derivation
  types.ts               SupabaseServer type alias

src/app/api/pillars/
  generate/route.ts          POST → regeneratePillarsForUser (manual button)
  series/route.ts            POST → manual series declaration
  state/route.ts             GET  → pillarCount, isOverSoftCap, untaggedRecentVideos, eligibleTranscriptCount
  backfill-essences/route.ts POST → batch essence generation for old transcripts (5 per call)
  [id]/route.ts              DELETE single pillar; PATCH name + is_series
  route.ts                   DELETE all pillars (with confirmation token)

src/app/api/videos/process/route.ts
  Replaced the inline pillar/voice-profile/idea-gen block with calls into the
  new lib. Branches on transcript count: 1 = skip, 2 = bootstrap, 3+ = tag-or-create.
  Then runs series detection. Emits a `pillars_ready` SSE step before `done`.
  Wrapped behind NEW_PILLAR_PIPELINE env flag (default on; set to "false" for kill-switch).

src/app/api/ideas/generate/route.ts
  Per-pillar parallel Groq calls. count = ideas per pillar (default 3, max 5).
  Empty pillar_ids → all pillars; otherwise selected pillars only.

src/app/ideas/page.tsx        Pillar UI: empty-state branching, always-visible
                              Regenerate, soft-cap nudge (≥8 pillars), stale-pillar
                              nudge (≥3 untagged recent), Series badge.

src/app/videos/page.tsx       "Declare as series" icon button per video card.

src/components/PillarSeriesDeclareModal.tsx
                              Manual series declaration form.
```

## Thresholds & tuning

All thresholds chosen for MiniLM-L6-v2 on 200-400 char inputs. Should be revisited after observing the first ~100 real production uploads' similarity distribution.

| Constant | Value | Where | Meaning |
| --- | --- | --- | --- |
| `TAG_FAST_THRESHOLD` | 0.55 | tag-or-create | Cosine ≥ this → auto-tag, no LLM. |
| `TAG_AMBIGUOUS_FLOOR` | 0.30 | tag-or-create | Below this → straight to "new pillar?" path. |
| `TAG_SECOND_PILLAR_THRESHOLD` | 0.60 | tag-or-create | Multi-tag bar — slightly higher than fast tag to avoid noise. |
| `PILLAR_DEDUP_COSINE_THRESHOLD` | 0.78 | dedup (used in tag-or-create + series + manual) | Above this, treat as same pillar even if names differ. |
| `BOOTSTRAP_TAG_THRESHOLD` | 0.40 | bootstrap | Lenient — pillars derive from these very essences. |
| `REGEN_TAG_THRESHOLD` | 0.40 | regenerate | Same reasoning as bootstrap. |
| `REGEN_PILLAR_TARGET` | 8 | regenerate | Hard cap on total pillars proposed. |
| Soft cap | 8 | UI nudge | When `pillarCount ≥ 8`, surface a "consider deleting least-tagged" banner. |
| Stale nudge | 3 untagged in 14 days | UI nudge | When recent uploads keep falling outside any pillar, prompt the user to regenerate. |

## Operational notes

**Free-tier constraints.** Every model call uses Groq (llama-3.3-70b-versatile) or HuggingFace (sentence-transformers/all-MiniLM-L6-v2). Both have free tiers. The HF inference endpoint cold-starts at 503 for ~20s — `embedText` retries 3 times with backoff.

**Race protection on pillar creation.** Three layers: a unique index on `(user_id, lower(name))` to catch dupes at the DB; the duplicate-on-insert is caught at the Node layer with `23505` detection that re-fetches the winning row; and the LLM prompt sees the full existing pillar list so duplicates rarely propose in the first place.

**Backfill for old transcripts.** Existing transcripts predate the essence column. Two paths: (a) lazy — `regeneratePillarsForUser` calls `backfillEssencesForUser` first; most users hit Regenerate eventually. (b) `POST /api/pillars/backfill-essences` processes 5 transcripts per call — call from a one-time admin script for users who never click Regenerate.

**Kill switch.** `NEW_PILLAR_PIPELINE=false` in env disables the entire new pipeline in `videos/process/route.ts`. Transcripts still save; pillar/voice-profile work just doesn't run.

## Migrations applied

- `migrations/002_pillar_overhaul.sql` — adds the new `pillars` and `transcripts` columns, indexes, and the `match_pillar_by_embedding` RPC.
- `migrations/003_pillar_subtopics.sql` — adds `pillars.subtopics text[]`.
- `migrations/004_idea_engine_v2.sql` — see `docs/idea-engine-v2.md`. Adds the v2 essence and voice-profile columns; orthogonal to pillar formation but read by the v2 idea generator.
- `migrations/005_video_pillars_unique_and_essence_topic.sql` — dedupes existing `video_pillars` rows and adds a `UNIQUE (video_id, pillar_id)` constraint so the same pillar can't be attached to a video twice. Also adds `transcripts.essence_topic` (the v2 essence's concrete topic noun phrase, promoted to its own column so `tag-or-create` and `series-detector` can read it without parsing the legacy essence string).

## Subtopic accumulation

Every tag path now appends a subtopic to `pillars.subtopics` so the idea generator's "don't retread these" rule has data on every pillar — not just the ones that hit the LLM band.

| Path | Subtopic source |
| --- | --- |
| `tag-or-create` fast-tag (cosine ≥ 0.55) | `transcripts.essence_topic` (v2 only — undefined on pre-v2 transcripts, append no-ops) |
| `tag-or-create` LLM band | The LLM-extracted `subtopic` field from the tag decision |
| `series-detector` (per-upload) | `transcripts.essence_topic` for the video being detected |
| `bootstrap` | The full subtopic list comes back from the bootstrap LLM proposal — no per-video append needed |

The `tagVideoToPillar` helper in `tag-or-create.ts` is now exported and shared by `series-detector.ts` so both paths run the same insert + `last_tagged_at` + subtopic-append sequence in one place.

## Known gaps

- **Subtopics aren't yet feeding idea generation.** They're captured but the idea generator still works from raw transcripts. Wiring subtopics into the idea prompt is the next obvious upgrade — they'd act as a list of "flavors the creator has explored under this pillar so far" to bias new ideas toward angles they haven't covered yet.
- **Soft-cap nudge has no specific recommendation surface.** It says "consider deleting" but doesn't list the least-tagged candidates yet. `last_tagged_at` is captured for this purpose.
- **No pillar-merge UI.** If a creator ends up with two pillars that should be one, they can rename one and delete the other manually, but there's no atomic merge that preserves video tags. Worth adding once we see how often this happens in practice.
