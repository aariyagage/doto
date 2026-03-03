import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const supabase = await createClient();

    const { data: rawPillars } = await supabase.from('pillars').select('*');
    const { data: rawIdeas } = await supabase.from('content_ideas').select('id, title, hook, pillar_id').order('generated_at', { ascending: false }).limit(5);
    const { data: rawVP } = await supabase.from('video_pillars').select('*');
    const { data: rawTranscripts } = await supabase.from('transcripts').select('id, video_id, created_at').order('created_at', { ascending: false }).limit(5);

    return NextResponse.json({
        pillars: rawPillars,
        ideas: rawIdeas,
        video_pillars: rawVP,
        transcripts: rawTranscripts
    });
}
