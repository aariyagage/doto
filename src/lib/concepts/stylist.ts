// PASS 3 — Stylist. The ONLY place voice profile is read in the new
// concept pipeline (PASS 4 refiner is the other future-only spot).
//
// Takes a concept (post-PASS-2) and rewrites title + hook in the creator's
// voice WITHOUT changing topic, angle, or structure. Produces three text
// fields that the API persists directly to concepts.voice_adapted_title /
// _hook / _text columns.

import Groq from 'groq-sdk';
import { requireEnv } from '@/lib/env';
import {
    STYLIST_SYSTEM_MESSAGE,
    buildStylistUserMessage,
    type StylistVoiceProfile,
} from './prompts/stylist-prompt';
import type { ConceptCandidate, StylistOutput } from './types';

const MODEL = 'llama-3.3-70b-versatile';
// Slightly higher temperature than the validator — voice rewrites benefit
// from a touch of creativity, but lower than PASS 1 since we don't want
// the styled text drifting from the underlying concept.
const TEMPERATURE = 0.6;

export interface RunStylistArgs {
    concept: Pick<ConceptCandidate, 'title' | 'hook' | 'angle' | 'structure'>;
    voiceProfile: StylistVoiceProfile;
}

export interface StylistResult {
    output: StylistOutput;
    groqCalls: number;
}

export async function runStylist(args: RunStylistArgs): Promise<StylistResult> {
    const userMessage = buildStylistUserMessage(args);

    const groq = new Groq({ apiKey: requireEnv('GROQ_API_KEY') });
    const completion = await groq.chat.completions.create({
        model: MODEL,
        messages: [
            { role: 'system', content: STYLIST_SYSTEM_MESSAGE },
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
        throw new Error(`PASS 3 produced unparseable JSON: ${(err as Error).message}`);
    }

    const obj = (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        ? (parsed as Record<string, unknown>)
        : {};

    const output: StylistOutput = {
        voice_adapted_title: str(obj.voice_adapted_title) || args.concept.title,
        voice_adapted_hook:  str(obj.voice_adapted_hook)  || (args.concept.hook ?? ''),
        voice_adapted_text:  str(obj.voice_adapted_text)  || args.concept.title,
    };

    return { output, groqCalls: 1 };
}

// Eager-style top-K from a list of accepted concepts. Sequential to keep
// Groq RPM predictable; for top-3 default this is fine. Returns parallel
// arrays so the caller can write voice_adapted_* fields back per concept.
export async function runStylistBatch<T extends { candidate: ConceptCandidate }>(
    items: T[],
    voiceProfile: StylistVoiceProfile,
): Promise<{ styled: Array<{ item: T; output: StylistOutput }>; groqCalls: number }> {
    const styled: Array<{ item: T; output: StylistOutput }> = [];
    let groqCalls = 0;

    for (const item of items) {
        try {
            const r = await runStylist({ concept: item.candidate, voiceProfile });
            styled.push({ item, output: r.output });
            groqCalls += r.groqCalls;
        } catch (err) {
            // Stylist failure is non-fatal — the concept still ships with
            // null voice_adapted fields and lazy-styles on first card open.
            console.warn(`stylist failed for "${item.candidate.title}":`, err instanceof Error ? err.message : String(err));
        }
    }

    return { styled, groqCalls };
}

// ---- helpers --------------------------------------------------------------

function stripFences(s: string): string {
    let out = s.trim();
    if (out.startsWith('```json')) out = out.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
    else if (out.startsWith('```')) out = out.replace(/^```\s*/, '').replace(/```$/, '').trim();
    return out;
}

function str(v: unknown): string {
    if (typeof v === 'string') return v.trim();
    return '';
}
