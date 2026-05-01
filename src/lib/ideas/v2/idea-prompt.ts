import type { Angle } from './angles';
import type { PackagingType } from './packaging';

export type V2VoiceProfile = {
    niche_summary?: string | null;
    tone_descriptors?: string[] | null;
    content_style?: string | null;
    recurring_phrases?: string[] | null;
    signature_argument?: string | null;
    enemy_or_foil?: string[] | null;
    would_never_say?: string[] | null;
    // v2 fields — may be null on legacy rows. The prompt builder falls back to
    // v1 fields in that case so old voice profiles still produce v2 ideas.
    primary_style?: string | null;
    secondary_styles?: string[] | null;
    hook_patterns?: string[] | null;
    sentence_style?: string | null;
    energy?: string | null;
};

export type V2PillarContext = {
    name: string;
    description: string | null;
    isSeries: boolean;                 // true → meta-format pillar; the prompt switches to "propose a NEW topic in this format"
    subtopicsAlreadyCovered: string[]; // pillars.subtopics — feeds the "don't repeat what they've made" rule
    transcriptEssences: string[];      // 3-5 essences ranked by similarity
    transcriptRaw: string;             // joined raw text, used for grounding checks downstream
};

export const V2_SYSTEM_MESSAGE = [
    'You are a senior creative director for a short-form-video creator. You produce ONE idea at a time, grounded in the transcripts the creator has actually filmed.',
    '',
    'CARDINAL RULE — DO NOT INVENT.',
    'No client names, dollar amounts, dates, or scenes that don\'t appear in the transcripts. If the packaging contract requires specifics that aren\'t present, return abstract specifics-free language instead. Fabricated specifics are worse than honest abstraction.',
    '',
    'PACKAGING IS THE PRIMARY AXIS.',
    'You are assigned exactly one packaging_type per call. The hook MUST reflect that packaging type — see the hook contract in the user message. tension_type and format are still emitted in the response, but they are SECONDARY descriptors, not drivers.',
    '',
    'ANGLE IS THE PERSPECTIVE.',
    'You are also assigned one angle. The angle decides the stance the idea takes; the packaging decides the shape the idea takes. They compose: angle × packaging × creator-voice = idea.',
    '',
    'AVOID REPEATING THE CREATOR.',
    'You will be given a list of subtopics the creator has already covered under this pillar. Do not propose ideas that retread those subtopics — find an adjacent or unexplored angle within the same pillar.',
    '',
    'HOOK RULES.',
    '- 8 to 18 words.',
    '- Must satisfy the packaging hook contract.',
    '- No pronoun-verb-reflexive shapes ("I lied to myself", "My fake confidence"). Those are tweet drafts.',
    '- No "Most people think X" unless the packaging is contradiction or hot_take.',
    '',
    'TITLE RULES.',
    '- 6 to 16 words. Descriptive enough to convey the angle at a glance.',
    '- Has a clear point of view. Not a neutral summary.',
    '- No templated shapes: "The [Noun] [Paradox/Revolution/Effect/Leap]", "The [Adjective] Power of [Noun]", "How I Learned to [Verb]". These get rejected programmatically.',
    '',
    'Return ONLY valid JSON. No markdown, no preamble.',
].join('\n');

function nonEmpty(arr: (string | null | undefined)[] | null | undefined): string[] {
    return (arr || []).map(s => (s || '').trim()).filter(s => s.length > 0);
}

function voiceBlock(vp: V2VoiceProfile): string {
    const lines: string[] = [];
    lines.push(`Niche: ${vp.niche_summary ?? '(none)'}`);

    // Prefer v2 primary_style; fall back to v1 content_style.
    const style = vp.primary_style || vp.content_style || '(none)';
    lines.push(`Primary style: ${style}`);

    const secondary = nonEmpty(vp.secondary_styles ?? null);
    if (secondary.length > 0) lines.push(`Also moves into: ${secondary.join(', ')}`);

    lines.push(`Tone: ${nonEmpty(vp.tone_descriptors ?? null).join(', ') || '(none)'}`);

    if (vp.energy) lines.push(`Energy: ${vp.energy}`);
    if (vp.sentence_style) lines.push(`Sentence style: ${vp.sentence_style}`);

    const hookPatterns = nonEmpty(vp.hook_patterns ?? null);
    if (hookPatterns.length > 0) {
        lines.push(`Hook patterns this creator actually uses (imitate the register, never the words): ${hookPatterns.join(' | ')}`);
    }

    const phrases = nonEmpty(vp.recurring_phrases ?? null);
    if (phrases.length > 0) lines.push(`Phrases they actually say: ${phrases.join(', ')}`);

    lines.push(`Signature argument (core belief): ${vp.signature_argument || '(not yet identified — work from niche + transcripts)'}`);

    const foil = nonEmpty(vp.enemy_or_foil ?? null);
    if (foil.length > 0) lines.push(`Pushes back against: ${foil.join(', ')}`);

    const neverSay = nonEmpty(vp.would_never_say ?? null);
    if (neverSay.length > 0) lines.push(`Things this creator would NEVER say: ${neverSay.join(' | ')}`);

    return lines.join('\n');
}

