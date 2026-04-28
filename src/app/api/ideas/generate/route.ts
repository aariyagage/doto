import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { generateIdeasForUser } from '@/lib/ideas/generate';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    try {
        const supabase = createClient();

        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const rl = rateLimit({ key: `ideas-generate:${user.id}`, ...RATE_LIMITS.llmGeneration });
        if (!rl.ok) {
            return NextResponse.json(
                { error: `Rate limit exceeded. Try again in ${rl.retryAfterSeconds}s.` },
                { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
            );
        }

        let body: { pillar_ids?: unknown; count?: unknown } = {};
        try {
            body = await request.json();
        } catch {
            // body is optional
        }
        const pillarIds = Array.isArray(body.pillar_ids) ? (body.pillar_ids as string[]) : [];
        const perPillarCount = Number(body.count) || 3;

        const result = await generateIdeasForUser({ supabase, userId: user.id, pillarIds, perPillarCount });

        if (result.error) {
            return NextResponse.json({ error: result.error }, { status: 400 });
        }

        return NextResponse.json(result.insertedRaw);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error('Idea generator error:', err);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
