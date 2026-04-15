import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireEnv } from '@/lib/env';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import Groq from 'groq-sdk';

const groq = new Groq({
    apiKey: requireEnv('GROQ_API_KEY')
});

export async function POST() {
    try {
        const supabase = createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const rl = rateLimit({ key: `pillars-generate:${user.id}`, ...RATE_LIMITS.llmGeneration });
        if (!rl.ok) {
            return NextResponse.json(
                { error: `Rate limit exceeded. Try again in ${rl.retryAfterSeconds}s.` },
                { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
            );
        }

        console.log(`Manual regenerating voice profile/pillars for user ${user.id}...`);

        // Fetch ALL valid transcripts for this user.
        // Scoping by user_id is required in addition to RLS — defense in depth, and
        // also ensures profile generation is not polluted by other users' content.
        const { data: transcriptsData, error: transcriptsError } = await supabase
            .from('transcripts')
            .select('raw_text')
            .eq('user_id', user.id);

        if (transcriptsError) throw new Error(`Failed to fetch user transcripts: ${transcriptsError.message}`);

        if (!transcriptsData || transcriptsData.length === 0) {
            return NextResponse.json({ error: 'No transcripts found to generate from.' }, { status: 400 });
        }

        let combinedText = transcriptsData.map(t => t.raw_text).join("\n\n---\n\n");
        if (combinedText.length > 6000) {
            combinedText = combinedText.substring(0, 6000);
        }

        const profileCompletion = await groq.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: [
                {
                    role: "system",
                    content: "You analyze a content creator's video transcripts to understand their unique voice, worldview, and content themes. You are specific and personal. You never use generic descriptions. Everything you return must reflect THIS creator's actual beliefs, words, topics, and style — not a generic creator. Return only valid JSON, no markdown, no explanation."
                },
                {
                    role: "user",
                    content: `Here are transcripts from a content creator's videos:\n\n${combinedText}\n\nAnalyze them and return ONLY this JSON object:\n{\n  "pillars": [\n    {\n      "name": string (broad overarching content buckets, e.g. 'Founder Diaries', 'Mindset & Growth', 'Tech Tutorials' -- NEVER granular specific video topics. Keep them to 1-3 words),\n      "description": string (one sentence)\n    }\n  ] (2-4 pillars maximum),\n  "tone_descriptors": string[] (3-5 single adjectives that describe exactly how this person talks),\n  "recurring_phrases": string[] (up to 6 short phrases this creator actually repeats across their videos),\n  "content_style": string (exactly one of: story-driven, listicle, how-to, conversational, educational),\n  "niche_summary": string (1-2 sentences on what this creator specifically makes and exactly who their audience is — be specific, not generic),\n  "signature_argument": string (the contrarian belief or core thesis this creator returns to most often. One sentence. Must be specific enough that a different creator would disagree with it. Bad: 'Hard work matters.' Good: 'Most people optimize the wrong thing first — pricing, not product.'),\n  "enemy_or_foil": string[] (2-4 things, ideologies, or types of people this creator pushes back against. Examples: 'hustle culture', 'productivity gurus', 'corporate consultants who never built anything'),\n  "would_never_say": string[] (3 specific sentences this creator would never say out loud, given their worldview. Make these concrete sentences, not categories. Example: 'Just believe in yourself!')\n}`
                }
            ],
            temperature: 0.1,
            response_format: { type: "json_object" }
        });

        let content = profileCompletion.choices[0]?.message?.content || "";
        if (content.startsWith("```json")) {
            content = content.replace(/^```json\n/, "").replace(/\n```$/, "");
        } else if (content.startsWith("```")) {
            content = content.replace(/^```\n/, "").replace(/\n```$/, "");
        }

        const profileData = JSON.parse(content);
        if (!profileData.pillars || !profileData.tone_descriptors || !profileData.recurring_phrases || !profileData.content_style || !profileData.niche_summary) {
            throw new Error("Missing required keys in Groq JSON response.");
        }

        // T2 enrichment fields — non-fatal if missing
        profileData.signature_argument = profileData.signature_argument || null;
        profileData.enemy_or_foil = Array.isArray(profileData.enemy_or_foil) ? profileData.enemy_or_foil : [];
        profileData.would_never_say = Array.isArray(profileData.would_never_say) ? profileData.would_never_say : [];

        const P_COLORS = ['#E8F4B8', '#FFD6E8', '#C8E6FF', '#FFE8C8', '#E0D4FF', '#D4F4E8', '#FFF3D4', '#F4D4E8'];

        // Get existing pillars to avoid exact name dupes
        const { data: existingPillars } = await supabase
            .from('pillars')
            .select('name')
            .eq('user_id', user.id);
        const existingNames = new Set((existingPillars || []).map(p => p.name.toLowerCase()));

        // Insert new pillars
        let currentColorIdx = 0;
        let insertedCount = 0;
        for (const p of profileData.pillars) {
            if (!existingNames.has(p.name.toLowerCase())) {
                await supabase.from('pillars').insert({
                    user_id: user.id,
                    name: p.name,
                    source: 'ai_detected',
                    color: P_COLORS[currentColorIdx % P_COLORS.length]
                });
                currentColorIdx++;
                insertedCount++;
                existingNames.add(p.name.toLowerCase());
            }
        }

        // Upsert Voice Profile
        const voiceProfileRecord = {
            user_id: user.id,
            tone_descriptors: profileData.tone_descriptors,
            recurring_phrases: profileData.recurring_phrases,
            content_style: profileData.content_style,
            niche_summary: profileData.niche_summary,
            signature_argument: profileData.signature_argument,
            enemy_or_foil: profileData.enemy_or_foil,
            would_never_say: profileData.would_never_say,
            last_updated: new Date().toISOString()
        };

        await supabase.from('voice_profile').upsert(voiceProfileRecord, { onConflict: 'user_id' });

        return NextResponse.json({ success: true, count: insertedCount });
    } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error("POST /pillars/generate Error:", errorMessage);
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}
