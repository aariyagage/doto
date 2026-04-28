# Doto

Doto turns a content creator's existing videos into ongoing short-form content ideas in their own voice. Upload a few reels — Doto transcribes each one, derives the creator's voice profile and content pillars, and generates new Instagram Reel / TikTok / Shorts ideas that sound like things only that creator would post.

## How it works (one paragraph)

Each uploaded video is transcribed (Groq Whisper), then reduced to a ~300-character "essence" plus an embedding (HuggingFace MiniLM). The first two essences seed a set of broad content **pillars**; subsequent uploads are tag-or-created into existing pillars via a cosine-similarity-then-LLM ladder, with semantic dedup so "Mindset" and "Mindset Shifts" don't both get created. Series content (recurring branded segments like *"welcome to my Solopreneur Saturdays"*) is detected separately. Idea generation runs per-pillar, in parallel, with each call seeing only that pillar's tagged transcripts.

Architecture deep-dive: see [`docs/pillar-system.md`](docs/pillar-system.md).

## Stack

- **Frontend & API:** Next.js 14 (App Router), Tailwind, deployed on Vercel
- **DB & Auth:** Supabase (Postgres + pgvector + Storage + Auth)
- **LLM:** Groq (llama-3.3-70b-versatile) — free tier
- **Embeddings:** HuggingFace `sentence-transformers/all-MiniLM-L6-v2` — free tier
- **Transcription:** Groq Whisper (whisper-large-v3) — free tier
- **Audio extraction:** ffmpeg.wasm in the browser (no server-side ffmpeg required for video → audio)
- **Resumable uploads:** TUS, to bypass Vercel's request-body and Supabase's per-request size limits

## Local setup

```bash
npm install
cp .env.example .env.local   # fill in NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, GROQ_API_KEY, HF_API_TOKEN
npm run dev
```

Apply migrations in the Supabase SQL editor in numerical order:

```
migrations/001_voice_profile_enrichment.sql
migrations/002_pillar_overhaul.sql
migrations/003_pillar_subtopics.sql
```

## Documentation

- [`docs/pillar-system.md`](docs/pillar-system.md) — pillar generation, series detection, idea generation, schema, thresholds, code map, operational notes
