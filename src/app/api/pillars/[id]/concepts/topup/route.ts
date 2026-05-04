// POST /api/pillars/[id]/concepts/topup
//
// Manual trigger for the same concept top-up that runs after a video
// upload when CONCEPT_PIPELINE is on. Useful from the workspace ("fill
// this pillar with fresh concepts") or as a recovery hook if the upload
// pipeline failed but tagging succeeded.
//
// Body: none. Always uses count=2 (the topup default). For larger
// batches the user should hit /api/concepts/generate from /concepts.
//
// Cost: up to 2 Groq + 2 HF per pillar. Per-user rate limit reuses
// llmGeneration. Gated by CONCEPT_PIPELINE.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { flagFor } from '@/lib/env';
import { rateLimit, RATE_LIMITS, checkPerUserGroqQuota, projectedGroqCallsForKind } from '@/lib/rate-limit';
import { topUpConceptsForPillars } from '@/lib/concepts';

export const dynamic = 'force-dynamic';

export async function POST(_request: Request, { params }: { params: { id: string } }) {
    try {
        const supabase = createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        if (!flagFor(user.id, 'conceptPipeline')) {
            return NextResponse.json({ error: 'feature_disabled', feature: 'CONCEPT_PIPELINE' }, { status: 503 });
        }

        const rl = rateLimit({
            key: `concepts.topup:${user.id}`,
            ...RATE_LIMITS.llmGeneration,
        });
        if (!rl.ok) {
            return NextResponse.json(
                { error: 'rate_limit', retry_after_seconds: rl.retryAfterSeconds },
                { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
            );
        }
        const quota = await checkPerUserGroqQuota(supabase, user.id, projectedGroqCallsForKind('topup'));
        if (!quota.ok) {
            return NextResponse.json(
                { error: 'rate_limit', retry_after_seconds: quota.retryAfterSeconds, used_in_window: quota.usedInWindow },
                { status: 429, headers: { 'Retry-After': String(quota.retryAfterSeconds) } },
            );
        }

        // Verify the pillar belongs to the caller (RLS would catch it
        // anyway but a friendly 404 is nicer).
        const { data: pillar, error: pillarErr } = await supabase
            .from('pillars')
            .select('id')
            .eq('user_id', user.id)
            .eq('id', params.id)
            .single();
        if (pillarErr || !pillar) {
            return NextResponse.json({ error: 'pillar not found' }, { status: 404 });
        }

        const result = await topUpConceptsForPillars({
            supabase,
            userId: user.id,
            pillarIds: [params.id],
        });

        return NextResponse.json({
            generated: result.generated,
            pillars_topped_up: result.pillarsToppedUp,
            already_full: result.pillarsToppedUp === 0,
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('POST /pillars/[id]/concepts/topup:', err);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
