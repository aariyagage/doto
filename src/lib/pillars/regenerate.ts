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

async function proposeRegeneratedPillars(args: {
    essences: string[];
    preserved: { name: string; description: string | null; is_series: boolean }[];
    groq: Groq;
}): Promise<ProposedPillar[]> {
    const { essences, preserved, groq } = args;
    const lines = essences.map((e, i) => `[${i + 1}] ${e}`).join('\n');
    const preservedBlock = preserved.length
        ? preserved.map(p => `- ${p.name}${p.is_series ? ' (series)' : ''}: ${p.description || '(no description)'}`).join('\n')
        : '(none)';

    const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        temperature: 0.4,
        response_format: { type: 'json_object' },
        messages: [
            {
                role: 'system',
                content: `You re-derive a creator's content TERRITORIES from all their video essences. Treat each essence as a glimpse — generalize to find the broad umbrella themes.

CRITICAL RULES:
- BROAD pillars only. 1-3 word names.
- Specific topics are SUBTOPICS, not pillars.
- A creator with 20 videos shouldn't have 20 pillars. They should have 2-5.
- Group lookalikes — output "Mindset" OR "Mindset Shifts", never both.
- Never propose a synonym, rephrasing, or near-duplicate of an existing preserved pillar.

GOOD examples (broad umbrellas):
- "time blocking" + "morning routine" + "focus rituals" + "Pomodoro" → "Productivity"
- "lipstick swatches" + "skincare layering" + "makeup haul" → "Beauty"
- "Q1 revenue" + "pricing experiment" + "first hire" → "Founder Diaries"
- "day in college" + "study session" + "weekend trip" → "Daily Life" or "Vlogs"
- "thought daughter" + "main character energy" + "internet feminism" → "Cultural Commentary"

BAD examples (too narrow — DO NOT do this):
- 4 college vlogs → ❌ "College Life" — that's a subtopic of "Daily Life"
- 3 morning-related productivity videos → ❌ "Morning Routines" — that's a subtopic of "Productivity"
- 2 videos about online discourse → ❌ "Female Voice" or "Internet Drama" — those are subtopics of "Cultural Commentary"

When you're tempted to use a specific qualifier in a pillar name ("College", "Morning", "Pricing", "Female"), STOP — that qualifier almost always belongs in subtopics, not the pillar name.

Return only valid JSON.`,
            },
            {
                role: 'user',
                content: `PRESERVE these user-declared pillars verbatim — DO NOT propose them again, DO NOT propose anything semantically similar:
${preservedBlock}

Essences (one per video):
${lines}

Return ONLY this JSON:
{ "pillars": [ { "name": string (1-3 words, BROAD), "description": string (one sentence), "subtopics": string[] (2-6 specific topics from the essences that live under this pillar) } ] }

CAP the total at ${REGEN_PILLAR_TARGET} pillars INCLUDING the preserved ones. So if there are ${preserved.length} preserved, return at most ${Math.max(0, REGEN_PILLAR_TARGET - preserved.length)} new pillars.`,
            },
        ],
    });

    let raw = completion.choices[0]?.message?.content || '';
    raw = raw.trim();
    if (raw.startsWith('```json')) raw = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    else if (raw.startsWith('```')) raw = raw.replace(/^```\n?/, '').replace(/\n?```$/, '');

    const parsed = JSON.parse(raw) as { pillars?: unknown };
    if (!Array.isArray(parsed.pillars)) {
        throw new Error('Regenerate response missing pillars array.');
    }

    const result: ProposedPillar[] = [];
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
            result.push({ name, description, subtopics });
        }
    }
    return result;
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

    // 4. Ask the LLM for the new AI pillar set.
    const proposed = await proposeRegeneratedPillars({
        essences,
        preserved: preserved.map(p => ({
            name: p.name as string,
            description: (p.description as string | null) || null,
            is_series: (p.is_series as boolean) || false,
        })),
        groq,
    });

    // 5. Embed + dedup each proposal against ALL existing pillars (preserved AND
    //    disposable). This lets the loop be idempotent: a proposal that exactly
    //    matches an existing AI pillar reuses it instead of churning.
    interface Candidate {
        name: string;
        description: string;
        subtopics: string[];
        embedding: number[];
        existingId: string | null;
    }
    const candidates: Candidate[] = [];
    for (const p of proposed) {
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
    //    cosine-tag every transcript against the new pillar set.
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
        .select('id, embedding')
        .eq('user_id', userId)
        .not('embedding', 'is', null);

    const pillarVectors: Array<{ id: string; embedding: number[] }> = [];
    for (const p of refreshedPillars || []) {
        const emb = parseEmbedding(p.embedding);
        if (emb) pillarVectors.push({ id: p.id as string, embedding: emb });
    }

    const newTags: { video_id: string; pillar_id: string }[] = [];
    const taggedPillarIds = new Set<string>();
    for (const t of ready) {
        let best: { id: string; sim: number } | null = null;
        for (const p of pillarVectors) {
            const sim = cosineSimilarity(t.embedding, p.embedding);
            if (!best || sim > best.sim) best = { id: p.id, sim };
        }
        if (best && best.sim >= REGEN_TAG_THRESHOLD) {
            newTags.push({ video_id: t.video_id, pillar_id: best.id });
            taggedPillarIds.add(best.id);
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
