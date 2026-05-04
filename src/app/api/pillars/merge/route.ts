// POST /api/pillars/merge
//
// Move all concepts + video_pillars + legacy content_ideas from a source
// pillar into a target pillar, then delete the source. The video_pillars
// junction has a unique (video_id, pillar_id) constraint, so we
// pre-delete rows that would collide before the bulk update.
//
// NOT a database transaction. If the API process dies mid-merge, the
// data ends up in a half-merged state. Concept merges are user-initiated
// and rare; recovery is manual via Supabase Studio. If this becomes a
// problem later, replace with a SECURITY INVOKER Postgres function and
// call via RPC.
//
// Gated by NEXT_PUBLIC_WORKSPACE_V1 (which requires CONCEPT_PIPELINE).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { flagFor } from '@/lib/env';

export const dynamic = 'force-dynamic';

interface Body {
    from_id: string;
    into_id: string;
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

        if (!body.from_id || !body.into_id) {
            return NextResponse.json({ error: 'from_id and into_id are required' }, { status: 400 });
        }
        if (body.from_id === body.into_id) {
            return NextResponse.json({ error: 'from_id and into_id must differ' }, { status: 400 });
        }

        // Verify both pillars belong to the user (RLS would catch it but
        // the explicit check returns a friendlier 404).
        const { data: pillars, error: pillarErr } = await supabase
            .from('pillars')
            .select('id, name')
            .eq('user_id', user.id)
            .in('id', [body.from_id, body.into_id]);

        if (pillarErr || !pillars || pillars.length !== 2) {
            return NextResponse.json({ error: 'one or both pillars not found' }, { status: 404 });
        }

        // 1. Resolve video_pillars collisions. If both source and target
        //    already point at the same video, deleting the source row
        //    avoids a unique-constraint failure on the bulk update below.
        const { data: targetVideos } = await supabase
            .from('video_pillars')
            .select('video_id')
            .eq('pillar_id', body.into_id);

        const targetVideoIds = (targetVideos ?? []).map(r => (r as { video_id: string }).video_id);
        let videoCollisions = 0;
        if (targetVideoIds.length > 0) {
            const { error: dedupErr, count } = await supabase
                .from('video_pillars')
                .delete({ count: 'exact' })
                .eq('pillar_id', body.from_id)
                .in('video_id', targetVideoIds);
            if (dedupErr) {
                console.error('merge dedup video_pillars failed:', JSON.stringify(dedupErr));
                return NextResponse.json({ error: dedupErr.message, stage: 'dedup_video_pillars' }, { status: 500 });
            }
            videoCollisions = count ?? 0;
        }

        // 2. Re-point remaining video_pillars rows.
        const { count: movedVideos, error: vpErr } = await supabase
            .from('video_pillars')
            .update({ pillar_id: body.into_id }, { count: 'exact' })
            .eq('pillar_id', body.from_id);
        if (vpErr) {
            console.error('merge video_pillars update failed:', JSON.stringify(vpErr));
            return NextResponse.json({ error: vpErr.message, stage: 'move_video_pillars' }, { status: 500 });
        }

        // 3. Re-point concepts.
        const { count: movedConcepts, error: cErr } = await supabase
            .from('concepts')
            .update({ pillar_id: body.into_id }, { count: 'exact' })
            .eq('user_id', user.id)
            .eq('pillar_id', body.from_id);
        if (cErr) {
            console.error('merge concepts update failed:', JSON.stringify(cErr));
            return NextResponse.json({ error: cErr.message, stage: 'move_concepts' }, { status: 500 });
        }

        // 4. Re-point legacy content_ideas. Even after vNext fully takes
        //    over, /ideas keeps writing to this table; merging pillars
        //    must update both surfaces.
        const { count: movedLegacyIdeas, error: iErr } = await supabase
            .from('content_ideas')
            .update({ pillar_id: body.into_id }, { count: 'exact' })
            .eq('user_id', user.id)
            .eq('pillar_id', body.from_id);
        if (iErr) {
            console.error('merge content_ideas update failed:', JSON.stringify(iErr));
            return NextResponse.json({ error: iErr.message, stage: 'move_content_ideas' }, { status: 500 });
        }

        // 5. Re-point brainstorm_notes that target the source pillar.
        const { count: movedNotes, error: nErr } = await supabase
            .from('brainstorm_notes')
            .update({ pillar_id: body.into_id }, { count: 'exact' })
            .eq('user_id', user.id)
            .eq('pillar_id', body.from_id);
        if (nErr) {
            console.error('merge brainstorm_notes update failed:', JSON.stringify(nErr));
            return NextResponse.json({ error: nErr.message, stage: 'move_brainstorm_notes' }, { status: 500 });
        }

        // 6. Delete the now-empty source pillar.
        const { error: delErr } = await supabase
            .from('pillars')
            .delete()
            .eq('user_id', user.id)
            .eq('id', body.from_id);
        if (delErr) {
            console.error('merge pillar delete failed:', JSON.stringify(delErr));
            return NextResponse.json({ error: delErr.message, stage: 'delete_source_pillar' }, { status: 500 });
        }

        return NextResponse.json({
            moved_concepts: movedConcepts ?? 0,
            moved_videos: movedVideos ?? 0,
            moved_legacy_ideas: movedLegacyIdeas ?? 0,
            moved_brainstorm_notes: movedNotes ?? 0,
            video_collisions_dropped: videoCollisions,
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('POST /pillars/merge:', err);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
