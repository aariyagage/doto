import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const supabase = createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Fetch user data across tables
        const [
            { count: totalVideos },
            { count: totalIdeas },
            { count: totalPillars },
            { count: totalSavedIdeas },
            { data: pillarsData },
            { data: ideaPillarData },
            { data: videoPillarData },
            { data: recentVideos },
            { data: recentIdeas },
        ] = await Promise.all([
            supabase.from('videos').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
            supabase.from('content_ideas').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
            supabase.from('pillars').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
            supabase.from('content_ideas').select('*', { count: 'exact', head: true }).eq('user_id', user.id).eq('is_saved', true),
            supabase.from('pillars').select('id, name, color').eq('user_id', user.id),
            supabase.from('content_ideas').select('pillar_id').eq('user_id', user.id),
            supabase.from('video_pillars').select('video_id, pillar_id').in('video_id', (await supabase.from('videos').select('id').eq('user_id', user.id)).data?.map(v => v.id) || []),
            supabase.from('videos').select('id, file_name, created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(3),
            supabase.from('content_ideas').select('id, title, created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(3),
        ]);

        // Aggregate chart data
        const chartData = (pillarsData || []).map(pillar => {
            const ideasCount = (ideaPillarData || []).filter(i => i.pillar_id === pillar.id).length;
            const videosCount = (videoPillarData || []).filter(v => v.pillar_id === pillar.id).length;
            return {
                name: pillar.name,
                ideas: ideasCount,
                videos: videosCount,
                color: pillar.color || '#e2e8f0',
            };
        });

        // Combine and sort recent activity
        const combinedActivity = [
            ...(recentVideos || []).map(v => ({ type: 'video', id: v.id, title: v.file_name, date: v.created_at, icon: 'video' })),
            ...(recentIdeas || []).map(i => ({ type: 'idea', id: i.id, title: i.title, date: i.created_at, icon: 'lightbulb' }))
        ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 5);

        return NextResponse.json({
            metrics: {
                totalVideos: totalVideos || 0,
                totalIdeas: totalIdeas || 0,
                totalPillars: totalPillars || 0,
                totalSavedIdeas: totalSavedIdeas || 0
            },
            chartData,
            recentActivity: combinedActivity
        });

    } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error("GET /dashboard/stats Error:", errorMessage);
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}
