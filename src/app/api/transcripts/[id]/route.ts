import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const supabase = await createClient();
    const { id } = await params;

    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const type = searchParams.get('type') || 'hard';

        if (type === 'soft') {
            const { error } = await supabase
                .from('transcripts')
                .update({ is_hidden: true })
                .eq('id', id)
                .eq('user_id', user.id);

            if (error) {
                console.error('Soft delete transcript error:', error);
                return NextResponse.json({ error: error.message }, { status: 500 });
            }
        } else {
            // Fetch video_id — scoped to the requesting user — before cascading.
            // Without the user_id filter, user A could trigger a cascade using
            // user B's transcript id (if RLS were ever misconfigured).
            const { data: transcript } = await supabase
                .from('transcripts')
                .select('video_id')
                .eq('id', id)
                .eq('user_id', user.id)
                .single();

            if (!transcript) {
                // Either not found or not owned by this user — do not leak which.
                return NextResponse.json({ error: 'Not found' }, { status: 404 });
            }

            // Delete the transcript
            const { error } = await supabase
                .from('transcripts')
                .delete()
                .eq('id', id)
                .eq('user_id', user.id);

            if (error) {
                console.error('Hard delete transcript error:', error);
                return NextResponse.json({ error: error.message }, { status: 500 });
            }

            // Cleanup video + video_pillars. Video delete is user-scoped.
            // video_pillars has no user_id column, but we just verified the video
            // is owned by the requesting user, so deleting by video_id is safe.
            if (transcript.video_id) {
                await supabase.from('videos').delete().eq('id', transcript.video_id).eq('user_id', user.id);
                await supabase.from('video_pillars').delete().eq('video_id', transcript.video_id);
            }
        }

        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error('Unexpected error deleting transcript:', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
