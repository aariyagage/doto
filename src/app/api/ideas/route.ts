import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    try {
        const supabase = createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { data: ideas, error } = await supabase
            .from('content_ideas')
            .select(`
                *,
                pillars ( id, name, color )
            `)
            .eq('user_id', user.id)
            .order('generated_at', { ascending: false });

        if (error) {
            console.error("GET /ideas Error:", error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json(ideas || []);
    } catch (err: any) {
        console.error("GET /ideas Error:", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    try {
        const supabase = createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { error } = await supabase
            .from('content_ideas')
            .delete()
            .eq('user_id', user.id);

        if (error) {
            console.error("DELETE /ideas Error:", error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error("DELETE /ideas Error:", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
