// PASS 1 — Concept generator. Voice-AGNOSTIC.
//
// Produces N candidates in a single Groq call from pillar + recent
// essences (topic + core_idea only) + optional seed (brainstorm/transcript/
// trend) + optional research summary. Embeds each accepted candidate via
// the existing HF helper.
//
// This module is the load-bearing voice-isolation point. The only reason
// to import voice profile in this file is "I need to test that I'm NOT
// importing it" — which the regression test covers without help here.

import Groq from 'groq-sdk';
import { requireEnv } from '@/lib/env';
import { embedText } from '@/lib/pillars/embeddings';
import {
    CONCEPT_PASS_SYSTEM_MESSAGE,
    buildConceptUserMessage,
    type BuildConceptPromptArgs,
    type ConceptPromptEssence,
    type ConceptPromptPillar,
} from './prompts/concept-prompt';
import type { ConceptCandidate, ConceptSeed, GeneratorResult } from './types';

const MODEL = 'llama-3.3-70b-versatile';
const TEMPERATURE = 0.85;
const DEFAULT_COUNT = 5;
const MAX_COUNT = 8;

export interface RunConceptGeneratorArgs {
    pillar: ConceptPromptPillar;
    recentEssences: ConceptPromptEssence[];
    seed: ConceptSeed;
    researchSummary?: string | null;
    count?: number;
}

export async function runConceptGenerator(args: RunConceptGeneratorArgs): Promise<GeneratorResult> {
    const count = clamp(args.count ?? DEFAULT_COUNT, 1, MAX_COUNT);

    const promptArgs: BuildConceptPromptArgs = {
        pillar: args.pillar,
        recentEssences: args.recentEssences,
        seed: args.seed,
        researchSummary: args.researchSummary ?? null,
        count,
    };

    const userMessage = buildConceptUserMessage(promptArgs);
    const groq = new Groq({ apiKey: requireEnv('GROQ_API_KEY') });

    const completion = await groq.chat.completions.create({
        model: MODEL,
        messages: [
            { role: 'system', content: CONCEPT_PASS_SYSTEM_MESSAGE },
            { role: 'user',   content: userMessage },
        ],
        temperature: TEMPERATURE,
        response_format: { type: 'json_object' },
    });

    const content = stripFences(completion.choices[0]?.message?.content ?? '{}');
    let parsed: unknown;
    try {
        parsed = JSON.parse(content);
    } catch (err) {
        throw new Error(`PASS 1 produced unparseable JSON: ${(err as Error).message}`);
    }

    const candidates = extractCandidates(parsed).slice(0, count).map(sanitizeCandidate);
    if (candidates.length === 0) {
        throw new Error('PASS 1 produced zero usable candidates.');
    }

    // Embed each accepted candidate. We embed sequentially because the HF
    // free-tier inference API rate-limits individual requests rather than
    // a single batched call (the @huggingface/inference client doesn't
    // accept arrays for featureExtraction). Sequential calls also keep
    // failure isolation simple — if one cold-start 503s, we still get the
    // rest.
    const candidateEmbeddings: number[][] = [];
    for (const c of candidates) {
        const text = `${c.title} ${c.hook} ${c.angle}`;
        const vec = await embedText(text);
        candidateEmbeddings.push(vec);
    }

    return {
        candidates,
        candidateEmbeddings,
        groqCalls: 1,
        hfCalls: candidates.length,
    };
}

// ---- helpers --------------------------------------------------------------

function clamp(n: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, Math.floor(n)));
}

function stripFences(s: string): string {
    let out = s.trim();
    if (out.startsWith('```json')) out = out.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
    else if (out.startsWith('```')) out = out.replace(/^```\s*/, '').replace(/```$/, '').trim();
    return out;
}

function extractCandidates(parsed: unknown): ConceptCandidate[] {
    if (Array.isArray(parsed)) return parsed.filter(isPlainObj) as unknown as ConceptCandidate[];
    if (isPlainObj(parsed)) {
        const obj = parsed as Record<string, unknown>;
        const direct = obj.candidates;
        if (Array.isArray(direct)) return direct.filter(isPlainObj) as unknown as ConceptCandidate[];
        // Some Groq responses wrap with { result: [...] } or similar; try
        // common shapes before giving up.
        for (const key of ['result', 'concepts', 'items']) {
            const val = obj[key];
            if (Array.isArray(val)) return val.filter(isPlainObj) as unknown as ConceptCandidate[];
        }
    }
    return [];
}

function isPlainObj(v: unknown): v is Record<string, unknown> {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Coerce LLM output into a strict ConceptCandidate. Fills missing optional
// fields with safe defaults; rejects only if title or hook is empty (the
// validator pass would reject those anyway, but failing fast saves an LLM
// call later).
function sanitizeCandidate(raw: unknown): ConceptCandidate {
    const o = (raw ?? {}) as Record<string, unknown>;
    return {
        title:     str(o.title) || '',
        hook:      str(o.hook) || '',
        angle:     str(o.angle) || '',
        structure: o.structure ?? null,
        ai_reason: str(o.ai_reason) || '',
    };
}

function str(v: unknown): string {
    if (typeof v === 'string') return v.trim();
    return '';
}
