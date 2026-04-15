# Security & Production Readiness Fixes

This document tracks fixes applied to the Doto codebase following the full audit on 2026-04-12.

Each entry records: **what** changed, **where**, **why**, and **verification**.

Severity: **C**ritical / **H**igh / **M**edium / **L**ow.

---

## [Deferred] #22 — Background job pipeline

- **Decision:** Not implemented. App is targeting Vercel Pro + short-form content (Reels / TikTok / Shorts ≤ 3 min). Current pipeline + `maxDuration = 300` comfortably handles that window.
- **Deploy requirement:** Must ship on **Vercel Pro** ($20/mo) or higher. Hobby plan's 10-second function limit kills the pipeline instantly.
- **Known limitation:** Videos longer than ~5 minutes will start timing out. Videos over 10 minutes won't work at all.
- **When to revisit:** If any of these become true, move the pipeline to a background job runner (recommended: Inngest on Vercel).
    - Users regularly upload videos >3 minutes.
    - Vercel function logs show upload timeouts.
    - Product scope expands to podcasts / long vlogs.
    - You want per-step retries and a durable job dashboard.
- **Known minor risk:** HuggingFace embedding cold start adds up to 60s (three 20s retries). Non-critical — the pipeline is marked non-fatal for this step, and we still fit in the 300s budget. If it becomes annoying, reduce the retry count or skip embeddings on failure.

---

## [L] #21 — Health check endpoint + structured logger

- **Risk:** No liveness endpoint meant no signal for load balancers / uptime monitors. `console.log` everywhere produced unstructured lines that aren't parseable by ingestion pipelines.
- **Change:**
    - New `GET /api/health` returns `{ status: 'ok', timestamp }`. Intentionally does not touch Supabase or any external dependency — it answers "is the Node process up?" A future `/api/health/ready` should do the dependency ping.
    - New `src/lib/logger.ts` with `log.debug/info/warn/error(message, fields)` — emits JSON on stdout/stderr with level, message, timestamp, and caller fields. `debug` is suppressed outside `NODE_ENV=production`.
- **Note:** The existing `console.log` sites across API routes still work; adopting `log.*` can happen incrementally without breaking anything.
- **Verification:** `curl /api/health` returns 200. Logger produces parseable JSON lines.

---

## [L] #20 — Enforce password policy + confirmation on signup

- **Risk:** Signup accepted any password Supabase allowed (default minimum 6 chars). No confirmation field meant typos became undiscoverable lockouts.
- **Change:** Signup now requires:
    - ≥10 characters, at least one lowercase, one uppercase, one digit (shown as live checklist in the UI).
    - A `Confirm password` field that must match.
    - Submit button disabled until both conditions pass.
- **Verification:** Weak passwords show red criteria and block submission. Mismatched confirmation blocks submission with an inline error.

---

## [L] #19 — Replace `dangerouslySetInnerHTML` font injection with `next/font`

- **Risk:** Landing page injected a `<style>` tag via `dangerouslySetInnerHTML` to pull Cormorant Garamond from Google Fonts. Even though the content was hardcoded, this is an anti-pattern and prevents Next.js from self-hosting the font (privacy + CLS win).
- **Change:**
    - Load `Cormorant_Garamond` via `next/font/google` in `src/app/layout.tsx`, expose as CSS variable `--font-caslon`.
    - Move `.font-caslon` class to `src/app/globals.css` referencing the variable.
    - Remove the inline `<style dangerouslySetInnerHTML>` block from `src/app/page.tsx`.
- **Verification:** `font-caslon` utility still renders as Cormorant Garamond; font is now self-hosted by Next.js.

---

## [L] #18 — Remove ad hoc debug scripts from repo

- **Risk:** Repo root contained `check_db.js`, `check_ideas.js`, `test_db.js`, `test_q.js`, plus a `scripts/` directory of similar files. `scripts/check_rls.js` parsed `.env` by naive `split('=')` — silently corrupting any value containing `=`. All of these read env credentials and queried the DB with no auth.
- **Change:**
    - Deleted the files and the `scripts/` directory.
    - Added `/check_*.js`, `/test_*.js`, and `/scripts-local/` to `.gitignore` so future ad-hoc scripts don't get checked in.
