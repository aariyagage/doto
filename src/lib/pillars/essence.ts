import type Groq from 'groq-sdk';
import { embedText } from './embeddings';
import type { SupabaseServer } from './types';

const ESSENCE_MAX = 480;
const ESSENCE_INPUT_CAP = 12_000;

const TOPIC_MAX = 80;
const CORE_IDEA_MAX = 160;
const HOOK_MAX = 100;
const TAKEAWAY_MAX = 160;

function isV2Enabled(): boolean {
    return process.env.IDEA_ENGINE_V2 === 'true';
}

function stripCodeFences(raw: string): string {
    let out = raw.trim();
    if (out.startsWith('```json')) out = out.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    else if (out.startsWith('```')) out = out.replace(/^```\n?/, '').replace(/\n?```$/, '');
    return out;
}

export async function generateEssence(transcriptText: string, groq: Groq): Promise<string> {
    const input = transcriptText.length > ESSENCE_INPUT_CAP
        ? transcriptText.slice(0, ESSENCE_INPUT_CAP)
        : transcriptText;

    const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
            {
                role: 'system',
                content: 'You summarize a creator\'s video transcript for a content-themes index. Return ONE plain-prose paragraph between 250 and 320 characters. Capture: (1) the actual topic — not the format, (2) any specific people, numbers, or stories named, (3) the angle or argument. No markdown, no preamble. Return ONLY valid JSON.',
            },
            {
                role: 'user',
                content: `Transcript:\n${input}\n\nReturn JSON: { "essence": string }`,
            },
        ],
    });

    const raw = stripCodeFences(completion.choices[0]?.message?.content || '');
    const parsed = JSON.parse(raw) as { essence?: unknown };
    const essence = typeof parsed.essence === 'string' ? parsed.essence.trim() : '';
    if (!essence) throw new Error('Essence response was empty.');

    return essence.length > ESSENCE_MAX ? essence.slice(0, ESSENCE_MAX) : essence;
}

export type EssenceV2 = {
    topic: string;       // concrete subject of the video (2-6 words). Anchors topical signal so pillar tagging doesn't collapse under angle-only abstraction.
    core_idea: string;   // the angle — must include a specific mechanism, scenario, or perspective
    hook: string | null; // the literal opening line if present, else null
    takeaway: string;    // what the viewer leaves with
};

export async function generateEssenceV2(transcriptText: string, groq: Groq): Promise<EssenceV2> {
    const input = transcriptText.length > ESSENCE_INPUT_CAP
        ? transcriptText.slice(0, ESSENCE_INPUT_CAP)
        : transcriptText;

    const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
            {
                role: 'system',
                content: [
                    'You index a creator\'s video transcripts for an idea-generation system.',
                    'Return JSON with four fields: topic, core_idea, hook, takeaway.',
                    '',
                    'topic (≤80 chars): the concrete SUBJECT of the video as a 2-6 word noun phrase. Plain and topical — the domain the video lives in, not the argument it makes. This is what gets matched against content pillars.',
                    '  ❌ "the importance of being yourself" (that\'s a stance, not a topic)',
                    '  ✅ "creativity and originality"',
                    '  ❌ "things that matter in life"',
                    '  ✅ "saving content online"',
                    '  ❌ "interesting observations"',
                    '  ✅ "childhood time perception"',
                    '  ✅ "morning routines"',
                    '  ✅ "founder pricing experiments"',
                    '',
                    'core_idea (≤160 chars): the ANGLE of the video, not the topic. It MUST name a specific mechanism, scenario, or perspective — not a general claim.',
                    '  ❌ "people struggle with productivity because they lack discipline"',
                    '  ✅ "people fail at productivity because they rely on motivation instead of reducing decisions"',
                    '  ❌ "this video talks about productivity"',
                    '  ✅ "morning routines fail because they front-load decisions before willpower has recovered"',
                    '',
                    'hook (≤100 chars or null): the LITERAL opening line of the transcript if it functions as a hook. If the transcript opens with filler ("hey guys", "what\'s up") or a generic intro, return null. Do not paraphrase or invent.',
                    '',
                    'takeaway (≤160 chars): what the viewer is supposed to walk away believing or doing. Be specific.',
                    '',
                    'Hard rules: no markdown, no preamble, no invented specifics, no quoting numbers/names that aren\'t in the transcript. Return ONLY valid JSON.',
                ].join('\n'),
            },
            {
                role: 'user',
                content: `Transcript:\n${input}\n\nReturn JSON: { "topic": string, "core_idea": string, "hook": string | null, "takeaway": string }`,
            },
        ],
    });

    const raw = stripCodeFences(completion.choices[0]?.message?.content || '');
    const parsed = JSON.parse(raw) as { topic?: unknown; core_idea?: unknown; hook?: unknown; takeaway?: unknown };

    const topic = typeof parsed.topic === 'string' ? parsed.topic.trim() : '';
    const core_idea = typeof parsed.core_idea === 'string' ? parsed.core_idea.trim() : '';
    const takeaway = typeof parsed.takeaway === 'string' ? parsed.takeaway.trim() : '';
    const hookRaw = typeof parsed.hook === 'string' ? parsed.hook.trim() : '';
    const hook = hookRaw && hookRaw.toLowerCase() !== 'null' ? hookRaw : null;

    if (!topic) throw new Error('Essence v2 missing topic.');
    if (!core_idea) throw new Error('Essence v2 missing core_idea.');
    if (!takeaway) throw new Error('Essence v2 missing takeaway.');

    return {
        topic: topic.length > TOPIC_MAX ? topic.slice(0, TOPIC_MAX) : topic,
        core_idea: core_idea.length > CORE_IDEA_MAX ? core_idea.slice(0, CORE_IDEA_MAX) : core_idea,
        hook: hook && hook.length > HOOK_MAX ? hook.slice(0, HOOK_MAX) : hook,
        takeaway: takeaway.length > TAKEAWAY_MAX ? takeaway.slice(0, TAKEAWAY_MAX) : takeaway,
    };
}

