import type Groq from 'groq-sdk';
import { embedText } from './embeddings';
import type { SupabaseServer } from './types';

const ESSENCE_MIN = 220;
const ESSENCE_MAX = 360;
const ESSENCE_INPUT_CAP = 12_000;

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

    let raw = completion.choices[0]?.message?.content || '';
    raw = raw.trim();
    if (raw.startsWith('```json')) raw = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    else if (raw.startsWith('```')) raw = raw.replace(/^```\n?/, '').replace(/\n?```$/, '');

    const parsed = JSON.parse(raw) as { essence?: unknown };
    const essence = typeof parsed.essence === 'string' ? parsed.essence.trim() : '';
    if (!essence) throw new Error('Essence response was empty.');

    // Hard-trim if the LLM ignores the upper bound. Lower bound is advisory —
    // shorter essences still carry signal.
    return essence.length > ESSENCE_MAX ? essence.slice(0, ESSENCE_MAX) : essence;
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
        // Refuse to summarize empty/near-empty transcripts.
        throw new Error(`Transcript ${transcriptId} too short for essence generation.`);
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
