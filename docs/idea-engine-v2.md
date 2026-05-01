# Idea Engine v2

How Doto turns "tagged transcripts under a pillar" into ideas the creator would actually film. v1 produced pillar-anchored ideas via one big prompt; v2 layers angle and packaging on top so each idea has a distinct shape and stance.

This is Phase 1. Phase 2 (gap detection, hybrid retrieval, scoring) and Phase 3 (user controls, remix, idea memory) build on top of these primitives without further migrations.

## Why v2 exists

v1 ideas drifted toward sameness inside a pillar. Same hook register, same tension shape, same "Most people think X" opener across batches. The structural fix is to vary two axes the creator-voice prompt was implicitly collapsing:

- **Angle** — the stance the idea takes (unpopular opinion, beginner mistake, contrarian take, ...).
- **Packaging** — the shape the idea takes (contradiction, POV, story, hot take, listicle, ...).

In v2, the orchestrator assigns one (angle, packaging) tuple per idea and the prompt is told the hook MUST reflect the assigned packaging. tension_type and format are still emitted as secondary descriptors but no longer drive batch diversity.

## Feature flag

```
IDEA_ENGINE_V2=true   # opt-in
```

Read in two places only: `src/app/api/ideas/generate/route.ts` (switches the orchestrator) and `src/lib/pillars/essence.ts` + `src/lib/pillars/voice-profile.ts` (switch their prompts). When unset or any value other than `'true'`, every code path falls through to v1 — including the upload pipeline, which keeps producing v1 essences and v1 voice profiles.

This mirrors the `NEW_PILLAR_PIPELINE` pattern used to gate the original pillar overhaul.

## Pipeline diagram

```
upload  →  transcribe  →  essence v2 (core_idea, hook, takeaway)
                       →  hook embedding (if hook present)
                       →  essence_embedding (over core_idea + takeaway)
                       →  pillar tag-or-create (unchanged)
                       →  voice profile v2 (adds primary_style, hook_patterns, energy, ...)

generate ideas (per pillar) →  buildPillarContext (transcripts, subtopics, voice)
                            →  pickAnglesForBatch (N from predefined pool)
                            →  shufflePackagingForBatch (N from 8 PRD types, no-repeat)
                            →  for each (angle, packaging):
                                    Groq call → validate → embed
                            →  dedupe within batch (cosine ≥ 0.85)
                            →  filter against saved/used (cosine ≥ 0.85)
                            →  insert with source_version='v2'
```

## Module layout

```
src/lib/ideas/v2/
  index.ts            — generateIdeasV2ForUser (orchestrator)
  context-builder.ts  — per-pillar transcript/subtopic/voice context (Phase 2: hybrid)
  angles.ts           — predefined angle pool + picker (Phase 2: gap-derived)
  packaging.ts        — 8 PRD packaging types + Fisher-Yates shuffle
  idea-prompt.ts      — V2_SYSTEM_MESSAGE + buildV2UserMessage
  dedup.ts            — within-batch + saved/used cosine dedup, hook/title sanity
```

v1 (`src/lib/ideas/generate.ts`) is untouched. Both functions return the same shape so the API route picks one with no other changes.

## Database changes

Migration `004_idea_engine_v2.sql`. **Strictly additive — no drops, no renames.**

`transcripts`: `essence_core_idea`, `essence_hook`, `essence_takeaway`, `hook_embedding`. The legacy `essence` column stays as the source of truth for pillar tagging — when v2 is on it gets the concat `core_idea — takeaway` so `essence_embedding` (used by tag-or-create) carries angle + upshot.

`voice_profile`: `primary_style`, `secondary_styles[]`, `hook_patterns[]`, `sentence_style`, `energy`. v1 fields (`tone_descriptors`, `recurring_phrases`, `content_style`, etc.) all stay. The v2 idea prompt prefers v2 fields when present and falls back to v1 fields, so old voice profiles still produce v2 ideas — they just get a richer prompt the next time the user regenerates.

