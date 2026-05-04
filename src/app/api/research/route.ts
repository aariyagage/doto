// POST /api/research
//
// Body: { topic: string, pillar_id?: uuid }
// Returns: { summary: string, citations: ResearchCitation[] }
//
// Pulls own-corpus context (transcripts via match_transcripts_by_essence
// + recent tiktok_trends / reddit_trends for the pillar) and summarizes
// via 1 Groq call. Cost: 1 Groq + 1 HF (topic embedding).
//
// Gated by NEXT_PUBLIC_RESEARCH_PASS. Independent of CONCEPT_PIPELINE
// per the flag-layering rules in docs/feature-flags.md -- a future
// surface might call /api/research standalone (the assistant view, etc.)
// without requiring the full concepts pipeline to be on.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { flagFor } from '@/lib/env';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import {
    runResearch,
    openPipelineRun,
    closePipelineRun,
    type PipelineErrorKind,
} from '@/lib/concepts';

export const dynamic = 'force-dynamic';

interface Body {
    topic: string;
    pillar_id?: string | null;
}

const TOPIC_CAP = 500;

export async function POST(request: Request) {
    try {
        const supabase = createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        if (!flagFor(user.id, 'researchPass')) {
            return NextResponse.json({ error: 'feature_disabled', feature: 'RESEARCH_PASS' }, { status: 503 });
        }

        const rl = rateLimit({ key: `research:${user.id}`, ...RATE_LIMITS.llmGeneration });
        if (!rl.ok) {
            return NextResponse.json(
                { error: 'rate_limit', retry_after_seconds: rl.retryAfterSeconds },
                { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
            );
        }

        let body: Body;
        try {
            body = await request.json();
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }

        const topic = (body.topic ?? '').trim().slice(0, TOPIC_CAP);
        if (!topic) return NextResponse.json({ error: 'topic required' }, { status: 400 });

        const runHandle = await openPipelineRun({
            supabase,
            userId: user.id,
            kind: 'research',
            metadata: { pillar_id: body.pillar_id ?? null, topic_chars: topic.length },
        });

        try {
            const result = await runResearch({
                supabase,
                userId: user.id,
                topic,
                pillarId: body.pillar_id ?? null,
            });
            if (runHandle) {
                runHandle.groqCalls = result.groqCalls;
                runHandle.hfCalls = result.hfCalls;
                await closePipelineRun({
                    supabase, handle: runHandle, status: 'succeeded',
                    metadata: { citations: result.citations.length },
                });
            }
            return NextResponse.json({
                summary: result.summary,
                citations: result.citations,
            });
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (runHandle) {
                await closePipelineRun({
                    supabase, handle: runHandle, status: 'failed',
                    errorKind: classifyError(msg),
                    metadata: { message: msg },
                });
            }
            throw err;
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('POST /research:', err);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}

function classifyError(msg: string): PipelineErrorKind {
    if (msg.includes('rate') && msg.includes('limit')) return 'rate_limit';
    if (msg.includes('timeout')) return 'timeout';
    if (msg.includes('JSON') || msg.includes('unparseable')) return 'parse_error';
    if (msg.includes('topic is required') || msg.includes('empty summary')) return 'validation';
    return 'unknown';
}
