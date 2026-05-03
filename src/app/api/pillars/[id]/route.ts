import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getIndustryById } from '@/lib/trends/industries';

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
    try {
        const supabase = createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;

        const { error } = await supabase
            .from('pillars')
            .delete()
            .match({ id: id, user_id: user.id });

        if (error) {
            console.error("DELETE /pillars/[id] Error:", error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error("DELETE /pillars/[id] Error:", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
    try {
        const supabase = createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const body = await request.json();
        const { name, is_series, tiktok_industry_id, tiktok_industry_secondary } = body as {
            name?: unknown;
            is_series?: unknown;
            tiktok_industry_id?: unknown;
            tiktok_industry_secondary?: unknown;
        };

        const updates: Record<string, unknown> = {};
        if (typeof name === 'string') {
            const trimmed = name.trim();
            if (!trimmed) return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 });
            updates.name = trimmed;
        }
        if (typeof is_series === 'boolean') {
            updates.is_series = is_series;
        }
        // Manual TikTok industry override. Setting tiktok_industry_id locks the
        // mapping so the lazy auto-mapper at /api/trends won't overwrite it.
        // Pass null to clear the override and re-enable auto-mapping.
        if (tiktok_industry_id !== undefined) {
            if (tiktok_industry_id === null) {
                updates.tiktok_industry_id = null;
                updates.tiktok_industry_secondary = null;
                updates.tiktok_industry_locked = false;
            } else if (typeof tiktok_industry_id === 'string' && getIndustryById(tiktok_industry_id)) {
                updates.tiktok_industry_id = tiktok_industry_id;
                updates.tiktok_industry_locked = true;
                if (tiktok_industry_secondary === null || typeof tiktok_industry_secondary === 'string') {
                    updates.tiktok_industry_secondary = tiktok_industry_secondary;
                }
            } else {
                return NextResponse.json({ error: 'Unknown tiktok_industry_id' }, { status: 400 });
            }
        }
        if (Object.keys(updates).length === 0) {
            return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
        }

        const { error } = await supabase
            .from('pillars')
            .update(updates)
            .match({ id: id, user_id: user.id });

        if (error) {
            console.error("PATCH /pillars/[id] Error:", error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error("PATCH /pillars/[id] Error:", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
