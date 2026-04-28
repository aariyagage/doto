import type Groq from 'groq-sdk';
import type { SupabaseServer } from './types';

const ESSENCE_BUDGET = 30_000;

interface VoiceProfileResult {
    tone_descriptors: string[];
    recurring_phrases: string[];
    content_style: string;
    niche_summary: string;
    signature_argument: string | null;
    enemy_or_foil: string[];
    would_never_say: string[];
}

// Pure voice-profile generation. Operates on per-transcript essences (cheap)
// rather than raw transcripts, so we never re-hit the 6k truncation problem.
export async function generateVoiceProfileFromEssences(
    essences: string[],
    groq: Groq,
): Promise<VoiceProfileResult> {
    let combined = essences.map((e, i) => `[Video ${i + 1}] ${e}`).join('\n\n');
    if (combined.length > ESSENCE_BUDGET) {
        combined = combined.slice(0, ESSENCE_BUDGET);
    }

    const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
            {
                role: 'system',
                content: 'You analyze a creator\'s video essences (one short summary per video) to capture their voice and worldview. You are specific and personal. Everything you return must reflect THIS creator — not a generic creator. Return only valid JSON, no markdown, no explanation.',
            },
            {
                role: 'user',
                content: `Here are essence summaries from this creator's videos (one per video):\n\n${combined}\n\nReturn ONLY this JSON object:\n{\n  "tone_descriptors": string[] (3-5 single adjectives that describe exactly how this person talks),\n  "recurring_phrases": string[] (up to 6 short phrases this creator actually repeats),\n  "content_style": string (exactly one of: story-driven, listicle, how-to, conversational, educational),\n  "niche_summary": string (1-2 sentences on what this creator specifically makes and exactly who their audience is — be specific, not generic),\n  "signature_argument": string (the contrarian belief or core thesis this creator returns to most often. One sentence. Must be specific enough that a different creator would disagree with it. Bad: 'Hard work matters.' Good: 'Most people optimize the wrong thing first — pricing, not product.'),\n  "enemy_or_foil": string[] (2-4 things, ideologies, or types of people this creator pushes back against),\n  "would_never_say": string[] (3 specific sentences this creator would never say out loud, given their worldview. Concrete sentences, not categories.)\n}`,
            },
        ],
    });

    let raw = completion.choices[0]?.message?.content || '';
    raw = raw.trim();
    if (raw.startsWith('```json')) raw = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    else if (raw.startsWith('```')) raw = raw.replace(/^```\n?/, '').replace(/\n?```$/, '');

    const parsed = JSON.parse(raw) as Partial<VoiceProfileResult>;

    if (!parsed.tone_descriptors || !parsed.recurring_phrases || !parsed.content_style || !parsed.niche_summary) {
        throw new Error('Voice profile response missing required keys.');
    }

    return {
        tone_descriptors: Array.isArray(parsed.tone_descriptors) ? parsed.tone_descriptors : [],
        recurring_phrases: Array.isArray(parsed.recurring_phrases) ? parsed.recurring_phrases : [],
        content_style: parsed.content_style,
        niche_summary: parsed.niche_summary,
        signature_argument: typeof parsed.signature_argument === 'string' ? parsed.signature_argument : null,
        enemy_or_foil: Array.isArray(parsed.enemy_or_foil) ? parsed.enemy_or_foil : [],
        would_never_say: Array.isArray(parsed.would_never_say) ? parsed.would_never_say : [],
    };
}

export async function regenerateVoiceProfileForUser(
    supabase: SupabaseServer,
    userId: string,
    groq: Groq,
): Promise<void> {
    const { data: rows, error } = await supabase
        .from('transcripts')
        .select('essence')
        .eq('user_id', userId)
        .or('is_hidden.is.null,is_hidden.eq.false')
        .not('essence', 'is', null);

    if (error) throw new Error(`Failed to fetch essences for voice profile: ${error.message}`);

    const essences = (rows || [])
        .map(r => (r.essence as string | null) || '')
        .filter(s => s.trim().length > 0);

    if (essences.length === 0) {
        throw new Error('No essences available for voice profile generation.');
    }

    const profile = await generateVoiceProfileFromEssences(essences, groq);

    const { error: upsertErr } = await supabase
        .from('voice_profile')
        .upsert(
            {
                user_id: userId,
                tone_descriptors: profile.tone_descriptors,
                recurring_phrases: profile.recurring_phrases,
                content_style: profile.content_style,
                niche_summary: profile.niche_summary,
                signature_argument: profile.signature_argument,
                enemy_or_foil: profile.enemy_or_foil,
                would_never_say: profile.would_never_say,
                last_updated: new Date().toISOString(),
            },
            { onConflict: 'user_id' },
        );

    if (upsertErr) throw new Error(`Failed to upsert voice profile: ${upsertErr.message}`);
}
