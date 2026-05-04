// Cosine dedup unit test.
//
// dedupeWithinBatch is the only fully pure piece of dedup.ts. The other
// two filters (saved concepts, saved legacy ideas) hit Supabase and are
// integration-tested in M8.
//
// We hand-construct vectors at known cosine distances:
//   - identical (sim ≈ 1.00) → reject (>= 0.85 threshold)
//   - tilted slightly (sim ≈ 0.90) → reject (>= 0.85)
//   - tilted more (sim ≈ 0.80) → keep (< 0.85)

import { describe, it, expect } from 'vitest';
import { dedupeWithinBatch, CONCEPT_DEDUP_COSINE_THRESHOLD, type CandidateWithEmbedding } from '@/lib/concepts/dedup';
import { cosineSimilarity } from '@/lib/pillars/embeddings';
import type { ConceptCandidate } from '@/lib/concepts/types';

const DIM = 384;

function makeCandidate(title: string): ConceptCandidate {
    return { title, hook: 'h', angle: 'a', structure: null, ai_reason: 'r' };
}

// Build a unit vector along basis e_i (simple way to get orthogonal pairs).
function basis(i: number): number[] {
    const v = new Array<number>(DIM).fill(0);
    v[i] = 1;
    return v;
}

// Normalize to unit length.
function normalize(v: number[]): number[] {
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    if (norm === 0) return v;
    return v.map(x => x / norm);
}

// Construct a vector at angle theta (radians) from baseVec, in the plane
// spanned by baseVec and otherDir. cos(theta) is the resulting similarity.
function vectorAtAngle(baseVec: number[], otherDir: number[], theta: number): number[] {
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const result = baseVec.map((b, i) => cos * b + sin * otherDir[i]);
    return normalize(result);
}

describe('dedupeWithinBatch', () => {
    it('keeps a single item', () => {
        const items: CandidateWithEmbedding[] = [
            { candidate: makeCandidate('first'), embedding: basis(0) },
        ];
        const r = dedupeWithinBatch(items);
        expect(r.kept.length).toBe(1);
        expect(r.dropped.length).toBe(0);
    });

    it('drops near-identical pairs (sim ~= 1.00, >= threshold)', () => {
        const v1 = basis(0);
        const v2 = basis(0); // exact duplicate
        const items: CandidateWithEmbedding[] = [
            { candidate: makeCandidate('first'),  embedding: v1 },
            { candidate: makeCandidate('second'), embedding: v2 },
        ];
        const r = dedupeWithinBatch(items);
        expect(r.kept.length).toBe(1);
        expect(r.dropped.length).toBe(1);
        expect(r.dropped[0].decision.reason).toBe('cosine_self');
        expect(r.dropped[0].decision.similarity).toBeCloseTo(1.0, 6);
    });

    it('drops pairs at sim ~= 0.90 (above 0.85 threshold)', () => {
        const base  = basis(0);
        const other = basis(1);
        const sim   = 0.90;
        const theta = Math.acos(sim);
        const v1 = base;
        const v2 = vectorAtAngle(base, other, theta);

        // Sanity: confirm the manufactured vectors are at the expected sim.
        const measured = cosineSimilarity(v1, v2);
        expect(measured).toBeCloseTo(sim, 5);

        const items: CandidateWithEmbedding[] = [
            { candidate: makeCandidate('first'),  embedding: v1 },
            { candidate: makeCandidate('second'), embedding: v2 },
        ];
        const r = dedupeWithinBatch(items);
        expect(r.kept.length).toBe(1);
        expect(r.dropped.length).toBe(1);
    });

    it('keeps pairs at sim ~= 0.80 (below 0.85 threshold)', () => {
        const base  = basis(0);
        const other = basis(1);
        const sim   = 0.80;
        const theta = Math.acos(sim);
        const v1 = base;
        const v2 = vectorAtAngle(base, other, theta);

        const measured = cosineSimilarity(v1, v2);
        expect(measured).toBeCloseTo(sim, 5);

        const items: CandidateWithEmbedding[] = [
            { candidate: makeCandidate('first'),  embedding: v1 },
            { candidate: makeCandidate('second'), embedding: v2 },
        ];
        const r = dedupeWithinBatch(items);
        expect(r.kept.length).toBe(2);
        expect(r.dropped.length).toBe(0);
    });

    it('threshold boundary: exactly at 0.85 is rejected (>= comparison)', () => {
        const base  = basis(0);
        const other = basis(1);
        const sim   = CONCEPT_DEDUP_COSINE_THRESHOLD; // 0.85
        const theta = Math.acos(sim);
        const v1 = base;
        const v2 = vectorAtAngle(base, other, theta);

        const measured = cosineSimilarity(v1, v2);
        expect(measured).toBeCloseTo(sim, 5);

        const items: CandidateWithEmbedding[] = [
            { candidate: makeCandidate('first'),  embedding: v1 },
            { candidate: makeCandidate('second'), embedding: v2 },
        ];
        const r = dedupeWithinBatch(items);
        // 0.85 >= 0.85 → drop the second. Boundary inclusive.
        expect(r.kept.length).toBe(1);
        expect(r.dropped.length).toBe(1);
    });

    it('keeps three orthogonal items (all-novel batch)', () => {
        const items: CandidateWithEmbedding[] = [
            { candidate: makeCandidate('a'), embedding: basis(0) },
            { candidate: makeCandidate('b'), embedding: basis(1) },
            { candidate: makeCandidate('c'), embedding: basis(2) },
        ];
        const r = dedupeWithinBatch(items);
        expect(r.kept.length).toBe(3);
        expect(r.dropped.length).toBe(0);
    });

    it('order-dependent: earlier items win when both above threshold', () => {
        // The greedy algorithm keeps whichever item comes first. The
        // caller is expected to sort by composite score before passing
        // in; we verify the order-dependence here so the contract is
        // explicit.
        const v1 = basis(0);
        const v2 = basis(0); // duplicate of v1
        const items: CandidateWithEmbedding[] = [
            { candidate: makeCandidate('high-score'), embedding: v1 },
            { candidate: makeCandidate('low-score'),  embedding: v2 },
        ];
        const r = dedupeWithinBatch(items);
        expect(r.kept.length).toBe(1);
        expect(r.kept[0].candidate.title).toBe('high-score');
        expect(r.dropped[0].item.candidate.title).toBe('low-score');
    });
});
