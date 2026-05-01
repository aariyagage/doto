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
    // v2 additions (PRD §4.3). Optional so v1 callers/responses still parse.
    primary_style?: string | null;
    secondary_styles?: string[];
    hook_patterns?: string[];
    sentence_style?: string | null;
    energy?: string | null;
}

function isV2Enabled(): boolean {
    return process.env.IDEA_ENGINE_V2 === 'true';
}

const V1_FIELDS = `{
  "tone_descriptors": string[] (3-5 single adjectives that describe exactly how this person talks),
  "recurring_phrases": string[] (up to 6 short phrases this creator actually repeats),
  "content_style": string (exactly one of: story-driven, listicle, how-to, conversational, educational),
  "niche_summary": string (1-2 sentences on what this creator specifically makes and exactly who their audience is — be specific, not generic),
  "signature_argument": string (the contrarian belief or core thesis this creator returns to most often. One sentence. Must be specific enough that a different creator would disagree with it. Bad: 'Hard work matters.' Good: 'Most people optimize the wrong thing first — pricing, not product.'),
  "enemy_or_foil": string[] (2-4 things, ideologies, or types of people this creator pushes back against),
  "would_never_say": string[] (3 specific sentences this creator would never say out loud, given their worldview. Concrete sentences, not categories.)
}`;

const V2_FIELDS = `{
  "tone_descriptors": string[] (3-5 single adjectives that describe exactly how this person talks),
  "recurring_phrases": string[] (up to 6 short phrases this creator actually repeats — verbatim, not paraphrased),
  "content_style": string (exactly one of: story-driven, listicle, how-to, conversational, educational),
  "niche_summary": string (1-2 sentences on what this creator specifically makes and exactly who their audience is — be specific, not generic),
  "signature_argument": string (the contrarian belief or core thesis this creator returns to most often. One sentence. Must be specific enough that a different creator would disagree with it. Bad: 'Hard work matters.' Good: 'Most people optimize the wrong thing first — pricing, not product.'),
  "enemy_or_foil": string[] (2-4 things, ideologies, or types of people this creator pushes back against),
  "would_never_say": string[] (3 specific sentences this creator would never say out loud, given their worldview. Concrete sentences, not categories.),
  "primary_style": string (the dominant rhetorical mode — e.g. 'first-person story', 'contrarian explainer', 'numbered breakdown', 'analogy-driven teaching'. Be specific to THIS creator, not generic.),
  "secondary_styles": string[] (1-3 supporting styles they shift into),
  "hook_patterns": string[] (3-5 hook templates this creator actually uses, with the variable parts marked. Examples: 'Most people think X, but Y', 'The reason {topic} fails is...', 'I used to believe X until Y happened'. Derived from how their videos OPEN.),
  "sentence_style": string (one short phrase: 'short and clipped', 'long compound sentences with asides', 'rhythm of three', 'question then answer', etc.),
  "energy": string (one of: low-key, measured, animated, intense, conversational, performative)
}`;

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

    const v2 = isV2Enabled();
    const fields = v2 ? V2_FIELDS : V1_FIELDS;

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
                content: `Here are essence summaries from this creator's videos (one per video):\n\n${combined}\n\nReturn ONLY this JSON object:\n${fields}`,
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

    const result: VoiceProfileResult = {
        tone_descriptors: Array.isArray(parsed.tone_descriptors) ? parsed.tone_descriptors : [],
        recurring_phrases: Array.isArray(parsed.recurring_phrases) ? parsed.recurring_phrases : [],
        content_style: parsed.content_style,
        niche_summary: parsed.niche_summary,
        signature_argument: typeof parsed.signature_argument === 'string' ? parsed.signature_argument : null,
        enemy_or_foil: Array.isArray(parsed.enemy_or_foil) ? parsed.enemy_or_foil : [],
        would_never_say: Array.isArray(parsed.would_never_say) ? parsed.would_never_say : [],
    };

    if (v2) {
        result.primary_style = typeof parsed.primary_style === 'string' ? parsed.primary_style : null;
        result.secondary_styles = Array.isArray(parsed.secondary_styles) ? parsed.secondary_styles : [];
        result.hook_patterns = Array.isArray(parsed.hook_patterns) ? parsed.hook_patterns : [];
        result.sentence_style = typeof parsed.sentence_style === 'string' ? parsed.sentence_style : null;
        result.energy = typeof parsed.energy === 'string' ? parsed.energy : null;
    }

    return result;
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

    const upsertPayload: Record<string, unknown> = {
        user_id: userId,
        tone_descriptors: profile.tone_descriptors,
        recurring_phrases: profile.recurring_phrases,
        content_style: profile.content_style,
        niche_summary: profile.niche_summary,
        signature_argument: profile.signature_argument,
        enemy_or_foil: profile.enemy_or_foil,
        would_never_say: profile.would_never_say,
        last_updated: new Date().toISOString(),
    };

    // Only write v2 fields when v2 is on. Existing rows keep their v1 fields,
    // and a row regenerated under v2 gets the richer columns alongside.
    if (isV2Enabled()) {
        upsertPayload.primary_style = profile.primary_style ?? null;
        upsertPayload.secondary_styles = profile.secondary_styles ?? [];
        upsertPayload.hook_patterns = profile.hook_patterns ?? [];
        upsertPayload.sentence_style = profile.sentence_style ?? null;
        upsertPayload.energy = profile.energy ?? null;
    }

    const { error: upsertErr } = await supabase
        .from('voice_profile')
        .upsert(upsertPayload, { onConflict: 'user_id' });

    if (upsertErr) throw new Error(`Failed to upsert voice profile: ${upsertErr.message}`);
}
