import type Groq from 'groq-sdk';
import { embedText, cosineSimilarity, parseEmbedding } from './embeddings';
import { regenerateVoiceProfileForUser } from './voice-profile';
import { getCombo } from '@/lib/colors';
import type { SupabaseServer } from './types';

// Lenient — bootstrap pillars are derived from these very essences, so the
// best-matching pillar is almost always the right home for the video.
const BOOTSTRAP_TAG_THRESHOLD = 0.40;

interface ProposedPillar {
    name: string;
    description: string;
    subtopics: string[];
}

async function proposeBootstrapPillars(
    essences: string[],
    groq: Groq,
): Promise<ProposedPillar[]> {
    const lines = essences.map((e, i) => `[${i + 1}] ${e}`).join('\n');

    const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        temperature: 0.4,
        response_format: { type: 'json_object' },
        messages: [
            {
                role: 'system',
                content: `You map a creator's content TERRITORIES from video summaries. Treat each summary as a glimpse — generalize to find the broad umbrella theme that contains it.

CRITICAL RULES:
- Output 1-3 BROAD pillars only. Pillar names are 1-3 words. NEVER more than 3.
- Specific topics are SUBTOPICS, not pillars.
- If multiple videos share a vibe, format, or umbrella — even tangentially — they MUST go under one pillar.
- A creator who uploaded 5 videos shouldn't have 5 pillars. They should have 1-2.
- DO NOT name a pillar after a specific aspect of one video. Name it after the territory all the videos collectively occupy.

GOOD examples (broad umbrellas):
- 4 vlogs about a college student's day → "Daily Life" or "Vlogs" (NOT "College Life", "Study Routines", or "Campus Diaries" — those are subtopics)
- "time blocking" + "morning routine" + "focus rituals" → "Productivity" (subtopics: time blocking, morning routine, focus rituals)
- "lipstick swatches" + "skincare layering" + "haul" → "Beauty"
- "Q1 revenue" + "pricing experiment" + "first hire" → "Founder Diaries"
- "thought daughter aesthetic" + "main character energy" → "Cultural Commentary"
- "what i eat in a day" + "groceries" + "meal prep" → "Food" or "Lifestyle"

BAD examples (too narrow — DO NOT do this):
- 4 vlogs from a college student → ❌ "College Life" (this is a subtopic of "Daily Life")
- 3 makeup videos featuring a specific brand → ❌ "Brand X Reviews" (this is a subtopic of "Beauty")
- 2 productivity videos about mornings → ❌ "Morning Routines" (this is a subtopic of "Productivity")

When you're tempted to use a specific qualifier in the pillar name (e.g. "College", "Morning", "Pricing"), STOP — that qualifier almost always belongs in subtopics, not the pillar name. The pillar name should still apply if the creator uploads adjacent content next month.

Return only valid JSON. No markdown.`,
            },
            {
                role: 'user',
                content: `Essences (one per video):\n${lines}\n\nReturn ONLY this JSON:\n{ "pillars": [ { "name": string (1-3 words, BROAD), "description": string (one sentence describing the territory), "subtopics": string[] (2-4 specific topics from the essences that live under this pillar) } ] }`,
            },
        ],
    });

    let raw = completion.choices[0]?.message?.content || '';
    raw = raw.trim();
    if (raw.startsWith('```json')) raw = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    else if (raw.startsWith('```')) raw = raw.replace(/^```\n?/, '').replace(/\n?```$/, '');

    const parsed = JSON.parse(raw) as { pillars?: unknown };
    if (!Array.isArray(parsed.pillars)) {
        throw new Error('Bootstrap pillar response missing pillars array.');
    }

    const result: ProposedPillar[] = [];
    for (const p of parsed.pillars as Array<Record<string, unknown>>) {
        const name = typeof p.name === 'string' ? p.name.trim() : '';
        const description = typeof p.description === 'string' ? p.description.trim() : '';
        const subtopics = Array.isArray(p.subtopics)
            ? (p.subtopics as unknown[])
                .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
                .map(s => s.trim())
                .slice(0, 6)
            : [];
        if (name.length > 0 && name.length <= 60 && description.length > 0) {
            result.push({ name, description, subtopics });
        }
    }
    if (result.length === 0) throw new Error('Bootstrap proposed no usable pillars.');
    return result.slice(0, 3);
}

interface BootstrapArgs {
    supabase: SupabaseServer;
    groq: Groq;
    userId: string;
}

