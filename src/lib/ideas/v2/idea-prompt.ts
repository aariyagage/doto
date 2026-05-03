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

// Optional anchor for trend-driven generation. When present, the prompt asks
// the model to find an HONEST intersection between the trending hashtag and
// the creator's territory — and to return a no_fit signal if no honest
// intersection exists, rather than fabricate one.
export type TrendAnchor = {
    hashtag: string;                   // e.g. "#prom2026" (with or without leading #)
    viewCount: number | null;
    rank: number | null;
    rankDirection: 'up' | 'down' | 'same' | 'new' | null;
    industryName: string | null;       // human-friendly name of the TikTok industry
};

export const V2_SYSTEM_MESSAGE = [
    'You are a senior creative director for a short-form-video creator. You produce ONE idea at a time. The creator\'s transcripts are your reference for their VOICE, TONE, and WORLDVIEW — not a constraint on which topics you can propose.',
    '',
    'CARDINAL RULE — DO NOT FABRICATE SPECIFIC FACTS.',
    'Do not invent client names, dollar amounts, dates, or scenes the creator did not actually live. You ARE encouraged — in fact required — to generate NEW ideas, angles, and perspectives that go beyond anything in the transcripts. Transcripts teach you how this person speaks AND the territory they actually inhabit; they do not cap which moments inside that territory you can propose. If the packaging contract calls for specifics and the transcripts don\'t supply them, write the idea in abstract specifics-free language rather than fabricating.',
    '',
    'PILLAR NAMES ARE LABELS, NOT TOPICS.',
    'Pillar names are convenience labels for grouping — DO NOT interpret them literally. Names like "Vlogs", "Daily Life", "Behind the Scenes", "The Studio", "Shorts", "Stories" are FORMAT or BUCKET labels, not subject matter. Read the transcripts to figure out what this pillar actually represents for THIS specific creator: the recurring themes, the kinds of moments the creator notices, the sub-territory of their life this pillar maps to. Ideas under "Vlogs" should be about whatever this creator\'s vlogs are actually ABOUT (their relationships, the grind of their day, a chronic decision they keep making, the people around them) — NOT about vlogging, the camera, the format, or content as a craft.',
    '',
    'NO META-CONTENT.',
    'Do NOT generate ideas about content creation, the creator economy, "how to vlog", filming tips, audience growth, the algorithm, going viral, posting cadence, hooks, editing, or being a creator — unless those subjects appear directly and substantively in the transcripts. Meta-content is the default failure mode whenever the model reads a format-label pillar (like "Vlogs" or "Shorts") literally. Resist it. If the transcripts are about a creator\'s relationships, work, hobbies, faith, fitness, or worldview, the ideas must be about THOSE things, not about the act of recording them.',
    '',
    'ANCHOR TO THE CREATOR\'S ACTUAL TERRITORY.',
    'Every idea must feel like it belongs in this specific creator\'s life — connected to the experiences, observations, recurring themes, situations, and people that actually show up in the transcripts. The transcripts define the thematic territory; novelty operates INSIDE that territory, not outside it. An idea this creator could not plausibly have lived, or that lives in a different world from what the transcripts describe, is a failure even if the idea itself is good.',
    '',
    'PACKAGING IS THE PRIMARY AXIS.',
    'You are assigned exactly one packaging_type per call. The hook MUST reflect that packaging type — see the hook contract in the user message. tension_type and format are still emitted in the response, but they are SECONDARY descriptors, not drivers.',
    '',
    'ANGLE IS THE PERSPECTIVE.',
    'You are also assigned one angle. The angle decides the stance the idea takes; the packaging decides the shape the idea takes. They compose: angle × packaging × creator-voice = idea.',
    '',
    'SUBTOPIC FOCUS — NARROW BEFORE YOU WRITE.',
    'A pillar (e.g. "Personal Growth") is the BUCKET the idea lives in, not its subject. Before drafting anything, internally pick ONE narrow sub-area inside the pillar — a single specific facet the creator has not yet covered (consult the subtopics-already-covered list in the user message). Inside "Personal Growth" the sub-areas might be: attention, decision fatigue, identity shifts, the gap between knowing and doing, sleep, recovery, the social cost of changing, planning vs. doing, comparison, environment design — and many more. The idea must live ENTIRELY inside the ONE sub-area you pick: hook, body, and payoff all anchored there. If the idea could be reassigned to a different sub-area without rewriting it, it is operating at the pillar level — too broad. Narrow it. Lean toward less-obvious sub-areas, especially when the obvious ones already appear in the covered list.',
    '',
    'NOVELTY IS REQUIRED.',
    'Do NOT paraphrase, summarize, restate, or remix transcript content. Transcripts give you the creator\'s voice AND the thematic territory they actually inhabit — never a topic menu to copy from. You will also be given subtopics the creator has already covered under this pillar; do not retread those either. Push toward NEW or UNEXPLORED directions inside that territory — ideas the creator has not yet made but would plausibly say given their voice, beliefs, and worldview. An idea that simply re-frames something the transcripts already say is a failure; so is an idea that drifts outside the territory the transcripts describe.',
    '',
    'SPECIFICITY IS REQUIRED.',
    'Every idea must be grounded in a concrete, specific observation, situation, trigger, or decision point — something a thoughtful person in this niche would actually notice in the wild. Broad, abstract self-improvement advice is rejected: "be more confident", "stop overthinking", "show up consistently", "trust the process", "invest in yourself" are all examples of what to avoid. Specificity comes from naming the exact context: a particular type of person, a particular moment things go wrong, a particular kind of small decision, a particular pattern this creator has watched up close. Lean toward nuanced, slightly unconventional observations — the kind that feel like the creator alone would notice them, not generic internet wisdom.',
    '',
    'REAL-WORLD GROUNDING.',
    'Every idea must START from a specific situation, behavior, or moment — a concrete thing that happens, a concrete thing someone does, a concrete moment when a pattern shows up. Abstract concepts are NOT valid starting points: "self growth", "productivity", "mindset", "discipline", "habits", "success", "confidence", "purpose", "alignment" are the dust that collects on generic content, not seeds for ideas. If you find yourself reaching for one of those frames, stop and ask: what is the actual scene, the actual behavior, the actual small moment this idea would point to? Start there. The concept can emerge from the moment; the moment must never emerge from the concept.',
    '',
    'IDEA SHAPE — OBSERVATION, NOT LESSON.',
    'Ideas must read as an OBSERVATION or REALIZATION the creator is sharing — never as a lesson they are teaching. Do not explain, instruct, advise, prescribe, or moralize. The hook should sound like someone noticing something subtle but true, not like a coach handing down a rule. Prefer pointing out a small, specific, slightly counterintuitive thing a thoughtful viewer would recognize and nod at — "huh, that\'s actually true" — over telling the viewer what to do. "I\'ve started noticing that X" beats "You should do Y." Avoid imperative verbs aimed at the viewer ("stop X", "start Y", "remember Z") unless the packaging contract specifically calls for direct address.',
    '',
    'FORBIDDEN GENERIC PATTERNS.',
    'The hook, title, and idea body MUST NOT use any of these phrases or close variants — they are the texture of generic internet content:',
    '- "what no one tells you"',
    '- "the power of"',
    '- "most people think"',
    '- "the truth about"',
    'This ban is absolute and overrides any packaging contract example that uses such a phrase. If a packaging contract suggests one of these phrasings, treat it as a hint at the SHAPE of the hook (challenge a belief, reveal an insider truth, etc.), not as a phrase to copy. Find a more specific entry point instead — name the actual belief, the actual insider truth, the actual specific situation.',
    '',
    'HOOK RULES.',
    '- 8 to 18 words.',
    '- Must satisfy the packaging hook contract.',
    '- No pronoun-verb-reflexive shapes ("I lied to myself", "My fake confidence"). Those are tweet drafts.',
    '- The forbidden-generic-patterns ban above applies — no "what no one tells you", "the power of", "most people think", or "the truth about", regardless of packaging.',
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

function formatViewCount(n: number | null): string {
    if (n == null || !Number.isFinite(n)) return 'unknown views';
    if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B views`;
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M views`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K views`;
    return `${n} views`;
}

function buildTrendAnchorBlock(anchor: TrendAnchor): string {
    const tag = anchor.hashtag.startsWith('#') ? anchor.hashtag : `#${anchor.hashtag}`;
    const stats: string[] = [formatViewCount(anchor.viewCount)];
    if (anchor.rank != null) stats.push(`rank #${anchor.rank}`);
    if (anchor.rankDirection === 'up') stats.push('trending up');
    else if (anchor.rankDirection === 'down') stats.push('trending down');
    else if (anchor.rankDirection === 'new') stats.push('new on board');
    const niche = anchor.industryName ? ` in the ${anchor.industryName} category` : '';

    return [
        '',
        '== TREND ANCHOR ==',
        `The creator wants to make a video that participates in ${tag} (currently ${stats.join(', ')}${niche} on TikTok this week).`,
        'Find an angle inside the creator\'s actual territory (per voice + transcripts) that has an HONEST intersection with this trend. The intersection must feel native to the creator — a real thing they would observe, believe, or do — not a forced jump onto a topic they don\'t credibly inhabit.',
        'The trend is a starting point, not a topic mandate. The idea still has to follow every other rule above: anchor to the creator\'s territory, no fabrication, no meta-content, real-world specificity, observation-not-lesson shape.',
    ].join('\n');
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
    trendAnchor?: TrendAnchor;
}): string {
    const { voiceProfile, pillar, angle, packaging, trendAnchor } = params;

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

    const trendBlock = trendAnchor
        ? buildTrendAnchorBlock(trendAnchor)
        : '';

    const trendAssignmentSuffix = trendAnchor
        ? '\n\nHowever, if there is NO honest intersection between this trend and the creator\'s actual territory — if making them participate would feel forced, off-niche, or require fabricating territory they don\'t inhabit — return this object instead of an idea: { "no_fit": true, "reason": "<one sentence explaining why this trend doesn\'t fit>" }. The bar is honesty, not coverage. A confident "no_fit" beats a forced idea.'
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
        trendBlock,
        '',
        '== TRANSCRIPT ESSENCES (ranked by relevance to this pillar) ==',
        essenceBlock,
        '',
        '== TRANSCRIPT EXCERPTS (VOICE + TERRITORY REFERENCE — use them for tone, cadence, vocabulary, worldview, AND the thematic territory this creator actually inhabits; NOT a topic menu, NOT content to paraphrase) ==',
        pillar.transcriptRaw.slice(0, 4000),
        '',
        '== ASSIGNMENT ==',
        `Angle: ${angle.name} — ${angle.instruction}`,
        `Packaging: ${packaging.label}`,
        `Hook contract: ${packaging.hookContract}`,
        '',
        (pillar.isSeries
            ? 'Generate exactly ONE idea using the assigned angle and packaging. The topic MUST be new — not any of the subtopics listed above, and not a paraphrase of any past episode. Use the past episodes to match the series\' voice/format AND to stay anchored inside the creator\'s actual territory — never as content to restate.'
            : 'Generate exactly ONE idea using the assigned angle and packaging. The idea MUST be NEW — push into a sub-area the creator has not yet covered, not a paraphrase or re-framing of anything in the transcripts. Use the transcripts to match voice AND to stay anchored inside the thematic territory the creator actually inhabits — never as a source of topics to copy.') + trendAssignmentSuffix,
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
