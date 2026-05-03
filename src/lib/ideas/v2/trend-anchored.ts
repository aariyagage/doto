// Single-idea generator anchored to a trending TikTok hashtag.
//
// Sister function to generateIdeasV2ForUser. Reuses the same prompt builder,
// pillar context, dedup, and embedding plumbing. Differences:
//   - Generates exactly ONE idea (not a batch).
//   - Passes a TrendAnchor block to the prompt and tells the model it can
//     return { no_fit: true, reason } if no honest intersection exists.
//   - Persists source_trend_hashtag on the resulting content_ideas row.

import Groq from 'groq-sdk';
import { requireEnv } from '@/lib/env';
import { embedText } from '@/lib/pillars/embeddings';
import type { SupabaseServer } from '@/lib/pillars/types';
import { PREDEFINED_ANGLES } from './angles';
import { PACKAGING_TYPES } from './packaging';
import {
    V2_SYSTEM_MESSAGE,
    buildV2UserMessage,
    type V2VoiceProfile,
    type TrendAnchor,
} from './idea-prompt';
import { buildPillarContext } from './context-builder';
import {
    filterAgainstSavedUsed,
    hookIsWeak,
    titleLooksTemplated,
} from './dedup';

export type TrendAnchoredResult =
    | { kind: 'idea'; idea: Record<string, unknown> }
    | { kind: 'no_fit'; reason: string }
    | { kind: 'error'; error: string };

type RawCandidate = {
    no_fit?: boolean;
    reason?: string;
    hook?: string;
    title?: string;
    idea?: string;
    execution?: string;
    anchor_quote?: string | null;
    tension_type?: string;
    format?: string;
};

export async function generateOneIdeaFromTrend(args: {
    supabase: SupabaseServer;
    userId: string;
    pillarId: string;
    trendAnchor: TrendAnchor;
}): Promise<TrendAnchoredResult> {
    const { supabase, userId, pillarId, trendAnchor } = args;

    const { data: voiceProfile, error: vpError } = await supabase
        .from('voice_profile')
        .select('*')
        .eq('user_id', userId)
        .single();
    if (vpError || !voiceProfile) {
        return { kind: 'error', error: 'No voice profile found. Upload videos first.' };
    }

    const { data: pillar, error: pillarError } = await supabase
        .from('pillars')
        .select('id, name, description, subtopics, is_series, embedding')
        .eq('id', pillarId)
        .eq('user_id', userId)
        .single();
    if (pillarError || !pillar) {
        return { kind: 'error', error: 'Pillar not found.' };
    }

    const context = await buildPillarContext({ supabase, userId, pillar });

    // Pick one angle + one packaging at random for variety. The trend itself
    // already biases the idea, so heavy angle/packaging engineering would over-
    // constrain the model.
    const angle = PREDEFINED_ANGLES[Math.floor(Math.random() * PREDEFINED_ANGLES.length)];
    const packaging = PACKAGING_TYPES[Math.floor(Math.random() * PACKAGING_TYPES.length)];

    const userMsg = buildV2UserMessage({
        voiceProfile: voiceProfile as V2VoiceProfile,
        pillar: context,
        angle,
        packaging,
        trendAnchor,
    });

    const groq = new Groq({ apiKey: requireEnv('GROQ_API_KEY') });

    let raw: RawCandidate;
    try {
        raw = await callGroq(groq, V2_SYSTEM_MESSAGE, userMsg);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { kind: 'error', error: `Groq call failed: ${msg}` };
    }

    // Honest no-fit signal — pass through to the caller so the UI can show it.
    if (raw.no_fit === true) {
        return { kind: 'no_fit', reason: (raw.reason || '').trim() || 'No honest fit between this trend and the creator\'s territory.' };
    }

    if (!raw.hook || !raw.title) {
        return { kind: 'error', error: 'Model returned an incomplete idea (missing hook or title).' };
    }
    if (titleLooksTemplated(raw.title)) {
        return { kind: 'error', error: 'Model returned a templated title.' };
    }
    if (hookIsWeak(raw.hook)) {
        return { kind: 'error', error: 'Model returned a weak hook.' };
    }

    const prepared = {
        title: raw.title.trim(),
        hook: raw.hook.trim(),
        idea: (raw.idea || '').trim(),
        execution: (raw.execution || '').trim(),
        anchorQuote: raw.anchor_quote?.trim() || null,
        tensionType: raw.tension_type?.trim() || null,
        format: raw.format?.trim() || null,
    };

    let embedding: number[];
    try {
        embedding = await embedText(`${prepared.title} ${prepared.hook} ${prepared.idea}`);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { kind: 'error', error: `Embedding failed: ${msg}` };
    }

    // Same history dedup as the batch path. If the trend leads the model to
    // something the creator already saved/used, we tell the user — they can
    // try a different trend.
    const dedup = await filterAgainstSavedUsed(supabase, userId, [{ idea: prepared, embedding }]);
    if (dedup.kept.length === 0) {
        return { kind: 'no_fit', reason: 'This trend produced an idea too similar to one already in your saved/used list. Try a different trend.' };
    }

    const reasoningParts = [
        prepared.idea,
        prepared.execution ? `Execution: ${prepared.execution}` : null,
        `Trend anchor: ${trendAnchor.hashtag}`,
        `Angle: ${angle.name}`,
        `Packaging: ${packaging.label}`,
        prepared.tensionType ? `Tension: ${prepared.tensionType}` : null,
        prepared.format ? `Format: ${prepared.format}` : null,
        prepared.anchorQuote ? `Anchor quote: ${prepared.anchorQuote}` : null,
    ].filter(Boolean);

    const tagForStorage = trendAnchor.hashtag.startsWith('#') ? trendAnchor.hashtag : `#${trendAnchor.hashtag}`;

    const { data: row, error: insertError } = await supabase
        .from('content_ideas')
        .insert({
            user_id: userId,
            pillar_id: pillarId,
            title: prepared.title,
            hook: prepared.hook,
            structure: prepared.execution,
            reasoning: reasoningParts.join('\n\n'),
            angle: angle.id,
            packaging_type: packaging.id,
            idea_embedding: embedding,
            source_version: 'v2',
            source_trend_hashtag: tagForStorage,
            is_saved: false,
            is_used: false,
        })
        .select()
        .single();

    if (insertError || !row) {
        console.error('generateOneIdeaFromTrend insert failed:', insertError);
        return { kind: 'error', error: insertError?.message || 'Insert failed.' };
    }

    return { kind: 'idea', idea: row as Record<string, unknown> };
}

async function callGroq(groq: Groq, systemMessage: string, userMessage: string): Promise<RawCandidate> {
    const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
            { role: 'system', content: systemMessage },
            { role: 'user', content: userMessage },
        ],
        temperature: 0.85,
        response_format: { type: 'json_object' },
    });

    let content = completion.choices[0]?.message?.content || '{}';
    if (content.startsWith('```json')) content = content.replace(/^```json\n/, '').replace(/\n```$/, '');
    else if (content.startsWith('```')) content = content.replace(/^```\n/, '').replace(/\n```$/, '');

    const parsed = JSON.parse(content.trim());
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as RawCandidate;
    }
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
        return parsed[0] as RawCandidate;
    }
    throw new Error('Model returned non-object JSON.');
}
