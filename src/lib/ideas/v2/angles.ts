// Angle pool. Phase 1 uses the predefined set only. Phase 2 will mix in
// gap-derived angles produced by the gap detector. The shape here is what the
// detector will conform to so the prompt builder doesn't need to change.

export type Angle = {
    id: string;
    name: string;
    // Single sentence the LLM sees. Frames the perspective without dictating the
    // hook — the packaging contract dictates the hook shape.
    instruction: string;
};

export const PREDEFINED_ANGLES: readonly Angle[] = [
    {
        id: 'unpopular_opinion',
        name: 'Unpopular opinion',
        instruction: 'Take a stance most people in this niche would disagree with, and defend it from the creator\'s lived experience.',
    },
    {
        id: 'beginner_mistake',
        name: 'Beginner mistake',
        instruction: 'Name a specific mistake beginners in this space keep making — one the creator has watched up close.',
    },
    {
        id: 'hidden_truth',
        name: 'Hidden truth',
        instruction: 'Reveal something insiders know but rarely say out loud, and explain why it stays hidden.',
    },
    {
        id: 'personal_failure',
        name: 'Personal failure',
        instruction: 'Frame the idea around a specific failure the creator has owned — what they tried, what broke, what they learned.',
    },
    {
        id: 'contrarian_take',
        name: 'Contrarian take',
        instruction: 'Push back on conventional advice in this niche with a different mechanism that actually explains the outcome.',
    },
    {
        id: 'missing_step',
        name: 'Missing step',
        instruction: 'Identify a step everyone skips that quietly determines whether the rest of the advice works.',
    },
];

// Pick N distinct angles for a single pillar's batch. Stable order = same input
// gives same output (Fisher-Yates would re-shuffle on every call, which makes
// debugging harder). For Phase 1 we want predictable assignment; the variety
// across batches comes from packaging, not angle randomness.
export function pickAnglesForBatch(count: number, pool: readonly Angle[] = PREDEFINED_ANGLES): Angle[] {
    if (count <= 0) return [];
    if (count >= pool.length) return [...pool];
    return pool.slice(0, count);
}
