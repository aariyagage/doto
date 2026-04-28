import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireEnv } from '@/lib/env';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { backfillEssencesForUser } from '@/lib/pillars/essence';
import Groq from 'groq-sdk';

export const dynamic = 'force-dynamic';

const BATCH_SIZE = 5;

// Generates essences for transcripts that don't have one yet. Processes a small
// batch per call so a one-time backfill script can paginate without hammering
// the Groq free tier. Returns how many remain so the caller knows when to stop.
export async function POST() {
    try {
        const supabase = createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const rl = rateLimit({ key: `backfill-essences:${user.id}`, ...RATE_LIMITS.llmGeneration });
        if (!rl.ok) {
            return NextResponse.json(
                { error: `Rate limit exceeded. Try again in ${rl.retryAfterSeconds}s.` },
                { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
            );
        }

        const groq = new Groq({ apiKey: requireEnv('GROQ_API_KEY') });
        const result = await backfillEssencesForUser(supabase, user.id, groq, BATCH_SIZE);

        return NextResponse.json({ success: true, ...result, batchSize: BATCH_SIZE });
    } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error('POST /pillars/backfill-essences Error:', errorMessage);
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}
