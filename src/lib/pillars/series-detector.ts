import type Groq from 'groq-sdk';
import { embedText } from './embeddings';
import { findClosestPillar, PILLAR_DEDUP_COSINE_THRESHOLD } from './dedup';
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
                content: 'Detect whether this transcript opens like a recurring series — branded intro, episode number, or a phrase like "welcome to my X series". Be conservative: a single mention of "episode" inside a casual aside does NOT count. Only flag is_series=true when the creator is clearly labeling this video as part of a named recurring series. Return only valid JSON.',
            },
            {
                role: 'user',
                content: `First 1500 chars of transcript:\n${window}\n\nReturn JSON: { "is_series": boolean, "series_name": string | null, "signals": string[] (the literal phrases that triggered detection — empty array if is_series=false) }`,
            },
        ],
    });

    let raw = completion.choices[0]?.message?.content || '';
    raw = raw.trim();
    if (raw.startsWith('```json')) raw = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    else if (raw.startsWith('```')) raw = raw.replace(/^```\n?/, '').replace(/\n?```$/, '');

    const parsed = JSON.parse(raw) as Partial<SeriesSignal>;
    return {
        is_series: parsed.is_series === true,
        series_name: typeof parsed.series_name === 'string' && parsed.series_name.trim() ? parsed.series_name.trim() : null,
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
        // Promote the existing pillar to a series. We also rewrite source_origin
        // to 'ai_series' so regenerate's preserve logic recognises the row as a
        // series — otherwise a promoted pillar that started as 'ai_detected'
        // would silently be wiped on the next regenerate.
        await supabase
            .from('pillars')
            .update({
                is_series: true,
                series_signals: signal.signals,
                source_origin: 'ai_series',
            })
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

    // Tag the video. Ignore unique-violation in case it was already tagged.
    await supabase
        .from('video_pillars')
        .insert({ video_id: videoId, pillar_id: pillarId });

    await supabase
        .from('pillars')
        .update({ last_tagged_at: new Date().toISOString() })
        .eq('id', pillarId)
        .eq('user_id', userId);

    return { created, pillarId };
}
