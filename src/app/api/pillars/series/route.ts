import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { embedText } from '@/lib/pillars/embeddings';
import { findClosestPillar, PILLAR_DEDUP_COSINE_THRESHOLD } from '@/lib/pillars/dedup';
import { getCombo } from '@/lib/colors';

export const dynamic = 'force-dynamic';

interface SeriesBody {
    name?: unknown;
    description?: unknown;
    video_ids?: unknown;
}

export async function POST(request: Request) {
    try {
        const supabase = createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const rl = rateLimit({ key: `pillars-series:${user.id}`, ...RATE_LIMITS.llmGeneration });
        if (!rl.ok) {
            return NextResponse.json(
                { error: `Rate limit exceeded. Try again in ${rl.retryAfterSeconds}s.` },
                { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
            );
        }

        let body: SeriesBody;
        try {
            body = await request.json();
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }

        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!name || name.length > 60) {
            return NextResponse.json({ error: 'Name is required (1-60 chars)' }, { status: 400 });
        }

        const description = typeof body.description === 'string' && body.description.trim()
            ? body.description.trim()
            : `Recurring series: ${name}.`;

        const videoIds: string[] = Array.isArray(body.video_ids)
            ? (body.video_ids as unknown[])
                .filter((v): v is string => typeof v === 'string' && v.length > 0)
            : [];

        // If video_ids were supplied, verify the caller actually owns those videos
        // before tagging them. RLS would catch a sneak attempt at insert time, but
        // failing here gives a cleaner error.
        if (videoIds.length > 0) {
            const { data: ownedVideos, error: ownErr } = await supabase
                .from('videos')
                .select('id')
                .eq('user_id', user.id)
                .in('id', videoIds);
            if (ownErr) throw new Error(`Failed to verify video ownership: ${ownErr.message}`);
            const ownedSet = new Set((ownedVideos || []).map(v => v.id as string));
            for (const id of videoIds) {
                if (!ownedSet.has(id)) {
                    return NextResponse.json({ error: 'One or more video_ids are not owned by you.' }, { status: 403 });
                }
            }
        }

        const embedding = await embedText(`${name}. ${description}`);

        // Dedup gate: if the user already has a pillar that's semantically very
        // close, promote that one to is_series instead of creating a duplicate.
        const closest = await findClosestPillar(supabase, user.id, embedding, PILLAR_DEDUP_COSINE_THRESHOLD);
        let pillarId: string;
        let promoted = false;
        let created = false;

        if (closest) {
            pillarId = closest.id;
            const { error: promoteErr } = await supabase
                .from('pillars')
                .update({ is_series: true, source_origin: 'user_series' })
                .eq('id', pillarId)
                .eq('user_id', user.id);
            if (promoteErr) throw new Error(`Failed to promote pillar to series: ${promoteErr.message}`);
            promoted = true;
        } else {
            const { count: existingCount } = await supabase
                .from('pillars')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', user.id);

            const colorCombo = getCombo(existingCount || 0);
            const { data: inserted, error: insertErr } = await supabase
                .from('pillars')
                .insert({
                    user_id: user.id,
                    name,
                    description,
                    embedding,
                    is_series: true,
                    source: 'ai_detected',
                    source_origin: 'user_series',
                    color: colorCombo.bg,
                })
                .select('id')
                .single();

            if (insertErr) {
                // Race or unique-violation fallback: fetch existing by lower(name).
                const { data: existing } = await supabase
                    .from('pillars')
                    .select('id')
                    .eq('user_id', user.id)
                    .ilike('name', name)
                    .maybeSingle();
                if (!existing) {
                    return NextResponse.json({ error: insertErr.message }, { status: 500 });
                }
                pillarId = existing.id as string;
                await supabase
                    .from('pillars')
                    .update({ is_series: true, source_origin: 'user_series' })
                    .eq('id', pillarId)
                    .eq('user_id', user.id);
                promoted = true;
            } else {
                pillarId = inserted!.id as string;
                created = true;
            }
        }

        // Tag the user-supplied videos (if any) into the new/promoted pillar.
        if (videoIds.length > 0) {
            const tagRows = videoIds.map(vid => ({ video_id: vid, pillar_id: pillarId }));
            const { error: tagErr } = await supabase.from('video_pillars').insert(tagRows);
            if (tagErr && !/duplicate|unique/i.test(tagErr.message)) {
                console.error('Series video_pillars insert failed (non-fatal):', tagErr.message);
            }
            await supabase
                .from('pillars')
                .update({ last_tagged_at: new Date().toISOString() })
                .eq('id', pillarId);
        }

        return NextResponse.json({ success: true, pillar_id: pillarId, created, promoted });
    } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error('POST /pillars/series Error:', errorMessage);
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}
