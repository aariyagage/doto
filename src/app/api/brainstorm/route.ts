// /api/brainstorm
//
// GET  ?status=     list user's notes (default all non-archived)
// POST {raw_text, pillar_id?}  create note + embed
//
// Gated by NEXT_PUBLIC_BRAINSTORM_INBOX (which requires CONCEPT_PIPELINE).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { flagFor } from '@/lib/env';
import { embedText } from '@/lib/pillars/embeddings';

export const dynamic = 'force-dynamic';

const RAW_TEXT_CAP = 2000;

const ALLOWED_STATUSES = new Set(['inbox', 'clustered', 'converted', 'archived']);

interface CreateBody {
    raw_text: string;
    pillar_id?: string | null;
}

export async function GET(request: Request) {
    try {
        const supabase = createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        if (!flagFor(user.id, 'brainstormInbox')) {
            return NextResponse.json({ error: 'feature_disabled', feature: 'BRAINSTORM_INBOX' }, { status: 503 });
        }

        const { searchParams } = new URL(request.url);
        const statusParam = searchParams.get('status');

        let query = supabase
            .from('brainstorm_notes')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });

        if (statusParam && ALLOWED_STATUSES.has(statusParam)) {
            query = query.eq('status', statusParam);
        } else {
            // Default: hide archived; show inbox + clustered + converted.
            query = query.neq('status', 'archived');
        }

        const { data, error } = await query;
        if (error) {
            console.error('GET /brainstorm error:', JSON.stringify(error));
            return NextResponse.json({ error: error.message }, { status: 500 });
        }
        return NextResponse.json(data ?? []);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('GET /brainstorm:', err);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const supabase = createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        if (!flagFor(user.id, 'brainstormInbox')) {
            return NextResponse.json({ error: 'feature_disabled', feature: 'BRAINSTORM_INBOX' }, { status: 503 });
        }

        let body: CreateBody;
        try {
            body = await request.json();
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }

        const rawText = (body.raw_text ?? '').trim();
        if (!rawText) return NextResponse.json({ error: 'raw_text is required' }, { status: 400 });
        const truncated = rawText.slice(0, RAW_TEXT_CAP);

        // Embed first; if HF cold-start fails, we still want to insert the
        // note (without an embedding) so the user doesn't lose their text.
        // Cluster will skip notes without an embedding; user can re-embed
        // later via PATCH if needed.
        let embedding: number[] | null = null;
        try {
            embedding = await embedText(truncated);
        } catch (err) {
            console.warn('POST /brainstorm: HF embed failed, inserting without embedding:', err);
        }

        const { data, error } = await supabase
            .from('brainstorm_notes')
            .insert({
                user_id: user.id,
                raw_text: truncated,
                pillar_id: body.pillar_id ?? null,
                note_embedding: embedding,
                status: 'inbox',
            })
            .select()
            .single();

        if (error) {
            console.error('POST /brainstorm insert failed:', JSON.stringify(error));
            return NextResponse.json({ error: error.message }, { status: 500 });
        }
        return NextResponse.json(data);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('POST /brainstorm:', err);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