- **Verification:** No `*.js` in repo root. If you still need these, retrieve them from git history (the previous commit) into a local-only directory.

---

## [M] #17 — Fix serialized `await` inside `Promise.all` in dashboard stats

- **Risk:** `supabase.from('video_pillars').select(...).in('video_id', (await supabase.from('videos').select('id')...).data?.map(v => v.id) || [])` evaluated the inner `await` before `Promise.all` started, serializing it. Also silently fell back to `[]` on error.
- **Change:** Pull the user's video IDs in an explicit first round (with an error throw on failure), then fan out the 8 dependent queries in a single `Promise.all`. Dashboard now loads in 2 DB round trips of 1+8 rather than 1 serial + 8 concurrent hidden inside one.
- **Verification:** Logic unchanged; only concurrency restructured. Failure on the video-id fetch now surfaces as a 500 with a clear message instead of returning empty chart data.

---

## [M] #16 — Paginate `GET /api/ideas` + confirmation on bulk delete

- **Risk:** Ideas endpoint returned all ideas for a user unbounded. Ever-growing payloads would degrade API and render time. `DELETE /api/ideas` (bulk) had the same destructive shape as `/api/pillars` — one stray call wipes everything.
- **Change:**
    - `GET /api/ideas` now supports `?limit=<1–200>` and `?offset=<n>`, default 50. Uses Supabase `.range(offset, offset+limit-1)`.
    - `DELETE /api/ideas` requires `{ "confirm": "DELETE_ALL_IDEAS" }` in the body — stray/replay calls return 400.
    - Client updated to send the confirmation token.
- **Verification:** Without auth → 401. Without confirmation → 400. With confirmation → success. `GET` caps at `MAX_LIMIT = 200`.

---

## [M] #15 — Verify ownership before cascading transcript delete

