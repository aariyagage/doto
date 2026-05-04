// PASS 2 — Validator + scorer.
//
// One Groq call scores all candidates from PASS 1 against a rubric
// (novelty / fit / specificity, composite weights 0.4/0.35/0.25).
// LLM returns keep/reject + scores per candidate.
//
// We then layer cosine dedup on top:
//   - within-batch (drop near-paraphrases the LLM might have produced)
//   - against saved/used concepts (history dedup)
//   - against saved/used legacy v2 content_ideas
//
// Voice profile is forbidden in this pass — the voice-leak regression
// test asserts no voice content reaches the Groq messages.

import Groq from 'groq-sdk';
import { requireEnv } from '@/lib/env';
import type { SupabaseServer } from '@/lib/pillars/types';
import {
    VALIDATOR_SYSTEM_MESSAGE,
    buildValidatorUserMessage,
    type BuildValidatorPromptArgs,
    type ValidatorPriorItem,
} from './prompts/validator-prompt';
import {
    dedupeWithinBatch,
    filterAgainstSavedConcepts,
    filterAgainstSavedLegacyIdeas,
    type CandidateWithEmbedding,
} from './dedup';
import type { ConceptCandidate, ConceptScore, ValidatorOutput } from './types';

const MODEL = 'llama-3.3-70b-versatile';
const TEMPERATURE = 0.2; // deterministic-ish for scoring

export interface RunValidatorArgs {
    supabase: SupabaseServer;
    userId: string;
    pillar: { name: string; description: string | null };
    candidates: ConceptCandidate[];
    candidateEmbeddings: number[][]; // parallel to candidates
}

export interface ValidatorResult {
    // Survivors after both LLM rubric reject AND cosine dedup. Sorted by
    // composite score descending.
    accepted: Array<{
        candidate: ConceptCandidate;
        embedding: number[];
        score: ConceptScore;
    }>;
    // Rejection diagnostics for observability + concept_events metadata.
    rejected: Array<{
        candidate: ConceptCandidate;
        reason: 'rubric' | 'cosine_self' | 'cosine_saved_concept' | 'cosine_saved_idea';
        detail?: string;
        score?: ConceptScore;
    }>;
    groqCalls: number;
    hfCalls: number;
}

export async function runValidator(args: RunValidatorArgs): Promise<ValidatorResult> {
    const { supabase, userId, pillar, candidates, candidateEmbeddings } = args;

    if (candidates.length === 0) {
        return { accepted: [], rejected: [], groqCalls: 0, hfCalls: 0 };
    }
    if (candidates.length !== candidateEmbeddings.length) {
        throw new Error(`Validator: candidates (${candidates.length}) and embeddings (${candidateEmbeddings.length}) length mismatch`);
    }

    // 1. Pull recent saved/used concepts for the same user (prior context).
    //    Limit 20 — both to keep the prompt small and because beyond ~20
    //    the LLM stops attending to individual entries reliably.
    const priors = await loadPriorsForRubric(supabase, userId);

    // 2. Run the rubric LLM call.
    const userMessage = buildValidatorUserMessage({
        pillar,
        candidates,
        priors,
    } satisfies BuildValidatorPromptArgs);

    const groq = new Groq({ apiKey: requireEnv('GROQ_API_KEY') });
    const completion = await groq.chat.completions.create({
        model: MODEL,
        messages: [
            { role: 'system', content: VALIDATOR_SYSTEM_MESSAGE },
            { role: 'user',   content: userMessage },
        ],
        temperature: TEMPERATURE,
        response_format: { type: 'json_object' },
    });

    const verdicts = parseVerdicts(completion.choices[0]?.message?.content ?? '{}');

    // 3. Rubric filter — keep only candidates the LLM said keep=true.
    //    If the LLM didn't return a verdict for a given index, default to
    //    keep=true with neutral scores so we don't silently drop work.
    const rejected: ValidatorResult['rejected'] = [];
    const survivors: Array<{
        candidate: ConceptCandidate;
        embedding: number[];
        score: ConceptScore;
    }> = [];

    candidates.forEach((cand, i) => {
        const v = verdicts[String(i)];
        if (v && v.keep === false) {
            rejected.push({
                candidate: cand,
                reason: 'rubric',
                detail: v.reject_reason,
                score: v.scores,
            });
            return;
        }
        const score: ConceptScore = v?.scores ?? {
            novelty: 0.5,
            fit: 0.5,
            specificity: 0.5,
            composite: 0.5,
        };
        survivors.push({ candidate: cand, embedding: candidateEmbeddings[i], score });
    });

    // 4. Sort by composite score so higher-scored items win batch dedup ties.
    survivors.sort((a, b) => b.score.composite - a.score.composite);

    // 5. Apply cosine dedup in three stages.
    const items: CandidateWithEmbedding[] = survivors.map(s => ({
        candidate: s.candidate,
        embedding: s.embedding,
    }));
    const scoreByTitle = new Map(survivors.map(s => [s.candidate.title, s.score]));

    const stage1 = dedupeWithinBatch(items);
    for (const d of stage1.dropped) {
        rejected.push({
            candidate: d.item.candidate,
            reason: 'cosine_self',
            detail: d.decision.againstId ? `vs ${d.decision.againstId} sim=${d.decision.similarity?.toFixed(3)}` : undefined,
            score: scoreByTitle.get(d.item.candidate.title),
        });
    }

    const stage2 = await filterAgainstSavedConcepts(supabase, userId, stage1.kept);
    for (const d of stage2.dropped) {
        rejected.push({
            candidate: d.item.candidate,
            reason: 'cosine_saved_concept',
            detail: d.decision.againstId ? `vs ${d.decision.againstId} sim=${d.decision.similarity?.toFixed(3)}` : undefined,
            score: scoreByTitle.get(d.item.candidate.title),
        });
    }

    const stage3 = await filterAgainstSavedLegacyIdeas(supabase, userId, stage2.kept);
    for (const d of stage3.dropped) {
        rejected.push({
            candidate: d.item.candidate,
            reason: 'cosine_saved_idea',
            detail: d.decision.againstId ? `vs ${d.decision.againstId} sim=${d.decision.similarity?.toFixed(3)}` : undefined,
            score: scoreByTitle.get(d.item.candidate.title),
        });
    }

    const accepted = stage3.kept.map(item => ({
        candidate: item.candidate,
        embedding: item.embedding,
        score: scoreByTitle.get(item.candidate.title) ?? {
            novelty: 0.5, fit: 0.5, specificity: 0.5, composite: 0.5,
        },
    }));

    return {
        accepted,
        rejected,
        groqCalls: 1,
        hfCalls: 0, // history dedup uses cached embeddings; no new HF calls here
    };
}

