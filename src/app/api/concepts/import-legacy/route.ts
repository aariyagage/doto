// POST /api/concepts/import-legacy
//
// One-shot opt-in backfill: copy saved/used v2 content_ideas into concepts
// with source_content_idea_id set. Idempotent — won't duplicate-import
// (filters where source_content_idea_id is null). v1 rows are never
// imported (they lack idea_embedding).
//
// Status mapping:
//   is_used = true    -> 'used'
//   is_saved = true   -> 'saved'
// (rows that are neither aren't imported here)
//
// voice_adapted_text stays null; the stylist runs on next card open.
// concept_events 'created' rows are written for each imported concept.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { flagFor } from '@/lib/env';
import {
    recordConceptEventsBulk,
    openPipelineRun,
    closePipelineRun,
} from '@/lib/concepts';

export const dynamic = 'force-dynamic';

export async function POST() {
    try {
        const supabase = createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        if (!flagFor(user.id, 'conceptPipeline')) {
            return NextResponse.json({ error: 'feature_disabled', feature: 'CONCEPT_PIPELINE' }, { status: 503 });
        }

        const runHandle = await openPipelineRun({
            supabase,
            userId: user.id,
            kind: 'import_legacy',
        });

        // Pull v2 saved/used legacy ideas that haven't already been imported.
        const { data: legacyIdeas, error: legacyErr } = await supabase
            .from('content_ideas')
            .select('id, pillar_id, title, hook, structure, reasoning, angle, packaging_type, score, idea_embedding, is_saved, is_used, generated_at')
            .eq('user_id', user.id)
            .eq('source_version', 'v2')
            .or('is_saved.eq.true,is_used.eq.true');

        if (legacyErr) {
            console.error('import-legacy fetch failed:', JSON.stringify(legacyErr));
            if (runHandle) {
                await closePipelineRun({ supabase, handle: runHandle, status: 'failed', errorKind: 'unknown' });
            }
            return NextResponse.json({ error: legacyErr.message }, { status: 500 });
        }

        if (!legacyIdeas || legacyIdeas.length === 0) {
            if (runHandle) {
                await closePipelineRun({ supabase, handle: runHandle, status: 'succeeded', metadata: { imported: 0, reason: 'nothing to import' } });
            }
            return NextResponse.json({ imported: 0 });
        }

        // Filter out anything we've already imported.
        const ids = legacyIdeas.map(r => (r as { id: string }).id);
        const { data: alreadyImported } = await supabase
            .from('concepts')
            .select('source_content_idea_id')
            .eq('user_id', user.id)
            .in('source_content_idea_id', ids);

        const alreadyIds = new Set(
            (alreadyImported ?? [])
                .map(r => (r as { source_content_idea_id: string | null }).source_content_idea_id)
                .filter(Boolean) as string[],
        );

        const toImport = legacyIdeas.filter(r => !alreadyIds.has((r as { id: string }).id));
        if (toImport.length === 0) {
            if (runHandle) {
                await closePipelineRun({ supabase, handle: runHandle, status: 'succeeded', metadata: { imported: 0, reason: 'all already imported' } });
            }
            return NextResponse.json({ imported: 0 });
        }

        const rows = toImport.map(raw => {
            const r = raw as {
                id: string;
                pillar_id: string | null;
                title: string;
                hook: string | null;
                structure: string | null;
                reasoning: string | null;
                angle: string | null;
                packaging_type: string | null;
                score: unknown;
                idea_embedding: unknown;
                is_saved: boolean;
                is_used: boolean;
                generated_at: string | null;
            };
            const status: 'used' | 'saved' = r.is_used ? 'used' : 'saved';
            return {
                user_id: user.id,
                pillar_id: r.pillar_id,
                title: r.title,
                hook: r.hook,
                angle: r.angle,
                structure: r.structure ? { format: r.packaging_type, beats: [r.structure] } : null,
                ai_reason: r.reasoning,
                score: r.score,
                voice_adapted_title: null,
                voice_adapted_hook: null,
                voice_adapted_text: null,
                status,
                source_kind: 'autogen' as const,
                source_content_idea_id: r.id,
                concept_embedding: r.idea_embedding,
                pipeline_run_id: runHandle?.id ?? null,
                saved_at: status === 'saved' ? r.generated_at : null,
                used_at:  status === 'used'  ? r.generated_at : null,
            };
        });

        const { data: inserted, error: insertErr } = await supabase
            .from('concepts')
            .insert(rows)
            .select('id, status');

        if (insertErr) {
            console.error('import-legacy insert failed:', JSON.stringify(insertErr));
            if (runHandle) {
                await closePipelineRun({ supabase, handle: runHandle, status: 'failed', errorKind: 'unknown' });
            }
            return NextResponse.json({ error: insertErr.message }, { status: 500 });
        }

        await recordConceptEventsBulk(
            supabase,
            (inserted ?? []).map(row => {
                const r = row as { id: string; status: 'saved' | 'used' };
                return {
                    userId: user.id,
                    conceptId: r.id,
                    eventType: 'created' as const,
                    toStatus: r.status,
                    metadata: { imported_from: 'content_ideas' },
                };
            }),
        );

        if (runHandle) {
            await closePipelineRun({
                supabase, handle: runHandle, status: 'succeeded',
                metadata: { imported: inserted?.length ?? 0 },
            });
        }

        return NextResponse.json({ imported: inserted?.length ?? 0 });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('POST /concepts/import-legacy Error:', err);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