- **Risk:** `DELETE /api/transcripts/[id]` selected `video_id` from transcripts with no `user_id` filter. If RLS were disabled, user A providing user B's transcript id would read B's `video_id` and then the downstream `video_pillars` delete (which had no user scope) would wipe B's mappings. Also leaked existence of cross-user ids via a different response path.
- **Change:** Added `.eq('user_id', user.id)` to the ownership-check select. If the row is not found OR not owned, return 404 (don't distinguish — avoids user-id enumeration). `video_pillars` cascade now runs only after ownership is positively verified.
- **Verification:** Cross-user delete attempt → 404. Owned delete → success and cascades as expected.

---

## [M] #14 — Fix malformed JSON example in idea-generation prompt

- **Risk:** The example in the `/api/ideas/generate` system message showed `[\n    "title": ...` — missing the opening `{` of the object. LLMs sometimes mirrored that shape, forcing the parse logic to special-case multiple response shapes. Inconsistent output = higher fallback rate.
- **Change:** Corrected to valid `[{ "title": ..., "hook": ... }]` in the prompt template.
- **Verification:** The example is now itself valid JSON that `JSON.parse()` accepts.

---

## [M] #12 — Require confirmation body on bulk pillar delete

- **Risk:** `DELETE /api/pillars` (no id) wiped every pillar for a user with no body/param. A stray call (misconfigured client, replayed request, rogue extension) would destroy all content categorization with no recovery.
- **Change:** Endpoint now requires `{ "confirm": "DELETE_ALL_PILLARS" }` in the JSON body. Missing/incorrect → HTTP 400. Updated the client caller (`ideas/page.tsx`) to send the token.
- **Verification:** `curl -X DELETE /api/pillars` with auth but no body → 400. With correct body → success.

---

## [M] #11 — Remove full transcript from SSE `done` event

- **Risk:** The upload pipeline emitted `{ step: 'done', transcript: fullTranscriptText }` over SSE. The entire transcript (potentially thousands of words) was serialized into a single SSE event, inflating network transfer and leaving a copy in browser DevTools. The client already fetches the transcript from Supabase after the event completes (upload/page.tsx:133).
- **Change:** Dropped the `transcript` field from the `done` event — now only `{ step: 'done', video_id }`.
- **Verification:** Upload flow still shows the transcript after completion (fetched from DB). SSE payload is smaller and no longer leaks the text on the wire.

---

## [M] #10 — Stop leaking raw LLM output on parse failures

- **Risk:** On JSON parse failure in `/api/ideas/generate`, the route returned `{ error: "...", raw: content }` with the unsanitized LLM output — which includes user transcript excerpts and prompt internals. Any client hitting the failure path would receive sensitive data.
- **Change:** Replaced the response with a generic `{ error: 'Failed to generate ideas. Please try again.' }` + HTTP 502. The raw parse error is logged server-side for debugging.
- **Verification:** Forcing a malformed response in testing now returns the generic error. Server logs retain the detail.

---

## [H] #9 — Rate limiting on paid API endpoints

- **Risk:** `/api/videos/process`, `/api/ideas/generate`, and `/api/pillars/generate` all call paid/quota-bound vendor APIs (Groq, HuggingFace). An authenticated user could spam them in a tight loop, exhausting quota and incurring unbounded cost. The UI `isGenerating` guard is trivially bypassed by calling the API directly.
- **Change:**
    - New `src/lib/rate-limit.ts` with an in-memory sliding-window limiter and preset policies (`videoProcess`: 5/10min, `llmGeneration`: 10/min).
    - Each endpoint calls `rateLimit({ key: \`<name>:\${user.id}\`, ...policy })` right after auth and returns HTTP 429 with a `Retry-After` header on rejection.
- **Caveat:** In-memory storage only protects within a single Node process. For Vercel-style serverless with multiple cold instances, swap the store for Redis/Upstash (interface is already designed for that).
- **Verification:** Sending 6 rapid `POST /api/videos/process` calls for the same user produces a 429 on the 6th.

---

## [H] #7 — Server-side file type and size validation

- **Risk:** Upload API trusted `file.type` (client-controlled, spoofable) and had no size check. A client setting `Content-Type: video/mp4` could upload arbitrary content. `file.arrayBuffer()` on an enormous stream would exhaust process memory.
- **Change:**
    - `isAcceptedVideoFile()` validates extension against the allowlist AND rejects non-video MIME types.
    - `MAX_FILE_SIZE_BYTES` (500MB) is now enforced server-side — return HTTP 413 if exceeded.
    - Unsupported types return HTTP 415.
    - Added `export const maxDuration = 300` so Vercel gives the pipeline enough time.
- **Verification:** Server rejects `.exe` with 415, rejects `>500MB` with 413, before any disk write or `arrayBuffer()` call.

---

## [H] #8 — Switch client pages from `getSession()` to `getUser()` for scoping

- **Risk:** `supabase.auth.getSession()` returns a locally-cached session and does NOT verify with Supabase's auth server — a stored session could be stale or tampered. Using its `.user.id` to scope DB queries is unsafe. `getUser()` calls Supabase's server and validates the token.
- **Change:** In `upload`, `videos`, `ideas` pages, queries that use `user.id` as a scope filter now call `supabase.auth.getUser()` first. `getSession()` is retained **only** for extracting the JWT to forward in an `Authorization` header to our own API routes — which themselves call `getUser()`, so the server is authoritative.
- **Verification:** Searched client pages for remaining `getSession()` usage — all remaining call sites are for header-token forwarding and have an explanatory comment.

---

## [H] #6 — Scope client-side Supabase queries by `user_id`

- **Risk:** Several `from('pillars').select('*')`, `from('video_pillars').select('*')`, and `from('transcripts').select(...)` calls had no user-scope filter, depending entirely on Supabase RLS. One accidental `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` during a debugging session would leak every user's data cross-tenant.
- **Change:** Every client-side query now adds `.eq('user_id', user.id)` (where the table has a `user_id` column). For `video_pillars` — which has no `user_id` column — scoping is done via `.in('video_id', <owned video ids>)`, deriving owned video ids from the already-scoped `transcripts` query.
- **Verification:** Confirmed `pillars`, `transcripts`, `videos` all have `user_id` (see insert sites). `video_pillars` does not — so indirect scoping via owned `video_id` list is correct. Removed `[DEBUG]` console.logs that leaked session user ids to the browser console.

---

## [H] #5 — Add `GROQ_API_KEY` to `.env.example` and fail fast on missing env

- **Risk:** `GROQ_API_KEY` was required by three API routes but absent from `.env.example`. A new developer would not know to set it, and the Groq client would initialize with `undefined` and fail with an opaque auth error only on the first real request.
- **Change:**
    - Added `GROQ_API_KEY` to `.env.example`.
    - New `src/lib/env.ts` exposes `requireEnv(key)` which throws a clear error message if the key is missing.
    - Replaced raw `process.env.GROQ_API_KEY` / `process.env.HF_API_TOKEN` reads in `api/ideas/generate`, `api/pillars/generate`, `api/videos/process` with `requireEnv()`.
- **Verification:** If any required key is missing, the affected route throws immediately with `"Missing required environment variable: <KEY>"` instead of returning an opaque 500 from the vendor SDK.

---

## [C] #4 — Add `user_id` filter to `/api/pillars/generate` transcripts query

- **Risk:** `src/app/api/pillars/generate/route.ts:22-24` fetched ALL transcripts globally with `.select('raw_text')` — no `user_id` scope. If Supabase RLS was ever disabled for the `transcripts` table, every user's transcript was sent to Groq as context for every user's voice profile. Even with RLS on, relying on it alone violates defense in depth.
- **Change:** Added `.eq('user_id', user.id)`. Confirmed the `transcripts` table carries a `user_id` column (see insert at `api/videos/process/route.ts:172`).
- **Verification:** The query now returns only rows owned by the authenticated user. Also ensures voice-profile generation is not polluted by other creators' content.

---

## [C] #3 — Fix path traversal via user-controlled file extension

- **Risk:** `src/app/api/videos/process/route.ts` derived the on-disk extension from `file.name.substring(file.name.lastIndexOf('.'))`. A malicious `file.name` like `video.mp4/../../../etc/cron.d/shell` produced an extension of `./etc/cron.d/shell`, so `path.join(tmpdir, uuid + '-video' + ext)` resolved **outside** `os.tmpdir()`. An authenticated user could write arbitrary files anywhere the Node process had access.
- **Change:** Added `safeVideoExtension()` helper that uses `path.extname()` plus a strict allowlist (`.mp4 .mov .webm .m4v .mkv .avi`), defaulting to `.mp4` otherwise. Replaced the unsafe extraction at the upload site.
- **Verification:** `extname("video.mp4/../../../x")` returns `""`, which falls through to the default `.mp4`. The resulting path is always inside `os.tmpdir()`.

---

## [C] #2 — Delete unauthenticated `/api/debug` endpoint

- **Risk:** `GET /api/debug` had no auth check and returned all pillars, content_ideas, video_pillars, and transcripts. If Supabase RLS was ever disabled or misconfigured, every user's data was exposed to any anonymous HTTP caller.
- **Change:** Deleted `src/app/api/debug/route.ts` and the empty `api/debug/` directory.
- **Verification:** `grep -r "/api/debug"` across repo returns no remaining callers.

---

## [C] #1 — Upgrade Next.js to patch middleware auth bypass

- **CVE:** [GHSA-f82v-jwr5-mffw](https://github.com/advisories/GHSA-f82v-jwr5-mffw) — Authorization Bypass in Next.js Middleware (fixed in 14.2.25).
- **Risk:** The app's page-level auth relies entirely on `src/middleware.ts`. An attacker could send a crafted header (`x-middleware-subrequest`) to bypass the middleware and reach `/dashboard`, `/upload`, `/videos`, `/ideas` without a valid session.
- **Change:** Upgraded `next` and `eslint-config-next` from `14.2.15` → `^14.2.35` in `package.json`.
- **Verification:** `npm audit` no longer reports the middleware bypass advisory. Remaining advisories are DoS-class (image optimizer, RSC request deserialization, rewrites smuggling) requiring a Next 16 major upgrade — **deferred, requires user decision** (breaking change).

---
