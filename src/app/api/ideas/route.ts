import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const BULK_DELETE_CONFIRMATION = 'DELETE_ALL_IDEAS';

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

        const { searchParams } = new URL(request.url);
        const limit = parseIntParam(searchParams.get('limit'), DEFAULT_LIMIT, MAX_LIMIT);
        const offset = parseIntParam(searchParams.get('offset'), 0);

        const { data: ideas, error } = await supabase
            .from('content_ideas')
            .select(`
                *,
                pillars ( id, name, color )
            `)
            .eq('user_id', user.id)
            .order('generated_at', { ascending: false })
            .range(offset, offset + limit - 1);

        // Diagnostic: compare user-scoped count vs. what SELECT returns so we can
        // distinguish "no rows exist" from "rows exist but RLS filters them out".
        const { count: unscopedCount } = await supabase
            .from('content_ideas')
            .select('*', { count: 'exact', head: true });

        console.log(
            `GET /ideas — user=${user.id} returned=${ideas?.length ?? 0} ` +
            `total_visible_to_session=${unscopedCount ?? '?'} offset=${offset} limit=${limit}`
        );

        if (error) {
            console.error("GET /ideas Supabase error:", JSON.stringify(error));
            return NextResponse.json({ error: error.message, code: error.code }, { status: 500 });
        }

        return NextResponse.json(ideas || []);
    } catch (err: any) {
        console.error("GET /ideas Error:", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    try {
        const supabase = createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        let body: { confirm?: unknown } = {};
        try {
            body = await request.json();
        } catch {
            // empty body — treated as missing confirmation
        }

        if (body.confirm !== BULK_DELETE_CONFIRMATION) {
            return NextResponse.json(
                { error: `Bulk delete requires confirmation. Send { "confirm": "${BULK_DELETE_CONFIRMATION}" } in the body.` },
                { status: 400 }
            );
        }

        const { error } = await supabase
            .from('content_ideas')
            .delete()
            .eq('user_id', user.id);

        if (error) {
            console.error("DELETE /ideas Error:", error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error("DELETE /ideas Error:", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
