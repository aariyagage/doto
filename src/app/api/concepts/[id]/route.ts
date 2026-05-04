// /api/concepts/[id]
//
// GET   — concept + events timeline for the detail page.
// PATCH — edit fields and/or change status. Writes a concept_events row.
// DELETE — remove a concept (cascade-removes its events).
//
// Status transitions allowed (enforced here AND by docs/concepts-architecture.md):
//   draft     -> reviewed | saved | rejected | archived
//   reviewed  -> saved | rejected | archived
//   saved     -> used | rejected | archived
//   used      -> archived
//   rejected  -> draft | archived
//   archived  -> draft

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { flagFor } from '@/lib/env';
import { recordConceptEvent } from '@/lib/concepts/events';
import type { ConceptEventType, ConceptStatus } from '@/lib/concepts/types';

export const dynamic = 'force-dynamic';

const ALLOWED_TRANSITIONS: Record<ConceptStatus, ConceptStatus[]> = {
    draft:    ['reviewed', 'saved', 'rejected', 'archived'],
    reviewed: ['saved', 'rejected', 'archived'],
    saved:    ['used', 'rejected', 'archived'],
    used:     ['archived'],
    rejected: ['draft', 'archived'],
    archived: ['draft'],
};

const STATUS_TO_EVENT_TYPE: Partial<Record<ConceptStatus, ConceptEventType>> = {
    reviewed: 'reviewed',
    saved:    'saved',
    used:     'used',
    rejected: 'rejected',
    archived: 'archived',
    draft:    'edited', // un-archive / un-reject -> log as edited
};

interface PatchBody {
    title?: string;
    hook?: string | null;
    angle?: string | null;
    structure?: unknown;
    status?: ConceptStatus;
    pillar_id?: string | null;
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
    try {
        const supabase = createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        if (!flagFor(user.id, 'conceptPipeline')) {
            return NextResponse.json({ error: 'feature_disabled', feature: 'CONCEPT_PIPELINE' }, { status: 503 });
        }

        const { data: concept, error } = await supabase
            .from('concepts')
            .select(`
                *,
                pillars ( id, name, color )
            `)
            .eq('user_id', user.id)
            .eq('id', params.id)
            .single();

        if (error || !concept) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const { data: events } = await supabase
            .from('concept_events')
            .select('*')
            .eq('user_id', user.id)
            .eq('concept_id', params.id)
            .order('created_at', { ascending: true });

        return NextResponse.json({ concept, events: events ?? [] });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('GET /concepts/[id] Error:', err);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
    try {
        const supabase = createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        if (!flagFor(user.id, 'conceptPipeline')) {
            return NextResponse.json({ error: 'feature_disabled', feature: 'CONCEPT_PIPELINE' }, { status: 503 });
        }

        let body: PatchBody = {};
        try {
            body = await request.json();
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }

        // Pull current row to validate status transition + ownership.
        const { data: current, error: fetchErr } = await supabase
            .from('concepts')
            .select('id, user_id, status, title, hook')
            .eq('user_id', user.id)
            .eq('id', params.id)
            .single();

        if (fetchErr || !current) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
        let statusTransition: { from: ConceptStatus; to: ConceptStatus } | null = null;
        const editedFields: string[] = [];

        if (typeof body.title === 'string' && body.title.trim()) {
            update.title = body.title.trim();
            editedFields.push('title');
        }
        if (body.hook !== undefined) {
            update.hook = body.hook === null ? null : String(body.hook).trim();
            editedFields.push('hook');
        }
        if (body.angle !== undefined) {
            update.angle = body.angle === null ? null : String(body.angle).trim();
            editedFields.push('angle');
        }
        if (body.structure !== undefined) {
            update.structure = body.structure;
            editedFields.push('structure');
        }
        if (body.pillar_id !== undefined) {
            update.pillar_id = body.pillar_id;
            editedFields.push('pillar_id');
        }

        if (body.status) {
            const from = (current as { status: ConceptStatus }).status;
            const to = body.status;
            const allowed = ALLOWED_TRANSITIONS[from] ?? [];
            if (!allowed.includes(to)) {
                return NextResponse.json(
                    { error: `Invalid status transition: ${from} -> ${to}` },
                    { status: 400 },
                );
            }
            update.status = to;
            statusTransition = { from, to };

            // Stamp the appropriate timestamp column.
            if (to === 'reviewed') update.reviewed_at = new Date().toISOString();
            if (to === 'saved')    update.saved_at    = new Date().toISOString();
            if (to === 'used')     update.used_at     = new Date().toISOString();
        }

        if (Object.keys(update).length === 1) {
            // Only updated_at would change — nothing to do.
            return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 });
        }

        const { data: updated, error: updateErr } = await supabase
            .from('concepts')
            .update(update)
            .eq('user_id', user.id)
            .eq('id', params.id)
            .select()
            .single();

        if (updateErr || !updated) {
            console.error('PATCH /concepts/[id] update failed:', JSON.stringify(updateErr));
            return NextResponse.json({ error: updateErr?.message ?? 'update failed' }, { status: 500 });
        }

        // Write the event(s). A single PATCH may both edit fields AND change
        // status — record both for cleaner timelines.
        if (editedFields.length > 0 && !statusTransition) {
            await recordConceptEvent({
                supabase,
                userId: user.id,
                conceptId: params.id,
                eventType: 'edited',
                metadata: { fields: editedFields },
            });
        }
        if (statusTransition) {
            const eventType = STATUS_TO_EVENT_TYPE[statusTransition.to] ?? 'edited';
            await recordConceptEvent({
                supabase,
                userId: user.id,
                conceptId: params.id,
                eventType,
                fromStatus: statusTransition.from,
                toStatus: statusTransition.to,
                metadata: editedFields.length > 0 ? { also_edited: editedFields } : undefined,
            });
        }

        return NextResponse.json(updated);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('PATCH /concepts/[id] Error:', err);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
    try {
        const supabase = createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        if (!flagFor(user.id, 'conceptPipeline')) {
            return NextResponse.json({ error: 'feature_disabled', feature: 'CONCEPT_PIPELINE' }, { status: 503 });
        }

        const { error } = await supabase
            .from('concepts')
            .delete()
            .eq('user_id', user.id)
            .eq('id', params.id);

        if (error) {
            console.error('DELETE /concepts/[id] error:', JSON.stringify(error));
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('DELETE /concepts/[id] Error:', err);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
