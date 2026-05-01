import type Groq from 'groq-sdk';
import { embedText, cosineSimilarity, parseEmbedding } from './embeddings';
import { backfillEssencesForUser } from './essence';
import { findClosestPillar, PILLAR_DEDUP_COSINE_THRESHOLD } from './dedup';
import { regenerateVoiceProfileForUser } from './voice-profile';
import { detectAndPersistSeriesIfApplicable } from './series-detector';
import { getCombo } from '@/lib/colors';
import type { SupabaseServer } from './types';

const REGEN_TAG_THRESHOLD = 0.40; // batch re-tag uses cosine only — lenient because
                                    // pillars were derived from the same essences.
const REGEN_PILLAR_TARGET = 8;

interface ProposedPillar {
    name: string;
    description: string;
    subtopics: string[];
}

// Per-video classification: ask the LLM to file each essence into a folder,
// then group videos that landed in the same folder. This matches the user's
// mental model — "this video is a vlog → file under Vlogs; this video is a
// productivity hack → file under Productivity" — instead of asking the LLM
// to invent N umbrellas up front and pray they cover the corpus.
//
// The grouping happens on the LLM side because letting it see all essences
// lets it normalize — "casual day in college" and "weekend trip with friends"
// both go under "Daily Life" because the LLM saw them in the same call.
async function classifyVideosIntoPillars(args: {
    essences: string[];
    preserved: { name: string; description: string | null; is_series: boolean }[];
    groq: Groq;
}): Promise<{
    pillars: ProposedPillar[];
    assignments: (string | null)[]; // assignments[i] = pillar name for essence i, or null = no good fit
}> {
    const { essences, preserved, groq } = args;
    const lines = essences.map((e, i) => `[${i + 1}] ${e}`).join('\n');
    const preservedBlock = preserved.length
        ? preserved.map(p => `- ${p.name}${p.is_series ? ' (series)' : ''}: ${p.description || '(no description)'}`).join('\n')
        : '(none)';

    const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
            {
                role: 'system',
                content: `You classify a creator's videos into content pillars (folders). For each video essence below, you decide which folder it belongs in. Then you list every distinct folder you used.

How to think about this:
- A pillar is a folder. Each video gets filed into exactly one folder.
- File based on WHAT THE VIDEO ACTUALLY IS — its subject or its format. A vlog about a college day belongs in "Daily Life" or "Vlogs". A video about productivity hacks belongs in "Productivity". A reflective essay belongs in "Cultural Commentary" or similar.
- Use the SAME folder name for videos that genuinely belong together. Two college vlogs are both "Daily Life", not "College Life" + "Vlogs".
- Folder names are 1-3 words. Broad enough that future videos in the same vein can also live there.
- If a video genuinely doesn't fit anywhere with the others, it can have its own folder — but only if no later video in the list shares its theme.

PRESERVE these existing pillars verbatim — if a video belongs to one, file it there. Do not rename them, do not propose synonyms:
${preservedBlock}

Naming rules:
- Title Case. 1-3 words. No qualifiers like "College", "Morning", "Female", "Pricing" — those are subtopics, not folder names.
- ✅ "Vlogs", "Productivity", "Beauty", "Cultural Commentary", "Founder Diaries", "Daily Life", "Cooking"
- ❌ "College Life" (just "Daily Life"), "Morning Routines" (just "Productivity"), "Female Voice" (just "Cultural Commentary"), "Brand X Reviews" (just "Beauty")

When in doubt: prefer fewer folders over more. A creator with 20 videos should typically have 2-5 folders, not 8+.

Return only valid JSON.`,
            },
            {
                role: 'user',
                content: `Video essences (one per video, numbered):
${lines}

Return ONLY this JSON shape:
{
  "assignments": [ { "video": <number 1..N>, "pillar": "<folder name OR null if it truly fits nothing else and shouldn't be its own folder either>" }, ... ],
  "pillars": [ { "name": "<distinct folder name used in assignments>", "description": "<one sentence>", "subtopics": [ "<1-3 word topic from one of the essences filed here>", ... ] }, ... ]
}

Rules:
- "assignments" must include EVERY video number from 1 to ${essences.length}.
- "pillars" must list every distinct name that appears in assignments (excluding null).
- "pillars" must NOT include any of the preserved pillars listed above (we already have them).
- Total NEW pillars (not counting preserved) must be ≤ ${Math.max(1, REGEN_PILLAR_TARGET - preserved.length)}.`,
            },
        ],
    });

    let raw = completion.choices[0]?.message?.content || '';
    raw = raw.trim();
    if (raw.startsWith('```json')) raw = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    else if (raw.startsWith('```')) raw = raw.replace(/^```\n?/, '').replace(/\n?```$/, '');

    const parsed = JSON.parse(raw) as { assignments?: unknown; pillars?: unknown };

    // Build the per-video assignment map. Default everyone to null (no fit) and
    // then overwrite with whatever the LLM returned.
    const assignments: (string | null)[] = essences.map(() => null);
    if (Array.isArray(parsed.assignments)) {
        for (const a of parsed.assignments as Array<Record<string, unknown>>) {
            const v = typeof a.video === 'number' ? a.video : null;
            const p = typeof a.pillar === 'string' ? a.pillar.trim() : '';
            if (v !== null && v >= 1 && v <= essences.length) {
                assignments[v - 1] = p && p.toLowerCase() !== 'null' ? p : null;
            }
        }
    }

    const proposed: ProposedPillar[] = [];
    if (Array.isArray(parsed.pillars)) {
        for (const p of parsed.pillars as Array<Record<string, unknown>>) {
            const name = typeof p.name === 'string' ? p.name.trim() : '';
            const description = typeof p.description === 'string' ? p.description.trim() : '';
            const subtopics = Array.isArray(p.subtopics)
                ? (p.subtopics as unknown[])
                    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
                    .map(s => s.trim())
                    .slice(0, 8)
                : [];
            if (name && description && name.length <= 60) {
                proposed.push({ name, description, subtopics });
            }
        }
    }

    return { pillars: proposed, assignments };
}

