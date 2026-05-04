// concept_events writer.
//
// concept_events is APPEND-ONLY. The migration deliberately doesn't add
// UPDATE/DELETE policies. This module only exposes insert helpers.

import type { SupabaseServer } from '@/lib/pillars/types';
import type { ConceptEventType, ConceptStatus } from './types';

export interface RecordEventArgs {
    supabase: SupabaseServer;
    userId: string;
    conceptId: string;
    eventType: ConceptEventType;
    fromStatus?: ConceptStatus | null;
    toStatus?: ConceptStatus | null;
    metadata?: Record<string, unknown>;
}

export async function recordConceptEvent(args: RecordEventArgs): Promise<void> {
    const { supabase, userId, conceptId, eventType, fromStatus, toStatus, metadata } = args;

    const { error } = await supabase.from('concept_events').insert({
        user_id: userId,
        concept_id: conceptId,
        event_type: eventType,
        from_status: fromStatus ?? null,
        to_status: toStatus ?? null,
        metadata: metadata ?? null,
    });

    if (error) {
        // Non-fatal: events are observability, not transactionally required.
        // Log and move on so the user-facing mutation still succeeds.
        console.error(
            `concept_events insert failed concept=${conceptId} event=${eventType}:`,
            JSON.stringify(error),
        );
    }
}

// Recording many events at once (e.g. a generation run inserts a 'created'
// event per concept). One round-trip instead of N.
export async function recordConceptEventsBulk(
    supabase: SupabaseServer,
    rows: Array<Omit<RecordEventArgs, 'supabase'>>,
): Promise<void> {
    if (rows.length === 0) return;

    const payload = rows.map(r => ({
        user_id: r.userId,
        concept_id: r.conceptId,
        event_type: r.eventType,
        from_status: r.fromStatus ?? null,
        to_status: r.toStatus ?? null,
        metadata: r.metadata ?? null,
    }));

    const { error } = await supabase.from('concept_events').insert(payload);
    if (error) {
        console.error(`concept_events bulk insert failed (${rows.length} rows):`, JSON.stringify(error));
    }
}
