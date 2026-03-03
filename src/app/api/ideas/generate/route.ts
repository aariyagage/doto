import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import Groq from 'groq-sdk';

export async function POST(request: Request) {
    try {
        const supabase = createClient();

        // 1. Get the authenticated user
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // 2. Read optional body params
        let body: any = {};
        try {
            body = await request.json();
        } catch (e) {
            // body is optional
        }

        const pillar_ids = Array.isArray(body.pillar_ids) ? body.pillar_ids : [];
        const count = Math.min(Number(body.count) || 5, 10);

        // 3. Fetch the user's voice_profile
        const { data: voiceProfile, error: vpError } = await supabase
            .from('voice_profile')
            .select('*')
            .eq('user_id', user.id)
            .single();

        if (vpError || !voiceProfile) {
            return NextResponse.json({ error: "No voice profile found. Upload videos first." }, { status: 400 });
        }

        // 4. Fetch the user's pillars
        let pillarsQuery = supabase.from('pillars').select('id, name').eq('user_id', user.id);
        if (pillar_ids.length > 0) {
            pillarsQuery = pillarsQuery.in('id', pillar_ids);
        }

        const { data: pillars, error: pillarsError } = await pillarsQuery;
        if (pillarsError) throw new Error(`Failed to fetch pillars: ${pillarsError.message}`);

        const pillarNames = pillars?.map(p => p.name) || [];

        // 5. Fetch transcripts
        let transcriptsData: any[] = [];
        if (pillar_ids.length > 0) {
            const { data: vpData, error: vpErr } = await supabase
                .from('video_pillars')
                .select('video_id')
                .in('pillar_id', pillar_ids);

            if (vpErr) throw new Error(`Failed to fetch video_pillars: ${vpErr.message}`);

            const videoIds = vpData?.map(vp => vp.video_id) || [];

            if (videoIds.length > 0) {
                const { data: tData, error: tErr } = await supabase
                    .from('transcripts')
                    .select('raw_text, word_count')
                    .eq('user_id', user.id)
                    .in('video_id', videoIds)
                    .order('word_count', { ascending: false })
                    .limit(10);
                if (tErr) throw new Error(`Failed to fetch transcripts: ${tErr.message}`);
                transcriptsData = tData || [];
            }
        } else {
            const { data: tData, error: tErr } = await supabase
                .from('transcripts')
                .select('raw_text, word_count')
                .eq('user_id', user.id)
                .order('word_count', { ascending: false })
                .limit(10);
            if (tErr) throw new Error(`Failed to fetch transcripts: ${tErr.message}`);
            transcriptsData = tData || [];
        }

        // 6. Pick top 3 by word_count, combine, truncate
        const top3Transcripts = transcriptsData.slice(0, 3);
        let combinedTranscripts = top3Transcripts.map(t => t.raw_text).join("\n---\n");
        if (combinedTranscripts.length > 4000) {
            combinedTranscripts = combinedTranscripts.substring(0, 4000);
        }

        // 7. Call Groq llama-3.3-70b-versatile
        const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
        const systemMessage = "You are a creative content strategist who has deeply studied this specific creator's voice. You never produce generic ideas. Every idea must sound like it could only come from this creator using their exact language, stories, and approach. You post on Instagram Reels so hooks must be under 7 words and instantly grab attention. No self-help clichés. No advice that applies to every creator.";

        const userMessage = `Creator voice profile:
Niche: ${voiceProfile.niche_summary}
Tone: ${(voiceProfile.tone_descriptors || []).join(", ")}
Style: ${voiceProfile.content_style}
Phrases they actually say: ${(voiceProfile.recurring_phrases || []).join(", ")}

Sample transcripts from their content:
${combinedTranscripts}

Generate ${count} Instagram Reel ideas for these content pillars: ${pillarNames.join(", ")}.

Rules:
- Generate BRAND NEW concepts or analogies that fit the chosen Pillar.
- DO NOT just rehash or reuse the specific stories, analogies, or examples from the transcripts. The transcripts are ONLY provided so you can mimic the creator's tone, vocabulary, and speaking style, not to restrict the subject matter.
- Hooks must be uniquely tailored to this creator's exact voice, highly creative, and undeniably interesting.
- Hooks must be under 7 words
- The hook must be a complete sentence the creator would literally say out loud as the first words of their Reel — not a description, not a summary, an actual spoken line
- The hook must create overwhelming curiosity or tension in under 7 words — someone scrolling must want to stop and watch
- Titles must be "real long titles" that are highly descriptive and engaging.
- Provide a detailed "description" of the video concept that explains how the creator would uniquely execute it.

Return ONLY a JSON array. No markdown. No explanation.
Each object must follow this exact format:

[
    "title": "Why we almost killed our startup in month two (and the brutal lesson we learned)",
    "hook": "We almost killed it ourselves",
    "structure": "The setup → The surprising realization → The pivot → The takeaway",
    "pillar": "Mistakes to avoid as a founder",
    "description": "A deep dive into the feature-creep phase where the creator almost derailed their own vision. The video should lean into their 'story-driven' style and use their signature phrase 'but here's the reality' before delivering the anti-advice conclusion."
  }
]`;

        const completion = await groq.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: [
                { role: "system", content: systemMessage },
                { role: "user", content: userMessage }
            ],
            temperature: 0.7
        });

        // 8. Parse the response
        let content = completion.choices[0]?.message?.content || "[]";

        // Strip markdown
        if (content.startsWith("```json")) content = content.replace(/^```json\n/, "").replace(/\n```$/, "");
        else if (content.startsWith("```")) content = content.replace(/^```\n/, "").replace(/\n```$/, "");

        let ideasData;
        try {
            ideasData = JSON.parse(content.trim());
            if (!Array.isArray(ideasData)) {
                if (ideasData.ideas && Array.isArray(ideasData.ideas)) {
                    ideasData = ideasData.ideas;
                } else {
                    ideasData = [ideasData];
                }
            }
        } catch (parseError) {
            return NextResponse.json({ error: "Failed to parse JSON response", raw: content }, { status: 500 });
        }

        // 9. Insert into content_ideas
        const insertedIdeas = [];

        for (const idea of ideasData) {
            // Find pillar_id mapping
            const cleanIdeaPillar = idea.pillar?.trim().toLowerCase() || "";
            const matchedPillar = pillars?.find(p => p.name.trim().toLowerCase() === cleanIdeaPillar);
            const pillar_id = matchedPillar ? matchedPillar.id : null;

            const { data: inserted, error: insertError } = await supabase
                .from('content_ideas')
                .insert({
                    user_id: user.id,
                    title: idea.title,
                    hook: idea.hook,
                    structure: idea.structure,
                    reasoning: idea.description || idea.reasoning, // Map 'description' to the existing 'reasoning' column
                    pillar_id: pillar_id,
                    is_saved: false,
                    is_used: false
                })
                .select()
                .single();

            if (insertError) {
                console.error("Failed to insert idea:", insertError);
            } else if (inserted) {
                insertedIdeas.push(inserted);
            }
        }

        // 10. Return the inserted ideas
        return NextResponse.json(insertedIdeas);

    } catch (err: any) {
        console.error("Idea generator error:", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