// ---- helpers --------------------------------------------------------------

async function loadPriorsForRubric(supabase: SupabaseServer, userId: string): Promise<ValidatorPriorItem[]> {
    // Pull from concepts (saved + used) and legacy content_ideas (saved + used,
    // v2 only). Sort newest-first; cap at 20 total.
    const [conceptHistory, ideaHistory] = await Promise.all([
        supabase
            .from('concepts')
            .select('title, hook, status')
            .eq('user_id', userId)
            .in('status', ['saved', 'used'])
            .order('created_at', { ascending: false })
            .limit(20),
        supabase
            .from('content_ideas')
            .select('title, hook, is_used')
            .eq('user_id', userId)
            .eq('source_version', 'v2')
            .or('is_saved.eq.true,is_used.eq.true')
            .order('generated_at', { ascending: false })
            .limit(20),
    ]);

    const conceptItems: ValidatorPriorItem[] = (conceptHistory.data ?? []).map((r) => {
        const row = r as { title: string; hook: string | null; status: string };
        return {
            title: row.title,
            hook: row.hook,
            status: (row.status === 'used' ? 'used' : 'saved') as 'saved' | 'used',
        };
    });

    const ideaItems: ValidatorPriorItem[] = (ideaHistory.data ?? []).map((r) => {
        const row = r as { title: string; hook: string | null; is_used: boolean };
        return {
            title: row.title,
            hook: row.hook,
            status: (row.is_used ? 'used' : 'saved') as 'saved' | 'used',
        };
    });

    const merged = [...conceptItems, ...ideaItems].slice(0, 20);
    return merged;
}

function parseVerdicts(content: string): Record<string, ValidatorOutput> {
    let stripped = content.trim();
    if (stripped.startsWith('```json')) stripped = stripped.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
    else if (stripped.startsWith('```')) stripped = stripped.replace(/^```\s*/, '').replace(/```$/, '').trim();

    let parsed: unknown;
    try {
        parsed = JSON.parse(stripped);
    } catch {
        return {};
    }

    if (!parsed || typeof parsed !== 'object') return {};

    // Expected: { verdicts: [...] }
    const verdicts = (parsed as { verdicts?: unknown }).verdicts;
    if (!Array.isArray(verdicts)) return {};

    const out: Record<string, ValidatorOutput> = {};
    for (const v of verdicts) {
        if (!v || typeof v !== 'object') continue;
        const obj = v as Record<string, unknown>;
        const id = String(obj.id ?? '');
        if (!id) continue;
        const scoresRaw = (obj.scores ?? {}) as Record<string, unknown>;
        const scores: ConceptScore = {
            novelty:     clampScore(scoresRaw.novelty),
            fit:         clampScore(scoresRaw.fit),
            specificity: clampScore(scoresRaw.specificity),
            composite:   clampScore(scoresRaw.composite),
        };
        // If the LLM forgot to compute composite, recompute from components
        // so downstream code can rely on it.
        if (scores.composite === 0 && (scores.novelty || scores.fit || scores.specificity)) {
            scores.composite = round3(0.4 * scores.novelty + 0.35 * scores.fit + 0.25 * scores.specificity);
        }
        out[id] = {
            id,
            scores,
            keep: obj.keep !== false,
            reject_reason: typeof obj.reject_reason === 'string' ? obj.reject_reason : undefined,
        };
    }
    return out;
}

function clampScore(v: unknown): number {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
}

function round3(n: number): number {
    return Math.round(n * 1000) / 1000;
}