// Runs once when the user has exactly 2 eligible transcripts. Generates the
// first pillar set from both essences, persists pillar embeddings + descriptions
// + subtopics, tags each existing video to its best-matching pillar via cosine,
// and finally generates the voice profile from the same essences.
export async function bootstrapPillarsForUser(args: BootstrapArgs): Promise<{ created: number }> {
    const { supabase, groq, userId } = args;

    // 1. Pull the user's transcripts (with essence + embedding) + their videos.
    const { data: transcripts, error: tErr } = await supabase
        .from('transcripts')
        .select('id, video_id, essence, essence_embedding')
        .eq('user_id', userId)
        .or('is_hidden.is.null,is_hidden.eq.false')
        .not('essence', 'is', null);

    if (tErr) throw new Error(`Failed to fetch transcripts for bootstrap: ${tErr.message}`);

    interface ReadyTranscript { video_id: string; essence: string; embedding: number[]; }
    const ready: ReadyTranscript[] = [];
    for (const t of transcripts || []) {
        const emb = parseEmbedding(t.essence_embedding);
        if (typeof t.essence === 'string' && emb) {
            ready.push({ video_id: t.video_id as string, essence: t.essence, embedding: emb });
        }
    }
    if (ready.length === 0) {
        throw new Error('Bootstrap aborted: no transcripts with essences yet.');
    }

    const essences = ready.map(t => t.essence);

    // 2. Ask the LLM for the initial pillar set.
    const proposed = await proposeBootstrapPillars(essences, groq);

    // 3. Embed + insert each proposal.
    interface InsertedPillar { id: string; embedding: number[]; }
    const inserted: InsertedPillar[] = [];

    for (let idx = 0; idx < proposed.length; idx++) {
        const p = proposed[idx];
        let embedding: number[];
        try {
            embedding = await embedText(`${p.name}. ${p.description}`);
        } catch (err) {
            console.error(`Bootstrap embedding failed for "${p.name}":`, err);
            continue;
        }

        const colorCombo = getCombo(idx);
        const { data: row, error: insertErr } = await supabase
            .from('pillars')
            .insert({
                user_id: userId,
                name: p.name,
                description: p.description,
                embedding,
                subtopics: p.subtopics,
                source: 'ai_detected',
                source_origin: 'ai_detected',
                color: colorCombo.bg,
            })
            .select('id')
            .single();

        if (insertErr) {
            const { data: existing } = await supabase
                .from('pillars')
                .select('id, embedding')
                .eq('user_id', userId)
                .ilike('name', p.name)
                .maybeSingle();
            const existingEmb = existing ? parseEmbedding(existing.embedding) : null;
            if (existing && existingEmb) {
                inserted.push({ id: existing.id as string, embedding: existingEmb });
            } else {
                console.error(`Bootstrap insert failed for "${p.name}":`, insertErr);
            }
            continue;
        }

        inserted.push({ id: row!.id as string, embedding });
    }

    if (inserted.length === 0) {
        throw new Error('Bootstrap created no pillars.');
    }

    // 4. Tag each video to its best-matching pillar via cosine. Lenient threshold
    //    since pillars were derived from these very essences.
    const tagRows: { video_id: string; pillar_id: string }[] = [];
    const taggedPillarIds = new Set<string>();

    for (const t of ready) {
        let best: { id: string; sim: number } | null = null;
        for (const p of inserted) {
            const sim = cosineSimilarity(t.embedding, p.embedding);
            if (!best || sim > best.sim) best = { id: p.id, sim };
        }
        if (best && best.sim >= BOOTSTRAP_TAG_THRESHOLD) {
            tagRows.push({ video_id: t.video_id, pillar_id: best.id });
            taggedPillarIds.add(best.id);
        }
    }

    if (tagRows.length > 0) {
        const { error: tagErr } = await supabase.from('video_pillars').insert(tagRows);
        if (tagErr && !tagErr.message.toLowerCase().includes('duplicate')) {
            console.error('Bootstrap tag insert failed:', tagErr);
        }
    }

    // 5. Stamp last_tagged_at on every pillar that received at least one video.
    if (taggedPillarIds.size > 0) {
        await supabase
            .from('pillars')
            .update({ last_tagged_at: new Date().toISOString() })
            .in('id', Array.from(taggedPillarIds));
    }

    // 6. Generate the voice profile from these essences. Non-fatal — pillars
    //    are the main artifact; voice profile is enrichment.
    try {
        await regenerateVoiceProfileForUser(supabase, userId, groq);
    } catch (err) {
        console.error('Voice profile generation during bootstrap failed (non-fatal):', err);
    }

    return { created: inserted.length };
}
