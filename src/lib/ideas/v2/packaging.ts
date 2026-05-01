// Packaging is the dominant framing layer in v2. Each idea is generated under
// a single assigned packaging_type, and the LLM is told the HOOK must reflect
// the type. tension_type and format remain in the response schema but no longer
// drive batch diversity — packaging does.

export type PackagingType = {
    id: string;
    label: string;
    // The hook contract. Tells the LLM what shape the hook must take to
    // legitimately fit this packaging type. Read at the bottom of the prompt.
    hookContract: string;
};

export const PACKAGING_TYPES: readonly PackagingType[] = [
    {
        id: 'contradiction',
        label: 'Contradiction',
        hookContract: 'The hook MUST explicitly challenge a widely-held belief in this niche. State the belief, then signal the reversal. e.g. "Most people think X — it\'s actually the opposite."',
    },
    {
        id: 'hyper_specific',
        label: 'Hyper-specific',
        hookContract: 'The hook MUST contain a precise number, timeframe, or unfakeable specific (a real client, a real date, a real dollar amount). Only valid when the transcripts contain such a specific.',
    },
    {
        id: 'pov',
        label: 'POV',
        hookContract: 'The hook MUST read first-person from a specific perspective the viewer can step into. "I\'m the kind of person who...", "As someone who...", "POV: you just...". The whole idea is delivered from inside that POV.',
    },
    {
        id: 'story',
        label: 'Story',
        hookContract: 'The hook MUST drop the viewer into a scene mid-action. Concrete time, place, or sensory detail in the first 8 words. "It was 11pm and the client just sent..." If transcripts don\'t support a real scene, do not use this packaging.',
    },
    {
        id: 'hot_take',
        label: 'Hot take',
        hookContract: 'The hook MUST be a polarizing assertion most viewers would instinctively push back on. Stake out a clear position in the first sentence — no hedging, no "it depends".',
    },
    {
        id: 'listicle',
        label: 'Listicle',
        hookContract: 'The hook MUST promise an enumeration with a specific number. "Here are the 3 reasons...", "5 things I stopped doing...". The body must deliver exactly that many items.',
    },
    {
        id: 'mistake_callout',
        label: 'Mistake callout',
        hookContract: 'The hook MUST point at a specific mistake the viewer is probably making right now. Use second-person directly. "You\'re still doing X. Stop."',
    },
    {
        id: 'behind_the_scenes',
        label: 'Behind the scenes',
        hookContract: 'The hook MUST reveal something insiders know that outsiders don\'t. "What no one tells you about...", "The thing they don\'t put in the brochure...". Must come from real experience the transcripts support.',
    },
];

const PACKAGING_BY_ID: Map<string, PackagingType> = new Map(PACKAGING_TYPES.map(p => [p.id, p]));

export function getPackagingById(id: string): PackagingType | undefined {
    return PACKAGING_BY_ID.get(id);
}

// Fisher-Yates over a copy of the pool. Returns N distinct types when N ≤ pool
// size, wraps around with a fresh shuffle when N > pool size (8). The current
// max ideas-per-pillar is 5 so wrap-around is only theoretical, but it keeps
// the function total in case we lift the cap later.
export function shufflePackagingForBatch(count: number, seed?: () => number): PackagingType[] {
    if (count <= 0) return [];
    const rand = seed ?? Math.random;
    const out: PackagingType[] = [];
    let pool = [...PACKAGING_TYPES];
    while (out.length < count) {
        if (pool.length === 0) pool = [...PACKAGING_TYPES];
        // shuffle remaining pool
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        const need = count - out.length;
        const take = Math.min(need, pool.length);
        out.push(...pool.slice(0, take));
        pool = pool.slice(take);
    }
    return out;
}
