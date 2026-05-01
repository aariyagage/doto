import type Groq from 'groq-sdk';
import { embedText } from './embeddings';
import { findClosestPillar, PILLAR_DEDUP_COSINE_THRESHOLD } from './dedup';
import { tagVideoToPillar } from './tag-or-create';
import { getCombo } from '@/lib/colors';
import type { SupabaseServer } from './types';

// Cheap regex pre-filter. If none of these phrases appear in the first 500 chars,
// we don't even bother asking the LLM. Keeps Groq calls off most uploads.
const SERIES_INTRO_REGEX = /\b(episode|series|welcome to (?:my|the)|part \d|chapter \d|ep\.?\s*\d)\b/i;
const PRE_FILTER_WINDOW = 500;
const LLM_INPUT_WINDOW = 1500;

export interface SeriesSignal {
    is_series: boolean;
    series_name: string | null;
    signals: string[];
}

export function looksLikeSeriesIntro(transcript: string): boolean {
    return SERIES_INTRO_REGEX.test(transcript.slice(0, PRE_FILTER_WINDOW));
}

export async function detectSeriesSignals(transcript: string, groq: Groq): Promise<SeriesSignal> {
    if (!looksLikeSeriesIntro(transcript)) {
        return { is_series: false, series_name: null, signals: [] };
    }

    const window = transcript.slice(0, LLM_INPUT_WINDOW);
    const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
            {
                role: 'system',
                content: `Detect whether this transcript opens like a recurring branded series — episode number, named segment, or a phrase like "welcome to my X". Be conservative: a single passing mention of "episode" doesn't count. Only flag is_series=true when the creator is clearly labeling this video as part of a named recurring series.

CRITICAL — series_name extraction rules:
- Extract ONLY the name. NOT the framing words around it.
- Title Case. 2 to 5 words. No more.
- KEEP apostrophes in contractions ("I've", "don't", "we're", "it's"). A contraction counts as ONE word, not two. Never write "I've" as "I ve" or "Ive".
- Strip leading "my", "the", "a", "this".
- Strip trailing words like "series", "diaries", "saturdays", "videos" UNLESS they're inseparable from the name (creators often say "my X series" — keep just X unless X alone makes no sense).
- Strip explanatory phrases. The creator might say "welcome to my series where I talk about things I've been thinking about" — the NAME there is "Things I've Been Thinking About" (5 words), not the entire framing sentence.

Examples:
- "welcome to my series where I talk about things I've been thinking about" → "Things I've Been Thinking About"
- "this is episode 4 of solopreneur saturdays" → "Solopreneur Saturdays"
- "welcome back to thought daughter diaries" → "Thought Daughter Diaries"
- "today on the founder log" → "Founder Log"
- "part 3 of my mindset reset series" → "Mindset Reset"

Return only valid JSON.`,
            },
            {
                role: 'user',
                content: `First 1500 chars of transcript:\n${window}\n\nReturn JSON: { "is_series": boolean, "series_name": string | null (2-5 words, Title Case, JUST the name), "signals": string[] (the literal phrases from the transcript that triggered detection — empty array if is_series=false) }`,
            },
        ],
    });

    let raw = completion.choices[0]?.message?.content || '';
    raw = raw.trim();
    if (raw.startsWith('```json')) raw = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    else if (raw.startsWith('```')) raw = raw.replace(/^```\n?/, '').replace(/\n?```$/, '');

    const parsed = JSON.parse(raw) as Partial<SeriesSignal>;
    let seriesName: string | null = null;
    if (typeof parsed.series_name === 'string' && parsed.series_name.trim()) {
        // Defensive trimming in case the LLM ignores the prompt rules and returns
        // a long phrase. Cap at 5 words / 50 chars; if it's longer, refuse rather
        // than persist a bad pillar name. Restore apostrophes in common
        // contractions first — LLMs occasionally drop them ("I ve", "Ive",
        // "dont"), which inflates the word count and would corrupt the stored
        // name (e.g. "Things I've Been Thinking About" rendering as
        // "Things I Ve Been").
        const restored = parsed.series_name
            .trim()
            .replace(/\bI\s+ve\b/gi, "I've")
            .replace(/\bIve\b/g, "I've")
            .replace(/\bdon\s+t\b/gi, "don't")
            .replace(/\bdont\b/gi, "don't")
            .replace(/\bwe\s+re\b/gi, "we're")
            .replace(/\bit\s+s\b/gi, "it's")
            .replace(/\byou\s+re\b/gi, "you're")
            .replace(/\bcan\s+t\b/gi, "can't")
            .replace(/\bwon\s+t\b/gi, "won't");
        const cleaned = restored.replace(/^(my|the|a|this)\s+/i, '');
        const wordCount = cleaned.split(/\s+/).length;
        if (wordCount <= 5 && cleaned.length <= 50) {
            seriesName = cleaned;
        }
    }
    return {
        is_series: parsed.is_series === true && seriesName !== null,
        series_name: seriesName,
        signals: Array.isArray(parsed.signals) ? parsed.signals.filter(s => typeof s === 'string') : [],
    };
}

