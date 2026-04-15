import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const BULK_DELETE_CONFIRMATION = 'DELETE_ALL_PILLARS';

export async function DELETE(request: Request) {
    try {
        const supabase = createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Require an explicit confirmation token so accidental/stray DELETE calls
        // (e.g. a misconfigured cache purge, a replayed request) cannot wipe all
        // of a user's pillars.
        let body: { confirm?: unknown } = {};
        try {
            body = await request.json();
        } catch {
            // empty body is an error for this destructive endpoint
        }

        if (body.confirm !== BULK_DELETE_CONFIRMATION) {
            return NextResponse.json(
                { error: `Bulk delete requires confirmation. Send { "confirm": "${BULK_DELETE_CONFIRMATION}" } in the body.` },
                { status: 400 }
            );
        }

        const { error } = await supabase
            .from('pillars')
            .delete()
            .eq('user_id', user.id);

        if (error) {
            console.error("DELETE /pillars Error:", error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error("DELETE /pillars Error:", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
