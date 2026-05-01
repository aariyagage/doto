import type Groq from 'groq-sdk';
import { generateIdeasForUser } from '@/lib/ideas/generate';
import { generateIdeasV2ForUser } from '@/lib/ideas/v2';
import type { SupabaseServer } from './types';

const TARGET_UNUSED_PER_PILLAR = 3;

function ideaEngineV2Enabled(): boolean {
    return process.env.IDEA_ENGINE_V2 === 'true';
}

interface TopUpArgs {
    supabase: SupabaseServer;
    groq: Groq; // unused for now — kept for parity with other pillar lib signatures
    userId: string;
    pillarIds: string[]; // pillars the just-uploaded video was tagged to
}

// After a video is tagged, top each pillar up to TARGET_UNUSED_PER_PILLAR unused
// ideas. Skips pillars that already have enough. Calls the per-pillar idea
// generator directly (no HTTP round-trip, no rate-limit collision with the
// user's manual Generate button). Non-fatal: any failure logs and returns 0.
export async function topUpIdeasForPillars(args: TopUpArgs): Promise<{ generated: number; pillarsToppedUp: number }> {
    const { supabase, userId, pillarIds } = args;
    if (pillarIds.length === 0) return { generated: 0, pillarsToppedUp: 0 };

    // Count existing unused ideas per pillar in one query.
    const { data: existingIdeas, error: ideasErr } = await supabase
        .from('content_ideas')
        .select('pillar_id, is_used')
        .eq('user_id', userId)
        .eq('is_used', false)
        .in('pillar_id', pillarIds);

    if (ideasErr) {
        console.error('topUpIdeasForPillars count failed (non-fatal):', ideasErr.message);
        return { generated: 0, pillarsToppedUp: 0 };
    }

    const counts = new Map<string, number>();
    for (const id of pillarIds) counts.set(id, 0);
    for (const row of existingIdeas || []) {
        const pid = row.pillar_id as string | null;
        if (!pid) continue;
        counts.set(pid, (counts.get(pid) || 0) + 1);
    }

    const needsTopUp = pillarIds.filter(id => (counts.get(id) || 0) < TARGET_UNUSED_PER_PILLAR);
    if (needsTopUp.length === 0) return { generated: 0, pillarsToppedUp: 0 };

    try {
        // Mirror the manual-generate route's flag behavior so the auto-top-up
        // produces ideas under the same engine the user sees when they hit
        // "Generate." Without this, IDEA_ENGINE_V2=true would still send v1
        // ideas straight after upload, undermining every v2 prompt fix.
        const generator = ideaEngineV2Enabled() ? generateIdeasV2ForUser : generateIdeasForUser;
        const result = await generator({
            supabase,
            userId,
            pillarIds: needsTopUp,
            perPillarCount: TARGET_UNUSED_PER_PILLAR,
        });
        if (result.error) {
            console.error('topUpIdeasForPillars: generator returned error (non-fatal):', result.error);
            return { generated: 0, pillarsToppedUp: needsTopUp.length };
        }
        return { generated: result.inserted.length, pillarsToppedUp: needsTopUp.length };
    } catch (err) {
        console.error('topUpIdeasForPillars: generator threw (non-fatal):', err);
        return { generated: 0, pillarsToppedUp: needsTopUp.length };
    }
}
