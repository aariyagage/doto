// GET /api/concepts — list the user's concepts with filters.
// Gated by CONCEPT_PIPELINE feature flag (returns 503 when disabled).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { flagFor } from '@/lib/env';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const ALLOWED_STATUSES = new Set([
    'draft', 'reviewed', 'saved', 'used', 'rejected', 'archived',
]);

function parseIntParam(value: string | null, fallback: number, max?: number): number {
    if (value === null || value === '') return fallback;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return fallback;
    const intN = Math.floor(n);
    return max !== undefined ? Math.min(intN, max) : intN;
}

export async function GET(request: Request) {
    try {
        const supabase = createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (!flagFor(user.id, 'conceptPipeline')) {
            return NextResponse.json(
                { error: 'feature_disabled', feature: 'CONCEPT_PIPELINE' },
                { status: 503 },
            );
        }

        const { searchParams } = new URL(request.url);
        const limit  = parseIntParam(searchParams.get('limit'),  DEFAULT_LIMIT, MAX_LIMIT);
        const offset = parseIntParam(searchParams.get('offset'), 0);

        const statusParam   = searchParams.get('status');
        const pillarIdParam = searchParams.get('pillar_id');

        let query = supabase
            .from('concepts')
            .select(`
                *,
                pillars ( id, name, color )
            `)
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (statusParam && ALLOWED_STATUSES.has(statusParam)) {
            query = query.eq('status', statusParam);
        }
        if (pillarIdParam) {
            query = query.eq('pillar_id', pillarIdParam);
        }

        const { data: concepts, error } = await query;
        if (error) {
            console.error('GET /concepts Supabase error:', JSON.stringify(error));
            return NextResponse.json({ error: error.message, code: error.code }, { status: 500 });
        }

        return NextResponse.json(concepts || []);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('GET /concepts Error:', err);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
