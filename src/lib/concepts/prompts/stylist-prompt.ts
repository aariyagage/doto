// PASS 3 — Stylist prompt. THIS IS THE ONLY PLACE VOICE PROFILE IS READ
// in the concepts pipeline.
//
// The stylist takes a concept that PASS 1 + PASS 2 produced and rewrites
// the title and hook in the creator's voice WITHOUT changing the topic,
// angle, or structure.
//
// PASS 4 (refiner) is the only other place that may read voice profile —
// it builds outlines/scripts in voice, gated by SCRIPT_REFINER flag.

import type { ConceptCandidate } from '../types';

// We accept the same V2VoiceProfile shape the legacy idea engine uses, so
// no schema migration is needed and the existing voice_profile rows work
// unchanged. See src/lib/ideas/v2/idea-prompt.ts for the source-of-truth
// type; we re-declare here only the fields we actually consume to keep
// this module independent of the legacy idea engine.
export interface StylistVoiceProfile {
    niche_summary?: string | null;
    tone_descriptors?: string[] | null;
    recurring_phrases?: string[] | null;
    content_style?: string | null;
    primary_style?: string | null;
    secondary_styles?: string[] | null;
    sentence_style?: string | null;
    energy?: string | null;
    hook_patterns?: string[] | null;
    signature_argument?: string | null;
    enemy_or_foil?: string[] | null;
    would_never_say?: string[] | null;
}

export interface BuildStylistPromptArgs {
    concept: Pick<ConceptCandidate, 'title' | 'hook' | 'angle' | 'structure'>;
    voiceProfile: StylistVoiceProfile;
}

export const STYLIST_SYSTEM_MESSAGE = `You are a voice stylist for a short-form-video creator. Your job is to rewrite a concept's TITLE and HOOK in the creator's voice WITHOUT changing the topic, angle, or structure.

HARD RULES:
  - Do NOT change the underlying topic. The concept's "angle" describes what the video is about — preserve that.
  - Do NOT invent claims, statistics, or specifics that aren't in the input.
  - Do NOT use any phrase listed in "would_never_say".
  - DO use the creator's tone descriptors, recurring phrases, sentence style, and energy.
  - DO match one of the creator's hook patterns when possible.

Output STRICT JSON:

{
  "voice_adapted_title": "<rewritten title in creator voice>",
  "voice_adapted_hook":  "<rewritten hook in creator voice>",
  "voice_adapted_text":  "<2-3 sentence pitch in the creator's voice that captures the concept and its angle>"
}

If the input title or hook already feels in-voice, you may return it lightly polished — but you must always produce all three fields.`;

function arr(label: string, v: string[] | null | undefined): string | null {
    if (!v || v.length === 0) return null;
    return `  ${label}: ${v.join(', ')}`;
}

function line(label: string, v: string | null | undefined): string | null {
    if (!v) return null;
    return `  ${label}: ${v}`;
}

export function buildStylistUserMessage(args: BuildStylistPromptArgs): string {
    const { concept, voiceProfile: vp } = args;
    const lines: string[] = [];

    lines.push(`CONCEPT TO RESTYLE:`);
    lines.push(`  title: ${concept.title}`);
    if (concept.hook) lines.push(`  hook: ${concept.hook}`);
    if (concept.angle) lines.push(`  angle: ${concept.angle}`);
    if (concept.structure) {
        try {
            lines.push(`  structure: ${JSON.stringify(concept.structure)}`);
        } catch {
            // unreachable; structure is jsonb-shaped from PASS 1 already.
        }
    }
    lines.push('');

    lines.push(`CREATOR VOICE PROFILE:`);
    const vpLines = [
        line('niche', vp.niche_summary),
        line('primary_style', vp.primary_style || vp.content_style),
        arr ('secondary_styles', vp.secondary_styles ?? null),
        arr ('tone', vp.tone_descriptors ?? null),
        line('energy', vp.energy),
        line('sentence_style', vp.sentence_style),
        arr ('hook_patterns', vp.hook_patterns ?? null),
        arr ('recurring_phrases', vp.recurring_phrases ?? null),
        line('signature_argument', vp.signature_argument),
        arr ('pushes_back_against', vp.enemy_or_foil ?? null),
        arr ('would_never_say', vp.would_never_say ?? null),
    ].filter((s): s is string => Boolean(s));

    if (vpLines.length === 0) {
        lines.push(`  (no voice profile available; return concept polished but minimally restyled)`);
    } else {
        lines.push(...vpLines);
    }

    return lines.join('\n');
}