export function buildV2UserMessage(params: {
    voiceProfile: V2VoiceProfile;
    pillar: V2PillarContext;
    angle: Angle;
    packaging: PackagingType;
}): string {
    const { voiceProfile, pillar, angle, packaging } = params;

    const subtopicsLine = pillar.subtopicsAlreadyCovered.length > 0
        ? pillar.subtopicsAlreadyCovered.join(', ')
        : '(none yet)';

    const essenceBlock = pillar.transcriptEssences.length > 0
        ? pillar.transcriptEssences.map((e, i) => `[${i + 1}] ${e}`).join('\n')
        : '(no essences available — work from voice profile + pillar description)';

    const seriesBlock = pillar.isSeries
        ? [
            '',
            '== THIS IS A META-FORMAT SERIES ==',
            'This pillar is a recurring branded series, not a topic. Each episode tackles a DIFFERENT subject under the same format. The transcripts above are past episodes — treat them as evidence of FORMAT (cadence, opening style, vibe), NOT as the topic to keep talking about.',
            'Your job: propose a brand-new TOPIC the creator has not covered yet, that would naturally fit a new episode of this series. Do not paraphrase or extend any existing episode. The new topic should feel like something the creator could plausibly think about next, given their voice and the format — but it should be a different subject from any of the listed subtopics.',
        ].join('\n')
        : '';

    return [
        '== CREATOR VOICE ==',
        voiceBlock(voiceProfile),
        '',
        '== PILLAR ==',
        `Name: ${pillar.name}`,
        pillar.description ? `Description: ${pillar.description}` : '',
        `Subtopics this creator has ALREADY covered under this pillar — do NOT retread these: ${subtopicsLine}`,
        seriesBlock,
        '',
        '== TRANSCRIPT ESSENCES (ranked by relevance to this pillar) ==',
        essenceBlock,
        '',
        '== TRANSCRIPT EXCERPTS (the only source of truth for any specific quoted detail) ==',
        pillar.transcriptRaw.slice(0, 4000),
        '',
        '== ASSIGNMENT ==',
        `Angle: ${angle.name} — ${angle.instruction}`,
        `Packaging: ${packaging.label}`,
        `Hook contract: ${packaging.hookContract}`,
        '',
        pillar.isSeries
            ? 'Generate exactly ONE idea using the assigned angle and packaging. The topic MUST be new — not any of the subtopics listed above. Use the past episodes only to match the series\' voice/format.'
            : 'Generate exactly ONE idea using the assigned angle and packaging. Avoid the subtopics already covered.',
        '',
        'Return ONLY this JSON (no extra fields, no preamble):',
        '{',
        '  "hook": string (8-18 words, satisfies the packaging hook contract),',
        '  "title": string (6-16 words, clear POV, no templated shapes),',
        '  "idea": string (1-2 sentences describing what the video is about, in this creator\'s voice),',
        '  "execution": string (how the creator would film and structure this — body beats, retention beat, payoff),',
        '  "anchor_quote": string | null (a verbatim quote ≥8 words from the transcripts above if the idea is grounded in a specific moment, else null),',
        '  "tension_type": string (one of: reversal | confession | specific_number | contradiction | identity_challenge | unexpected_outcome — secondary descriptor, not the driver),',
        '  "format": string (one of: talking-head | story-cold-open | list | reaction | demo | green-screen-commentary | direct-address-rant)',
        '}',
    ].filter(Boolean).join('\n');
}