`content_ideas`: `angle`, `packaging_type`, `score (jsonb)`, `idea_embedding`, `source_version (default 'v1')`. The `score` column is provisioned now so the Phase 2 scorer can populate it without another migration. No ivfflat index on `idea_embedding` yet — Phase 1 only compares within an in-memory batch, and the saved/used filter is capped at 200 rows.

New RPC `match_transcripts_by_essence(user_id, embedding, exclude_pillar_id?, limit?)` — Phase 2 will use it for the 30% cross-pillar slice in hybrid retrieval.

## Prompt design

### Essence v2

Replaces the v1 "one paragraph" essence with three structured fields:

- `core_idea` — must capture the **angle** of the video, not the topic. The prompt is grounded in a bad/good example pair: ❌ `"people struggle with productivity because they lack discipline"` vs ✅ `"people fail at productivity because they rely on motivation instead of reducing decisions"`. The instruction is explicit: include a specific mechanism, scenario, or perspective.
- `hook` — the literal opening line if it functions as a hook, otherwise `null`. No paraphrasing or invention. Filler intros ("hey guys", "what's up") return `null`.
- `takeaway` — what the viewer is supposed to walk away believing or doing.

When persisted, the legacy `essence` column gets `core_idea — takeaway` so pillar tagging keeps working without code changes.

### Voice profile v2

Same prompt as v1 with five additional fields appended. New fields are extracted only when the flag is on; old rows keep their v1 columns until the user regenerates. The v2 idea prompt reads `primary_style` first, falls back to `content_style` if null — no breakage for legacy profiles.

### Idea generation v2

One Groq call per (pillar, angle, packaging) tuple. The system message commits to three rules:

1. **Cardinal rule** — do not invent specifics not present in the transcripts.
2. **Packaging is the primary axis** — the assigned packaging dictates the hook shape.
3. **Avoid retreading subtopics** — `pillars.subtopics` is included verbatim in the user message.

Each packaging type carries a hook contract baked into the user message. Examples:

- `contradiction` — hook must explicitly challenge a widely-held belief, state the belief and signal the reversal.
- `pov` — hook must read first-person from a specific perspective.
- `story` — hook must drop the viewer into a scene mid-action; if transcripts don't support a real scene, do not use this packaging.
- `mistake_callout` — hook must point at a specific mistake the viewer is probably making, second-person.

(Full list: `src/lib/ideas/v2/packaging.ts`.)

## Dedup (Phase 1 only)

Two stages, both cosine-based on `idea_embedding` (MiniLM-384):

1. **Within-batch** — drop pairwise duplicates at threshold 0.85. Distinct angles in the same pillar typically cluster around 0.5–0.7 cosine, so 0.85 catches near-paraphrases without nuking the batch.
2. **Saved/used filter** — fetch up to 200 of the user's `is_saved=true OR is_used=true` rows that have an `idea_embedding`, drop new ideas that are too close. v1 history (no embedding) is naturally ignored. Fails open on DB error.

Full history dedup is out of scope for Phase 1. The `idea_embedding` column is populated now so it can be turned on later with no migration.

## Cost & resilience

Per-pillar Groq calls go from 1 (v1) to N (v2, where N = perPillarCount, default 3, max 5). Concurrency stays at `PILLAR_CONCURRENCY=2` to respect the Groq free-tier 12k TPM ceiling — within a pillar, calls are sequential.

HuggingFace embedding usage adds:

- 1 hook embedding per upload, only when the v2 essence emits a non-null hook
- 1 idea embedding per accepted candidate

The existing 3-attempt retry on 503 (`embeddings.ts:9-43`) already handles cold starts. If embedding fails for a single idea, the orchestrator drops that idea and continues — generation never blocks on HF.

## Rollout

| Phase | Flag | Adds |
| --- | --- | --- |
| 1 | `IDEA_ENGINE_V2=true` | structured essence, voice profile v2 fields, angle × packaging × subtopics in idea prompt, batch + saved/used dedup |
| 2 | same flag | gap detection, 70/30 hybrid retrieval, batched scoring layer with rank-only top N |
| 3 | same flag | UI controls (style toggle, packaging preference), remix button, idea memory |

Reverting = unset the env var. v1 path is untouched.