export interface RegenerateOptions {
    supabase: SupabaseServer;
    groq: Groq;
    userId: string;
    mode?: 'soft' | 'hard';
}

export interface RegenerateResult {
    preserved: number;
    inserted: number;
    deleted: number;
    retagged: number;
    essenceBackfill: { processed: number; failed: number; remaining: number };
}

// Manual regenerate. Soft mode preserves user-declared pillars; hard mode wipes
// everything (admin/debug only — not exposed in the UI).
export async function regeneratePillarsForUser(options: RegenerateOptions): Promise<RegenerateResult> {
    const { supabase, groq, userId, mode = 'soft' } = options;

    // 1. Backfill any missing essences first (lazy-on-demand).
    const essenceBackfill = await backfillEssencesForUser(supabase, userId, groq, 20);

    // 2. Pull all essences (with embeddings, for batch re-tag).
    const { data: transcripts, error: tErr } = await supabase
        .from('transcripts')
        .select('id, video_id, essence, essence_embedding')
        .eq('user_id', userId)
        .or('is_hidden.is.null,is_hidden.eq.false')
        .not('essence', 'is', null);

    if (tErr) throw new Error(`Failed to fetch transcripts: ${tErr.message}`);

    interface ReadyTranscript { video_id: string; essence: string; embedding: number[]; }
    const ready: ReadyTranscript[] = [];
    for (const t of transcripts || []) {
        const emb = parseEmbedding(t.essence_embedding);
        if (typeof t.essence === 'string' && emb) {
            ready.push({ video_id: t.video_id as string, essence: t.essence, embedding: emb });
        }
    }
    if (ready.length === 0) {
        throw new Error('No transcripts with essences available for regeneration.');
    }
    const essences = ready.map(t => t.essence);

    // 3. Pull existing pillars; partition into preserved vs disposable.
    const { data: existingPillars, error: pErr } = await supabase
        .from('pillars')
        .select('id, name, description, source_origin, is_series')
        .eq('user_id', userId);
    if (pErr) throw new Error(`Failed to fetch existing pillars: ${pErr.message}`);

    // Preserve every flavor of "the system or user already decided this was real":
    // manual pillars, manually declared series, AI-detected series, AND any pillar
    // currently flagged as a series (is_series=true) regardless of origin.
    // The is_series catch-all defends against earlier rows where a topical pillar
    // got promoted to a series without its source_origin being rewritten.
    const PRESERVED_ORIGINS = new Set(['user_series', 'user_manual', 'ai_series']);
    const preserved = (existingPillars || []).filter(p => {
        if (mode !== 'soft') return false;
        if (p.is_series === true) return true;
        return PRESERVED_ORIGINS.has((p.source_origin as string) || 'ai_detected');
    });
    const disposable = (existingPillars || []).filter(p => !preserved.find(pp => pp.id === p.id));

    // 4. Per-video classification: the LLM files each essence into a folder.
    //    We get back a pillar set + per-video assignments (essence index → name).
    const { pillars: proposedPillars, assignments } = await classifyVideosIntoPillars({
        essences,
        preserved: preserved.map(p => ({
            name: p.name as string,
            description: (p.description as string | null) || null,
            is_series: (p.is_series as boolean) || false,
        })),
        groq,
    });

    // 5. Embed + dedup each proposed pillar against ALL existing pillars
    //    (preserved AND disposable). Lets the loop be idempotent: a proposal
    //    that exactly matches an existing AI pillar reuses it instead of
    //    churning name/embedding rows.
    interface Candidate {
        name: string;
        description: string;
        subtopics: string[];
        embedding: number[];
        existingId: string | null;
    }
    const candidates: Candidate[] = [];
    for (const p of proposedPillars) {
        let embedding: number[];
        try {
            embedding = await embedText(`${p.name}. ${p.description}`);
        } catch (err) {
            console.error(`Regen embedding failed for "${p.name}":`, err);
            continue;
        }
        const closest = await findClosestPillar(supabase, userId, embedding, PILLAR_DEDUP_COSINE_THRESHOLD);
        candidates.push({
            name: p.name,
            description: p.description,
            subtopics: p.subtopics,
            embedding,
            existingId: closest ? closest.id : null,
        });
    }

    // 6. Decide which disposable rows to delete: any that don't appear as the
    //    "existingId" of any candidate.
    const candidateExistingIds = new Set(candidates.map(c => c.existingId).filter(Boolean) as string[]);
    const toDelete = disposable.filter(p => !candidateExistingIds.has(p.id as string));

    let deleted = 0;
    if (toDelete.length > 0) {
        const ids = toDelete.map(p => p.id as string);
        const { error: delErr } = await supabase
            .from('pillars')
            .delete()
            .in('id', ids)
            .eq('user_id', userId);
        if (delErr) {
            console.error('Regen delete failed:', delErr.message);
        } else {
            deleted = ids.length;
        }
    }

    // 7. Insert new candidates. Update existing matches with fresh
    //    description + embedding + subtopics so the LLM's better phrasing
    //    persists.
    let inserted = 0;
    const colorOffset = preserved.length;
    let colorIdx = 0;
    for (const c of candidates) {
        if (c.existingId) {
            await supabase
                .from('pillars')
                .update({
                    description: c.description,
                    embedding: c.embedding,
                    subtopics: c.subtopics,
                })
                .eq('id', c.existingId)
                .eq('user_id', userId);
            continue;
        }
        const colorCombo = getCombo(colorOffset + colorIdx);
        const { error: insertErr } = await supabase
            .from('pillars')
            .insert({
                user_id: userId,
                name: c.name,
                description: c.description,
                embedding: c.embedding,
                subtopics: c.subtopics,
                source: 'ai_detected',
                source_origin: 'ai_detected',
                color: colorCombo.bg,
            });
        if (!insertErr) {
            inserted++;
            colorIdx++;
        } else if (!/duplicate|unique/i.test(insertErr.message)) {
            console.error(`Regen insert failed for "${c.name}":`, insertErr.message);
        }
    }

    // 8. Batch re-tag. Wipe existing tags for this user's videos first, then
    //    apply the LLM's per-video assignments. We honor the LLM's choice
    //    (including assignments to preserved pillars) by name-lookup. For
    //    videos the LLM marked null OR whose assigned name doesn't resolve to
    //    an existing pillar, fall back to cosine match (lenient threshold) so
    //    the video isn't orphaned by a hallucinated name.
    const videoIds = ready.map(t => t.video_id).filter(Boolean);
    if (videoIds.length > 0) {
        const { error: clearErr } = await supabase
            .from('video_pillars')
            .delete()
            .in('video_id', videoIds);
        if (clearErr) console.error('Regen clear video_pillars failed:', clearErr.message);
    }

    const { data: refreshedPillars } = await supabase
        .from('pillars')
        .select('id, name, embedding')
        .eq('user_id', userId)
        .not('embedding', 'is', null);

    const pillarVectors: Array<{ id: string; name: string; embedding: number[] }> = [];
    const pillarsByLowerName = new Map<string, string>();
    for (const p of refreshedPillars || []) {
        const emb = parseEmbedding(p.embedding);
        if (emb) {
            const id = p.id as string;
            const name = p.name as string;
            pillarVectors.push({ id, name, embedding: emb });
            pillarsByLowerName.set(name.trim().toLowerCase(), id);
        }
    }

    const newTags: { video_id: string; pillar_id: string }[] = [];
    const taggedPillarIds = new Set<string>();
    for (let i = 0; i < ready.length; i++) {
        const t = ready[i];
        const assignedName = assignments[i];
        let resolvedPillarId: string | null = null;

        if (assignedName) {
            resolvedPillarId = pillarsByLowerName.get(assignedName.trim().toLowerCase()) || null;
        }

        if (!resolvedPillarId) {
            // Cosine fallback for null/hallucinated assignments. Same lenient
            // threshold the old code used for batch re-tag.
            let best: { id: string; sim: number } | null = null;
            for (const p of pillarVectors) {
                const sim = cosineSimilarity(t.embedding, p.embedding);
                if (!best || sim > best.sim) best = { id: p.id, sim };
            }
            if (best && best.sim >= REGEN_TAG_THRESHOLD) {
                resolvedPillarId = best.id;
            }
        }

        if (resolvedPillarId) {
            newTags.push({ video_id: t.video_id, pillar_id: resolvedPillarId });
            taggedPillarIds.add(resolvedPillarId);
        }
    }

    if (newTags.length > 0) {
        const { error: tagErr } = await supabase.from('video_pillars').insert(newTags);
        if (tagErr) console.error('Regen tag insert failed:', tagErr.message);
    }
    if (taggedPillarIds.size > 0) {
        await supabase
            .from('pillars')
            .update({ last_tagged_at: new Date().toISOString() })
            .in('id', Array.from(taggedPillarIds));
    }

    // 9. Series detection sweep. Per-upload series detection only runs on new
    //    uploads; regenerate is the chance to re-scan the entire library for
    //    any series we missed (or wiped on a prior regenerate). The detector
    //    already short-circuits on transcripts that don't look like a series
    //    intro, so this is cheap on most libraries.
    try {
        const { data: videoTranscripts } = await supabase
            .from('transcripts')
            .select('video_id, raw_text')
            .eq('user_id', userId)
            .or('is_hidden.is.null,is_hidden.eq.false')
            .not('raw_text', 'is', null);

        for (const t of videoTranscripts || []) {
            const videoId = t.video_id as string | null;
            const raw = t.raw_text as string | null;
            if (!videoId || typeof raw !== 'string' || raw.trim().length === 0) continue;
            await detectAndPersistSeriesIfApplicable({
                supabase, groq, userId, videoId,
                transcriptText: raw,
            });
        }
    } catch (err) {
        console.error('Series detection sweep during regenerate failed (non-fatal):', err);
    }

    // 10. Refresh voice profile from the same essences.
    try {
        await regenerateVoiceProfileForUser(supabase, userId, groq);
    } catch (err) {
        console.error('Voice profile regen during pillar regen failed (non-fatal):', err);
    }

    return {
        preserved: preserved.length,
        inserted,
        deleted,
        retagged: newTags.length,
        essenceBackfill,
    };
}
