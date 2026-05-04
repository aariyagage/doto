// /api/brainstorm/[id]
//
// PATCH  edit raw_text / pillar_id / status. Re-embeds if raw_text changed.
// DELETE hard delete.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { flagFor } from '@/lib/env';
import { reembedBrainstormNote } from '@/lib/concepts/brainstorm';

export const dynamic = 'force-dynamic';

const RAW_TEXT_CAP = 2000;
const ALLOWED_STATUSES = new Set(['inbox', 'clustered', 'converted', 'archived']);

interface PatchBody {
    raw_text?: string;
    pillar_id?: string | null;
    status?: 'inbox' | 'clustered' | 'converted' | 'archived';
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
    try {
        const supabase = createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        if (!flagFor(user.id, 'brainstormInbox')) {
            return NextResponse.json({ error: 'feature_disabled', feature: 'BRAINSTORM_INBOX' }, { status: 503 });
        }

        let body: PatchBody = {};
        try {
            body = await request.json();
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }

        const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
        let textChanged = false;
        let newRawText: string | undefined;

        if (typeof body.raw_text === 'string') {
            const trimmed = body.raw_text.trim();
            if (!trimmed) return NextResponse.json({ error: 'raw_text cannot be empty' }, { status: 400 });
            const capped = trimmed.slice(0, RAW_TEXT_CAP);
            update.raw_text = capped;
            newRawText = capped;
            textChanged = true;
        }

        if (body.pillar_id !== undefined) update.pillar_id = body.pillar_id;

        if (body.status !== undefined) {
            if (!ALLOWED_STATUSES.has(body.status)) {
                return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
            }
            update.status = body.status;
        }

        if (Object.keys(update).length === 1) {
            // Only updated_at would change.
            return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 });
        }

        const { data, error } = await supabase
            .from('brainstorm_notes')
            .update(update)
            .eq('user_id', user.id)
            .eq('id', params.id)
            .select()
            .single();

        if (error || !data) {
            console.error('PATCH /brainstorm/[id] update failed:', JSON.stringify(error));
            return NextResponse.json({ error: error?.message ?? 'update failed' }, { status: 500 });
        }

        // Re-embed if raw_text changed. Non-fatal: if HF fails, the row
        // keeps its old (now-stale) embedding and cluster will be off
        // until the user retries; we surface that via response field.
        let reembedFailed = false;
        if (textChanged && newRawText) {
            try {
                await reembedBrainstormNote(supabase, user.id, params.id, newRawText);
            } catch (err) {
                console.warn('PATCH /brainstorm: reembed failed:', err);
                reembedFailed = true;
            }
        }

        return NextResponse.json({ ...data, reembed_failed: reembedFailed || undefined });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('PATCH /brainstorm/[id]:', err);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
    try {
        const supabase = createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        if (!flagFor(user.id, 'brainstormInbox')) {
            return NextResponse.json({ error: 'feature_disabled', feature: 'BRAINSTORM_INBOX' }, { status: 503 });
        }

        const { error } = await supabase
            .from('brainstorm_notes')
            .delete()
            .eq('user_id', user.id)
            .eq('id', params.id);

        if (error) {
            console.error('DELETE /brainstorm/[id] error:', JSON.stringify(error));
            return NextResponse.json({ error: error.message }, { status: 500 });
        }
        return NextResponse.json({ success: true });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('DELETE /brainstorm/[id]:', err);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
