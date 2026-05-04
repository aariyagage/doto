// pipeline_runs lifecycle helpers.
//
// Open a run at request entry, accumulate model-call counts, close it on
// success or failure. The M8 sliding-window rate limiter reads recent rows
// to compute remaining Groq budget per user — see docs/observability.md.

import type { SupabaseServer } from '@/lib/pillars/types';
import type { PipelineErrorKind, PipelineRunKind } from './types';

export interface OpenPipelineRunArgs {
    supabase: SupabaseServer;
    userId: string;
    kind: PipelineRunKind;
    metadata?: Record<string, unknown>;
}

export interface PipelineRunHandle {
    id: string;
    userId: string;
    kind: PipelineRunKind;
    startedAt: number; // ms epoch — used to compute latency at close
    groqCalls: number;
    hfCalls: number;
    tokensIn: number;
    tokensOut: number;
}

export async function openPipelineRun(args: OpenPipelineRunArgs): Promise<PipelineRunHandle | null> {
    const { supabase, userId, kind, metadata } = args;

    const { data, error } = await supabase
        .from('pipeline_runs')
        .insert({
            user_id: userId,
            kind,
            status: 'running',
            metadata: metadata ?? null,
        })
        .select('id')
        .single();

    if (error || !data) {
        console.error(`pipeline_runs open failed kind=${kind}:`, JSON.stringify(error));
        return null;
    }

    return {
        id: (data as { id: string }).id,
        userId,
        kind,
        startedAt: Date.now(),
        groqCalls: 0,
        hfCalls: 0,
        tokensIn: 0,
        tokensOut: 0,
    };
}

export function tallyGroqCall(handle: PipelineRunHandle, tokensIn?: number, tokensOut?: number): void {
    handle.groqCalls += 1;
    if (typeof tokensIn === 'number')  handle.tokensIn  += tokensIn;
    if (typeof tokensOut === 'number') handle.tokensOut += tokensOut;
}

export function tallyHfCall(handle: PipelineRunHandle, count = 1): void {
    handle.hfCalls += count;
}

export interface ClosePipelineRunArgs {
    supabase: SupabaseServer;
    handle: PipelineRunHandle;
    status: 'succeeded' | 'failed';
    errorKind?: PipelineErrorKind | null;
    metadata?: Record<string, unknown>;
}

export async function closePipelineRun(args: ClosePipelineRunArgs): Promise<void> {
    const { supabase, handle, status, errorKind, metadata } = args;

    const latencyMs = Date.now() - handle.startedAt;

    const { error } = await supabase
        .from('pipeline_runs')
        .update({
            status,
            groq_calls: handle.groqCalls,
            hf_calls: handle.hfCalls,
            tokens_in: handle.tokensIn || null,
            tokens_out: handle.tokensOut || null,
            latency_ms: latencyMs,
            error_kind: errorKind ?? null,
            metadata: metadata ?? null,
            finished_at: new Date().toISOString(),
        })
        .eq('id', handle.id)
        .eq('user_id', handle.userId);

    if (error) {
        console.error(`pipeline_runs close failed run=${handle.id}:`, JSON.stringify(error));
    }
}