interface DetectAndPersistArgs {
    supabase: SupabaseServer;
    groq: Groq;
    userId: string;
    videoId: string;
    transcriptText: string;
}

// End-to-end: detect → if series, find or create the series pillar → tag the
// video into it. Non-fatal: any failure just no-ops.
export async function detectAndPersistSeriesIfApplicable(
    args: DetectAndPersistArgs,
): Promise<{ created: boolean; pillarId: string | null }> {
    const { supabase, groq, userId, videoId, transcriptText } = args;

    let signal: SeriesSignal;
    try {
        signal = await detectSeriesSignals(transcriptText, groq);
    } catch (err) {
        console.error('Series detection failed (non-fatal):', err);
        return { created: false, pillarId: null };
    }

    if (!signal.is_series || !signal.series_name) {
        return { created: false, pillarId: null };
    }

    const seriesName = signal.series_name;
    const description = `Recurring series: ${seriesName}.`;

    // Embed for dedup against existing pillars (a series may overlap with an
    // existing topic pillar — in that case we'd rather flip is_series on the
    // existing one than create a new lookalike).
    let embedding: number[];
    try {
        embedding = await embedText(`${seriesName}. ${description}`);
    } catch (err) {
        console.error('Series embedding failed (non-fatal):', err);
        return { created: false, pillarId: null };
    }

    const closest = await findClosestPillar(supabase, userId, embedding, PILLAR_DEDUP_COSINE_THRESHOLD);

    let pillarId: string;
    let created = false;

    if (closest) {
        pillarId = closest.id;
        // Two cases:
        //  (a) Existing pillar is_series=false → being promoted from topical to
        //      series for the first time. Keep its name (a topical pillar like
        //      "Cultural Commentary" shouldn't get renamed when it happens to
        //      host a series). Just flip the flag.
        //  (b) Existing pillar is_series=true → already a series, but maybe with
        //      a stale or sloppy name from older code. Rewrite the name + the
        //      description with the freshly-extracted ones so cleanup happens
        //      naturally on the next regenerate.
        const update: Record<string, unknown> = {
            is_series: true,
            series_signals: signal.signals,
            source_origin: 'ai_series',
        };
        if (closest.is_series === true) {
            update.name = seriesName;
            update.description = description;
            update.embedding = embedding;
        }
        await supabase
            .from('pillars')
            .update(update)
            .eq('id', pillarId)
            .eq('user_id', userId);
    } else {
        const { count: existingCount } = await supabase
            .from('pillars')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId);

        const colorCombo = getCombo(existingCount || 0);
        const { data: inserted, error: insertErr } = await supabase
            .from('pillars')
            .insert({
                user_id: userId,
                name: seriesName,
                description,
                embedding,
                is_series: true,
                series_signals: signal.signals,
                source: 'ai_detected',
                source_origin: 'ai_series',
                color: colorCombo.bg,
            })
            .select('id')
            .single();

        if (insertErr) {
            // Lost a race — find the row by lower(name) and tag against it.
            const { data: existing } = await supabase
                .from('pillars')
                .select('id')
                .eq('user_id', userId)
                .ilike('name', seriesName)
                .maybeSingle();
            if (!existing) {
                console.error('Series pillar insert failed and no race winner found:', insertErr);
                return { created: false, pillarId: null };
            }
            pillarId = existing.id as string;
        } else {
            pillarId = inserted!.id as string;
            created = true;
        }
    }

    // Tag the video via the shared helper. Pulls the v2 essence_topic for this
    // video so series pillars (like "Things I've Been Thinking About") accumulate
    // the per-episode topics in pillars.subtopics — without this, series pillars
    // never collected subtopics and the "don't retread" rule in idea generation
    // had no data to work with, so every batch ended up about the same theme.
    let episodeTopic: string | undefined;
    try {
        const { data: tRow } = await supabase
            .from('transcripts')
            .select('essence_topic')
            .eq('video_id', videoId)
            .eq('user_id', userId)
            .maybeSingle();
        const t = tRow?.essence_topic;
        if (typeof t === 'string' && t.trim().length > 0) {
            episodeTopic = t.trim();
        }
    } catch (err) {
        console.error('Series detection: failed to fetch episode topic (non-fatal):', err);
    }

    await tagVideoToPillar(supabase, videoId, pillarId, episodeTopic);

    return { created, pillarId };
}