// Concat used as the legacy `essence` column when v2 is on. Pillar tagging
// matches against essence_embedding, so we want this string to carry topical
// signal first (so videos cluster by domain) followed by the angle + upshot.
// Topic-leading layout restores the per-video separation that pure angle/takeaway
// essences lost — without it, every reflective video embeds close enough to
// auto-tag into one umbrella pillar like "Personal Growth".
function composeLegacyEssence(parts: EssenceV2): string {
    const concat = `${parts.topic} // ${parts.core_idea} // ${parts.takeaway}`;
    return concat.length > ESSENCE_MAX ? concat.slice(0, ESSENCE_MAX) : concat;
}

// Idempotent: skips if essence_generated_at is already set. Generates the
// essence + its embedding and writes both in a single UPDATE.
export async function ensureEssenceForTranscript(
    supabase: SupabaseServer,
    transcriptId: string,
    groq: Groq,
): Promise<{ skipped: boolean }> {
    const { data: row, error: fetchErr } = await supabase
        .from('transcripts')
        .select('id, raw_text, essence_generated_at')
        .eq('id', transcriptId)
        .single();

    if (fetchErr || !row) {
        throw new Error(`Failed to fetch transcript ${transcriptId}: ${fetchErr?.message || 'not found'}`);
    }
    if (row.essence_generated_at) return { skipped: true };

    const text = (row.raw_text as string) || '';
    if (text.trim().length < 20) {
        throw new Error(`Transcript ${transcriptId} too short for essence generation.`);
    }

    if (isV2Enabled()) {
        const parts = await generateEssenceV2(text, groq);
        const legacy = composeLegacyEssence(parts);
        const embedding = await embedText(legacy);
        const hook_embedding = parts.hook ? await embedText(parts.hook) : null;

        const { error: updateErr } = await supabase
            .from('transcripts')
            .update({
                essence: legacy,
                essence_topic: parts.topic,
                essence_core_idea: parts.core_idea,
                essence_hook: parts.hook,
                essence_takeaway: parts.takeaway,
                essence_embedding: embedding,
                hook_embedding,
                essence_generated_at: new Date().toISOString(),
            })
            .eq('id', transcriptId);

        if (updateErr) {
            throw new Error(`Failed to persist essence v2 for ${transcriptId}: ${updateErr.message}`);
        }
        return { skipped: false };
    }

    const essence = await generateEssence(text, groq);
    const embedding = await embedText(essence);

    const { error: updateErr } = await supabase
        .from('transcripts')
        .update({
            essence,
            essence_embedding: embedding,
            essence_generated_at: new Date().toISOString(),
        })
        .eq('id', transcriptId);

    if (updateErr) {
        throw new Error(`Failed to persist essence for ${transcriptId}: ${updateErr.message}`);
    }
    return { skipped: false };
}

// Generates essences for any of a user's transcripts that don't have one yet.
// Capped at `limit` per call so a single regenerate doesn't burn the Groq free
// tier on a large back catalogue. Returns counts so callers can paginate.
export async function backfillEssencesForUser(
    supabase: SupabaseServer,
    userId: string,
    groq: Groq,
    limit = 20,
): Promise<{ processed: number; failed: number; remaining: number }> {
    const { data: missing, error } = await supabase
        .from('transcripts')
        .select('id')
        .eq('user_id', userId)
        .is('essence_generated_at', null)
        .or('is_hidden.is.null,is_hidden.eq.false')
        .limit(limit);

    if (error) throw new Error(`Failed to list transcripts missing essences: ${error.message}`);

    let processed = 0;
    let failed = 0;
    for (const row of missing || []) {
        try {
            await ensureEssenceForTranscript(supabase, row.id as string, groq);
            processed++;
        } catch (err) {
            console.error(`Essence backfill failed for transcript ${row.id}:`, err);
            failed++;
        }
    }

    const { count: remaining } = await supabase
        .from('transcripts')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .is('essence_generated_at', null)
        .or('is_hidden.is.null,is_hidden.eq.false');

    return { processed, failed, remaining: remaining || 0 };
}
