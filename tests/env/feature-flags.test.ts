// Feature-flag layering rules.
//
// These rules are documented in docs/feature-flags.md and enforced in
// src/lib/env.ts. The tests pin them so a refactor can't quietly let
// brainstorm or workspace surface UI when concepts pipeline is off, and
// can't quietly require concepts pipeline for research (which is meant
// to be independent).
//
// Note: featureFlags uses LITERAL process.env.NEXT_PUBLIC_X access (see
// the M3 fix and feedback_next_define_plugin_literal.md). At runtime in
// Vitest, process.env IS the real Node env, so we can mutate env vars
// here and the helpers see the change.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Capture/restore env so tests don't leak.
const FLAG_KEYS = [
    'NEXT_PUBLIC_CONCEPT_PIPELINE',
    'NEXT_PUBLIC_BRAINSTORM_INBOX',
    'NEXT_PUBLIC_WORKSPACE_V1',
    'NEXT_PUBLIC_RESEARCH_PASS',
    'NEXT_PUBLIC_SCRIPT_REFINER',
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
    saved = {};
    for (const k of FLAG_KEYS) {
        saved[k] = process.env[k];
        delete process.env[k];
    }
});

afterEach(() => {
    for (const k of FLAG_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
    }
});

describe('featureFlags', () => {
    it('all flags are false when no env vars are set', async () => {
        const { featureFlags } = await import('@/lib/env');
        expect(featureFlags.conceptPipeline()).toBe(false);
        expect(featureFlags.brainstormInbox()).toBe(false);
        expect(featureFlags.workspaceV1()).toBe(false);
        expect(featureFlags.researchPass()).toBe(false);
        expect(featureFlags.scriptRefiner()).toBe(false);
    });

    it('conceptPipeline alone unlocks only conceptPipeline', async () => {
        process.env.NEXT_PUBLIC_CONCEPT_PIPELINE = 'true';
        const { featureFlags } = await import('@/lib/env');
        expect(featureFlags.conceptPipeline()).toBe(true);
        expect(featureFlags.brainstormInbox()).toBe(false);
        expect(featureFlags.workspaceV1()).toBe(false);
    });

    it('brainstormInbox requires conceptPipeline (transitive gate)', async () => {
        // Set brainstorm flag without concept pipeline -- must stay false.
        process.env.NEXT_PUBLIC_BRAINSTORM_INBOX = 'true';
        const { featureFlags } = await import('@/lib/env');
        expect(featureFlags.brainstormInbox()).toBe(false);
    });

    it('workspaceV1 requires conceptPipeline', async () => {
        process.env.NEXT_PUBLIC_WORKSPACE_V1 = 'true';
        const { featureFlags } = await import('@/lib/env');
        expect(featureFlags.workspaceV1()).toBe(false);
    });

    it('scriptRefiner requires conceptPipeline', async () => {
        process.env.NEXT_PUBLIC_SCRIPT_REFINER = 'true';
        const { featureFlags } = await import('@/lib/env');
        expect(featureFlags.scriptRefiner()).toBe(false);
    });

    it('researchPass is independent of conceptPipeline', async () => {
        // This is the one flag that explicitly should NOT layer behind
        // conceptPipeline -- a future standalone surface might call
        // /api/research without the concepts pipeline being on.
        process.env.NEXT_PUBLIC_RESEARCH_PASS = 'true';
        const { featureFlags } = await import('@/lib/env');
        expect(featureFlags.researchPass()).toBe(true);
        expect(featureFlags.conceptPipeline()).toBe(false);
    });

    it('all transitive flags activate when conceptPipeline + the flag is set', async () => {
        process.env.NEXT_PUBLIC_CONCEPT_PIPELINE = 'true';
        process.env.NEXT_PUBLIC_BRAINSTORM_INBOX = 'true';
        process.env.NEXT_PUBLIC_WORKSPACE_V1 = 'true';
        process.env.NEXT_PUBLIC_RESEARCH_PASS = 'true';
        const { featureFlags } = await import('@/lib/env');
        expect(featureFlags.conceptPipeline()).toBe(true);
        expect(featureFlags.brainstormInbox()).toBe(true);
        expect(featureFlags.workspaceV1()).toBe(true);
        expect(featureFlags.researchPass()).toBe(true);
        // scriptRefiner stays false because we didn't enable it.
        expect(featureFlags.scriptRefiner()).toBe(false);
    });

    it('exact value comparison: "1", "TRUE", "yes" do NOT enable a flag', async () => {
        // Strict 'true' to avoid accidental activation. The plan documents
        // this explicitly.
        process.env.NEXT_PUBLIC_CONCEPT_PIPELINE = '1';
        let { featureFlags } = await import('@/lib/env');
        expect(featureFlags.conceptPipeline()).toBe(false);

        process.env.NEXT_PUBLIC_CONCEPT_PIPELINE = 'TRUE';
        ({ featureFlags } = await import('@/lib/env'));
        expect(featureFlags.conceptPipeline()).toBe(false);

        process.env.NEXT_PUBLIC_CONCEPT_PIPELINE = 'yes';
        ({ featureFlags } = await import('@/lib/env'));
        expect(featureFlags.conceptPipeline()).toBe(false);
    });
});

describe('flagFor allowlist', () => {
    it('returns the underlying flag when user is not on the allowlist', async () => {
        const { flagFor } = await import('@/lib/env');
        // No env vars set, no allowlist match -> false.
        expect(flagFor('any-uuid', 'conceptPipeline')).toBe(false);
    });

    it('honors a non-set flag for null userId (anonymous request)', async () => {
        const { flagFor } = await import('@/lib/env');
        expect(flagFor(null, 'conceptPipeline')).toBe(false);
        expect(flagFor(undefined, 'conceptPipeline')).toBe(false);
    });

    it('honors env-set flag for any userId', async () => {
        process.env.NEXT_PUBLIC_CONCEPT_PIPELINE = 'true';
        const { flagFor } = await import('@/lib/env');
        expect(flagFor('any-uuid', 'conceptPipeline')).toBe(true);
        expect(flagFor(null, 'conceptPipeline')).toBe(true);
    });
});
