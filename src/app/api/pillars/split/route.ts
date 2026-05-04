// POST /api/pillars/split
//
// Create a new pillar (with embedding via HF) and move a specified set of
// concepts into it. The originating pillar keeps everything else.
//
// Body: { pillar_id: uuid, concept_ids: uuid[], new_name: string,
//         new_description?: string }
//
// 1 HF call (new pillar embedding), 0 Groq calls.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { flagFor } from '@/lib/env';
import { embedText } from '@/lib/pillars/embeddings';

export const dynamic = 'force-dynamic';

interface Body {
    pillar_id: string;
    concept_ids: string[];
    new_name: string;
    new_description?: string;
    color?: string;
}

export async function POST(request: Request) {
    try {
        const supabase = createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        if (!flagFor(user.id, 'workspaceV1')) {
            return NextResponse.json({ error: 'feature_disabled', feature: 'WORKSPACE_V1' }, { status: 503 });
        }

        let body: Body;
        try {
            body = await request.json();
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }

        if (!body.pillar_id || !Array.isArray(body.concept_ids) || body.concept_ids.length === 0) {
            return NextResponse.json({ error: 'pillar_id and concept_ids[] are required' }, { status: 400 });
        }
        const newName = (body.new_name ?? '').trim();
        if (!newName) {
            return NextResponse.json({ error: 'new_name is required' }, { status: 400 });
        }

        // Verify the source pillar belongs to the user.
        const { data: sourcePillar, error: pillarErr } = await supabase
            .from('pillars')
            .select('id, name, color')
            .eq('user_id', user.id)
            .eq('id', body.pillar_id)
            .single();
        if (pillarErr || !sourcePillar) {
            return NextResponse.json({ error: 'source pillar not found' }, { status: 404 });
        }

        // Embed the new pillar's name + description for cosine search to
        // work against future videos. Same pattern as pillar discovery
        // uses for tag-or-create.
        const embedTarget = body.new_description?.trim()
            ? `${newName}. ${body.new_description.trim()}`
            : newName;

        let embedding: number[] | null = null;
        try {
            embedding = await embedText(embedTarget);
        } catch (err) {
            console.warn('split: HF embed failed, creating pillar without embedding:', err);
            // Non-fatal; pillar tag-or-create can still cosine-match against
            // it once a future upload re-runs the embedder for the pillar.
        }

        // Create the new pillar. The unique (user_id, lower(name)) index
        // catches collisions; we surface a 409 so the UI can prompt for a
        // different name.
        const insertPayload: Record<string, unknown> = {
            user_id: user.id,
            name: newName,
            description: body.new_description?.trim() || null,
            embedding,
            source_origin: 'user_manual',
            color: body.color || (sourcePillar as { color: string }).color, // inherit by default
        };

        const { data: newPillar, error: insertErr } = await supabase
            .from('pillars')
            .insert(insertPayload)
            .select()
            .single();

        if (insertErr) {
            const isUniqueConflict = (insertErr as { code?: string }).code === '23505';
            return NextResponse.json(
                { error: isUniqueConflict ? `A pillar named "${newName}" already exists.` : insertErr.message },
                { status: isUniqueConflict ? 409 : 500 },
            );
        }

        // Move the requested concepts. We re-check pillar_id and user_id
        // to prevent moving someone else's concepts even if the caller
        // passes IDs they don't own (RLS catches this too).
        const { count: movedConcepts, error: moveErr } = await supabase
            .from('concepts')
            .update({ pillar_id: (newPillar as { id: string }).id }, { count: 'exact' })
            .eq('user_id', user.id)
            .eq('pillar_id', body.pillar_id)
            .in('id', body.concept_ids);

        if (moveErr) {
            console.error('split move concepts failed:', JSON.stringify(moveErr));
            // Roll back the new pillar so the user isn't left with a
            // half-applied split.
            await supabase
                .from('pillars')
                .delete()
                .eq('user_id', user.id)
                .eq('id', (newPillar as { id: string }).id);
            return NextResponse.json({ error: moveErr.message, stage: 'move_concepts' }, { status: 500 });
        }

        return NextResponse.json({
            new_pillar: newPillar,
            moved_concepts: movedConcepts ?? 0,
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('POST /pillars/split:', err);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
