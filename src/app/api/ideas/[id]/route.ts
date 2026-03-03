import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
    try {
        const supabase = createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const updates: any = {};

        if (body.hasOwnProperty('is_saved')) updates.is_saved = body.is_saved;
        if (body.hasOwnProperty('is_used')) updates.is_used = body.is_used;

        if (Object.keys(updates).length === 0) {
            return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
        }

        const { data, error } = await supabase
            .from('content_ideas')
            .update(updates)
            .eq('id', params.id)
            .eq('user_id', user.id)
            .select()
            .single();

        if (error) throw new Error(error.message);

        return NextResponse.json(data);
    } catch (err: any) {
        console.error("PATCH /ideas/[id] Error:", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
    try {
        const supabase = createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { error } = await supabase
            .from('content_ideas')
            .delete()
            .eq('id', params.id)
            .eq('user_id', user.id);

        if (error) throw new Error(error.message);

        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error("DELETE /ideas/[id] Error:", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
