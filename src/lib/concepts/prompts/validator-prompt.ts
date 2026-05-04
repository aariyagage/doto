// PASS 2 — Validator + scorer prompt. ALSO VOICE-AGNOSTIC.
//
// Voice profile is forbidden here too. The voice-leak regression test
// (tests/prompts/voice-leak.test.ts) asserts no voice content appears in
// PASS 2 messages.
//
// Cosine dedup is handled separately in src/lib/concepts/dedup.ts; this
// prompt only does the rubric-based reject + scoring step. It receives
// candidate text + a small history of saved/used concept titles+hooks so
// the LLM can reject paraphrases.

import type { ConceptCandidate } from '../types';

export interface ValidatorPriorItem {
    title: string;
    hook: string | null;
    status: 'saved' | 'used'; // legacy v2 ideas mapped into this same shape
}

export interface BuildValidatorPromptArgs {
    pillar: { name: string; description: string | null };
    candidates: ConceptCandidate[];
    priors: ValidatorPriorItem[]; // up to 20
}

export const VALIDATOR_SYSTEM_MESSAGE = `You are a strict editorial gate for short-form-video concept candidates. Your only job is to score each candidate and reject the ones that fail the bar.

Score each candidate on three axes from 0.0 to 1.0:

  - novelty: differs from the listed prior saved/used items. 1.0 means clearly new ground; 0.0 means a paraphrase of something already in the prior list.
  - fit: aligns with the stated pillar's topic. 1.0 means squarely on-pillar; 0.0 means off-pillar.
  - specificity: contains a concrete scenario, observation, claim, or experiment — not generic advice. 1.0 means a specific instance; 0.0 means "5 tips for X" generic.

Composite = 0.4 * novelty + 0.35 * fit + 0.25 * specificity.

REJECT (set keep=false) any candidate whose hook paraphrases a prior. Phrase difference alone is not novelty — the underlying claim or scenario must differ.

REJECT any candidate whose hook is weak ("here's why", "let me explain", "I want to talk about"). REJECT any candidate whose title is templated ("how I X-ed Y", "why X is Z", "the truth about X").

Output STRICT JSON in this exact shape:

{
  "verdicts": [
    {
      "id": "<the index id from the input — copy verbatim>",
      "scores": { "novelty": 0.0, "fit": 0.0, "specificity": 0.0, "composite": 0.0 },
      "keep": true,
      "reject_reason": null
    }
  ]
}

For rejected candidates set keep=false and provide a one-sentence reject_reason. Composite must equal 0.4*novelty + 0.35*fit + 0.25*specificity rounded to 3 decimals.

DO NOT inject any creator voice into your reasoning. You will not be given a voice profile — work from the candidate text and the pillar definition alone.`;

export function buildValidatorUserMessage(args: BuildValidatorPromptArgs): string {
    const { pillar, candidates, priors } = args;
    const lines: string[] = [];

    lines.push(`PILLAR:`);
    lines.push(`  name: ${pillar.name}`);
    if (pillar.description) lines.push(`  description: ${pillar.description}`);
    lines.push('');

    if (priors.length > 0) {
        lines.push(`PRIOR SAVED/USED CONCEPTS FOR THIS USER (do not let candidates paraphrase these):`);
        priors.slice(0, 20).forEach((p, i) => {
            const hook = p.hook ? ` | hook: ${p.hook}` : '';
            lines.push(`  P${i + 1} [${p.status}]: title: ${p.title}${hook}`);
        });
        lines.push('');
    } else {
        lines.push(`PRIOR SAVED/USED CONCEPTS: none — every candidate is novelty=high by default.`);
        lines.push('');
    }

    lines.push(`CANDIDATES TO SCORE (return one verdict per id, in input order):`);
    candidates.forEach((c, i) => {
        const id = String(i);
        lines.push(`  C${id}:`);
        lines.push(`    title: ${c.title}`);
        lines.push(`    hook: ${c.hook}`);
        lines.push(`    angle: ${c.angle}`);
        lines.push(`    ai_reason: ${c.ai_reason}`);
    });

    return lines.join('\n');
}
