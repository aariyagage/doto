// POST /api/brainstorm/cluster
//
// Greedy soft-clustering of all of the user's inbox notes by cosine
// similarity (>=0.78). No model calls. Notes that join a cluster get
// status='clustered' + cluster_id; singletons stay 'inbox'.
//
// Run when the user clicks "Group similar notes" on the inbox page.
// Idempotent — re-running produces fresh cluster_ids each time.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { flagFor } from '@/lib/env';
import {
    clusterInboxNotes,
    openPipelineRun,
    closePipelineRun,
} from '@/lib/concepts';

export const dynamic = 'force-dynamic';

export async function POST() {
    try {
        const supabase = createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        if (!flagFor(user.id, 'brainstormInbox')) {
            return NextResponse.json({ error: 'feature_disabled', feature: 'BRAINSTORM_INBOX' }, { status: 503 });
        }

        const runHandle = await openPipelineRun({
            supabase,
            userId: user.id,
            kind: 'cluster',
        });

        try {
            const result = await clusterInboxNotes(supabase, user.id);
            const clusterCount = new Set(result.updated.map(u => u.cluster_id).filter(Boolean)).size;
            if (runHandle) {
                await closePipelineRun({
                    supabase, handle: runHandle, status: 'succeeded',
                    metadata: { notes_processed: result.updated.length, clusters: clusterCount },
                });
            }
            return NextResponse.json({
                notes_processed: result.updated.length,
                clusters: clusterCount,
            });
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (runHandle) {
                await closePipelineRun({
                    supabase, handle: runHandle, status: 'failed',
                    errorKind: 'unknown', metadata: { message: msg },
                });
            }
            throw err;
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('POST /brainstorm/cluster:', err);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
