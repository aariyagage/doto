import { NextResponse } from 'next/server';
import { writeFile, unlink, stat, readdir } from 'fs/promises';
import { extname, join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { createClient } from '@/lib/supabase/server';
import { requireEnv } from '@/lib/env';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import os from 'os';
import fs from 'fs';
import Groq from 'groq-sdk';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const ALLOWED_VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.m4v', '.mkv', '.avi']);
const ALLOWED_VIDEO_MIME_PREFIXES = ['video/'];
const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024; // 500MB — keep in sync with client.

function safeVideoExtension(fileName: string): string {
    const ext = extname(fileName).toLowerCase();
    return ALLOWED_VIDEO_EXTENSIONS.has(ext) ? ext : '.mp4';
}

function isAcceptedVideoFile(file: File): boolean {
    const ext = extname(file.name).toLowerCase();
    if (!ALLOWED_VIDEO_EXTENSIONS.has(ext)) return false;
    // file.type is client-controlled, so treat it as a hint, not the source of truth.
    // We still reject blatantly non-video MIME types.
    return !file.type || ALLOWED_VIDEO_MIME_PREFIXES.some((p) => file.type.startsWith(p));
}

// Route-level limits. maxDuration handles long-running pipeline on Vercel;
// dynamic is required because we stream SSE.
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request) {
    const groq = new Groq({
        apiKey: requireEnv('GROQ_API_KEY'),
    });

    try {
        console.log("=== NEW API UPLOAD REQUEST ===");
        const formData = await request.formData();
        const file = formData.get('file') as File | null;

        if (!file) {
            console.error("No file found in formData");
            return NextResponse.json({ error: 'No file received' }, { status: 400 });
        }

        if (file.size > MAX_FILE_SIZE_BYTES) {
            return NextResponse.json(
                { error: `File exceeds the maximum size of ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB` },
                { status: 413 }
            );
        }

        if (!isAcceptedVideoFile(file)) {
            return NextResponse.json(
                { error: 'Unsupported file type. Allowed extensions: .mp4 .mov .webm .m4v .mkv .avi' },
                { status: 415 }
            );
        }

        console.log("Initializing Supabase client...");
        const supabase = createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            console.error("Supabase Auth Error:", authError?.message || "No user found");
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const rl = rateLimit({ key: `video-process:${user.id}`, ...RATE_LIMITS.videoProcess });
        if (!rl.ok) {
            return NextResponse.json(
                { error: `Rate limit exceeded. Try again in ${rl.retryAfterSeconds}s.` },
                { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
            );
        }

        const encoder = new TextEncoder();

        const stream = new ReadableStream({
            async start(controller) {
                const sendEvent = (data: unknown) => {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
                };

                const tempFilesToCleanup: string[] = [];

                try {
                    // 1. Uploading
                    sendEvent({ step: 'uploading' });
                    const bytes = await file.arrayBuffer();
                    const buffer = Buffer.from(bytes);

                    const tempDir = os.tmpdir();
                    const videoId = uuidv4();

                    const safeExtension = safeVideoExtension(file.name);
                    const videoPath = join(tempDir, `${videoId}-video${safeExtension}`);
                    tempFilesToCleanup.push(videoPath);
                    await writeFile(videoPath, buffer);
                    console.log(`Saved temp video to ${videoPath}`);

                    // Create basic video record with strict error checking
                    const { error: insertError } = await supabase.from('videos').insert({
                        id: videoId,
                        user_id: user.id,
                        file_name: file.name,
                        status: 'uploading'
                    });
                    if (insertError) throw new Error(`DB Insert Error: ${insertError.message}`);

                    // 2. Extract Audio
                    sendEvent({ step: 'extract_audio' });
                    const { error: updateError1 } = await supabase.from('videos').update({ status: 'extract_audio' }).eq('id', videoId);
                    if (updateError1) throw new Error(`DB Update Error: ${updateError1.message}`);

                    const audioPath = join(tempDir, `${videoId}-audio.mp3`);
                    tempFilesToCleanup.push(audioPath);

                    await new Promise((resolve, reject) => {
                        ffmpeg(videoPath)
                            .noVideo()
                            .audioCodec('libmp3lame')
                            .audioChannels(1)
                            .audioFrequency(16000)
                            .on('end', resolve)
                            .on('error', reject)
                            .save(audioPath);
                    });
                    console.log(`Successfully extracted audio to ${audioPath}`);

                    // 3. Audio Chunking (if > 24MB to stay safely under Groq 25MB limits)
                    const audioStats = await stat(audioPath);
                    const MAX_SIZE = 24 * 1024 * 1024;

                    let audioChunksToProcess: string[] = [];

                    if (audioStats.size > MAX_SIZE) {
                        sendEvent({ step: 'chunk_audio' });
                        const { error: updateErrorChunk } = await supabase.from('videos').update({ status: 'chunk_audio' }).eq('id', videoId);
                        if (updateErrorChunk) throw new Error(`DB Update Error: ${updateErrorChunk.message}`);

                        // Split directly into ~10 minute chunks using ffmpeg segment multiplexer
                        const chunkPattern = join(tempDir, `${videoId}-chunk-%03d.mp3`);
                        await new Promise((resolve, reject) => {
                            ffmpeg(audioPath)
                                .outputOptions([
                                    '-f segment',
                                    '-segment_time 600',
                                    '-c copy'
                                ])
                                .on('end', resolve)
                                .on('error', reject)
                                .save(chunkPattern);
                        });

                        const files = await readdir(tempDir);
                        const chunks = files.filter(f => f.startsWith(`${videoId}-chunk-`) && f.endsWith('.mp3')).sort();
                        chunks.forEach(c => {
                            const chunkPath = join(tempDir, c);
                            audioChunksToProcess.push(chunkPath);
                            tempFilesToCleanup.push(chunkPath);
                        });
                        console.log(`Audio chunked into ${chunks.length} segments.`);
                    } else {
                        audioChunksToProcess = [audioPath];
                    }

                    // 4. Transcribe
                    sendEvent({ step: 'transcribe' });
                    const { error: updateError2 } = await supabase.from('videos').update({ status: 'transcribing' }).eq('id', videoId);
                    if (updateError2) throw new Error(`DB Update Error: ${updateError2.message}`);

                    let fullTranscriptText = "";

                    for (let i = 0; i < audioChunksToProcess.length; i++) {
                        const chunkPath = audioChunksToProcess[i];
                        console.log(`Transcribing chunk ${i + 1}/${audioChunksToProcess.length}...`);
                        const transcription = await groq.audio.transcriptions.create({
                            file: fs.createReadStream(chunkPath),
                            model: "whisper-large-v3",
                            response_format: "json"
                        });

                        const chunkText = transcription?.text ? transcription.text.trim() : "";
                        fullTranscriptText += chunkText + " ";
                    }

                    fullTranscriptText = fullTranscriptText.trim();
                    const wordCount = fullTranscriptText.split(/\s+/).filter((w: string) => w.length > 0).length;

                    if (!fullTranscriptText || wordCount < 5) {
                        const { error: updateErrorErr } = await supabase.from('videos').update({ status: 'error' }).eq('id', videoId);
                        if (updateErrorErr) console.error(`DB Error:`, updateErrorErr);
                        throw new Error("No speech detected or transcript too short.");
                    }
                    console.log(`Transcription captured successfully (${wordCount} words).`);

                    // 5. Save Transcript to DB
                    sendEvent({ step: 'save_transcript' });
                    const transcriptId = uuidv4();
                    const { error: insertTranscriptError } = await supabase.from('transcripts').insert({
                        id: transcriptId,
                        video_id: videoId,
                        user_id: user.id,
                        raw_text: fullTranscriptText,
                        word_count: wordCount
                    });
                    if (insertTranscriptError) throw new Error(`DB Insert Transcript Error: ${insertTranscriptError.message}`);

                    // Simulate analyze step as per old arch
                    const { error: updateError3 } = await supabase.from('videos').update({ status: 'analyzing' }).eq('id', videoId);
                    if (updateError3) throw new Error(`DB Update Error: ${updateError3.message}`);

                    sendEvent({ step: 'analyze' });

                    // --- REAL EMBEDDING STEP (Non-Fatal) ---
                    try {
                        const hfToken = requireEnv('HF_API_TOKEN');

                        const { HfInference } = await import('@huggingface/inference');
                        const hf = new HfInference(hfToken);
                        let embedding: number[] | null = null;

                        console.log(`Generating embedding for transcript ${transcriptId}...`);

                        for (let attempt = 1; attempt <= 3; attempt++) {
                            try {
                                const result = await hf.featureExtraction({
                                    model: "sentence-transformers/all-MiniLM-L6-v2",
                                    inputs: fullTranscriptText
                                });

                                // API returns either a flat list or nested list
                                if (Array.isArray(result) && Array.isArray(result[0])) {
                                    embedding = result[0] as number[];
                                } else if (Array.isArray(result)) {
                                    embedding = result as number[];
                                } else {
                                    throw new Error("Unexpected embedding response shape.");
                                }
                                break; // Success!
                            } catch (hfError: any) {
                                if (hfError?.message?.includes('503') || hfError?.statusCode === 503) {
                                    console.log(`HuggingFace model loading, waiting 20s (attempt ${attempt}/3)`);
                                    await new Promise(r => setTimeout(r, 20000));
                                    if (attempt === 3) throw hfError;
                                    continue;
                                }
                                throw hfError;
                            }
                        }

                        if (!embedding) {
                            throw new Error("Embedding failed after 3 retries");
                        }

                        const { error: embedError } = await supabase.from('transcripts').update({
                            embedding: embedding
                        }).eq('id', transcriptId);

                        if (embedError) {
                            throw new Error(`DB Update Embedding Error: ${embedError.message}`);
                        }

                        console.log(`Embedding saved — ${embedding.length} dimensions`);

                    } catch (embedCatchError) {
                        // Non-fatal: transcript is still valuable without embedding
                        console.error("Embedding failed (non-fatal):", embedCatchError);
                    }
                    // --- END EMBEDDING STEP ---

                    // --- VOICE PROFILE GENERATION (Non-Fatal) ---
                    try {
                        console.log(`Generating voice profile for user ${user.id}...`);

                        // 1. Fetch ALL transcripts for this user from transcripts table
                        const { data: transcriptsData, error: transcriptsError } = await supabase
                            .from('transcripts')
                            .select('raw_text')
                            .eq('user_id', user.id);

                        if (transcriptsError) throw new Error(`Failed to fetch user transcripts: ${transcriptsError.message}`);

                        // 2. Skip if no transcripts (technically shouldn't happen, we just inserted one)
                        if (transcriptsData && transcriptsData.length > 0) {
                            // 3. Combine all transcript texts
                            let combinedText = transcriptsData.map(t => t.raw_text).join("\n\n---\n\n");

                            // 4. Truncate to 6000 chars
                            if (combinedText.length > 6000) {
                                combinedText = combinedText.substring(0, 6000);
                            }

                            // 5. Send to Groq
                            const profileCompletion = await groq.chat.completions.create({
                                model: "llama-3.3-70b-versatile",
                                messages: [
                                    {
                                        role: "system",
                                        content: "You analyze a content creator's video transcripts to understand their unique voice, worldview, and content themes. You are specific and personal. You never use generic descriptions. Everything you return must reflect THIS creator's actual beliefs, words, topics, and style — not a generic creator. Return only valid JSON, no markdown, no explanation."
                                    },
                                    {
                                        role: "user",
                                        content: `Here are transcripts from a content creator's videos:\n\n${combinedText}\n\nAnalyze them and return ONLY this JSON object:\n{\n  "pillars": [\n    {\n      "name": string (overarching content buckets, e.g. 'Mindset & Growth', 'Founder Diaries'. Avoid semantically similar duplicates like 'Mindset' and 'Mindset Shifts' - pick one. Keep words simple, max 1-3 words),\n      "description": string (one sentence)\n    }\n  ] (2-4 distinct pillars maximum),\n  "tone_descriptors": string[] (3-5 adjectives describing exactly how this person talks),\n  "recurring_phrases": string[] (up to 6 short phrases this creator repeats),\n  "content_style": string (exactly one of: story-driven, listicle, how-to, conversational, educational),\n  "niche_summary": string (1-2 sentences on what they make and who for),\n  "signature_argument": string (the contrarian belief or core thesis this creator returns to most often. One sentence. Must be specific enough that a different creator would disagree with it. Bad: 'Hard work matters.' Good: 'Most people optimize the wrong thing first — pricing, not product.'),\n  "enemy_or_foil": string[] (2-4 things, ideologies, or types of people this creator pushes back against. Examples: 'hustle culture', 'productivity gurus', 'corporate consultants who never built anything'),\n  "would_never_say": string[] (3 specific sentences this creator would never say out loud, given their worldview. Make these concrete sentences, not categories. Example: 'Just believe in yourself!')\n}`
                                    }
                                ],
                                temperature: 0.1,
                                response_format: { type: "json_object" }
                            });

                            // 6. Parse the response
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

                            // T2 enrichment fields — non-fatal if missing (older transcripts may not surface a clear worldview)
                            profileData.signature_argument = profileData.signature_argument || null;
                            profileData.enemy_or_foil = Array.isArray(profileData.enemy_or_foil) ? profileData.enemy_or_foil : [];
                            profileData.would_never_say = Array.isArray(profileData.would_never_say) ? profileData.would_never_say : [];

                            // 7. Handle Pillars
                            const P_COLORS = ['#E8F4B8', '#FFD6E8', '#C8E6FF', '#FFE8C8', '#E0D4FF', '#D4F4E8', '#FFF3D4', '#F4D4E8'];

                            const { data: existingPillars, error: existingPillarsError } = await supabase
                                .from('pillars')
                                .select('name')
                                .eq('user_id', user.id);

                            if (existingPillarsError) throw new Error(`Failed to fetch existing pillars: ${existingPillarsError.message}`);

                            const existingNames = new Set((existingPillars || []).map(p => p.name.toLowerCase()));

                            const { count: totalPillars, error: countError } = await supabase
                                .from('pillars')
                                .select('*', { count: 'exact', head: true })
                                .eq('user_id', user.id);

                            if (countError) throw new Error(`Failed to count pillars: ${countError.message}`);

                            let currentColorIdx = (totalPillars || 0);

                            for (const p of profileData.pillars) {
                                if (!existingNames.has(p.name.toLowerCase())) {
                                    const { error: insertPillarError } = await supabase
                                        .from('pillars')
                                        .insert({
                                            user_id: user.id,
                                            name: p.name,
                                            source: 'ai_detected',
                                            color: P_COLORS[currentColorIdx % P_COLORS.length]
                                        });
                                    if (insertPillarError) throw new Error(`Failed to insert pillar ${p.name}: ${insertPillarError.message}`);
                                    currentColorIdx++;
                                    existingNames.add(p.name.toLowerCase());
                                }
                            }

                            // 8. Upsert Voice Profile
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

                            const upsertResponse = await supabase
                                .from('voice_profile')
                                .upsert(voiceProfileRecord, { onConflict: 'user_id' });

                            if (upsertResponse.error) throw new Error(`Failed to upsert voice profile: ${upsertResponse.error.message}`);

                            console.log(`Voice profile generated and updated successfully for ${user.id}`);

                            // --- TRANSCRIPT PILLAR TAGGING ---
                            let allPillarsList: { id: string, name: string }[] = [];
                            try {
                                const { data: allPillars } = await supabase.from('pillars').select('id, name').eq('user_id', user.id);
                                allPillarsList = allPillars || [];

                                if (allPillarsList.length > 0) {
                                    console.log(`Tagging transcript with pillars...`);
                                    const pillarNames = allPillarsList.map(p => p.name);

                                    const tagCompletion = await groq.chat.completions.create({
                                        model: "llama-3.3-70b-versatile",
                                        messages: [
                                            {
                                                role: "system",
                                                content: `Analyze the transcript and select the 1 or 2 MOST relevant pillars from the list. Be diverse and specific—if multiple exist, choose the ones that capture the specific hook or lesson of this video. If none fit well, return an empty array. Return ONLY JSON: { "pillars": ["Pillar Name 1"] }`
                                            },
                                            {
                                                role: "user",
                                                content: `Available Pillars: ${pillarNames.join(", ")}\n\nTranscript Snippet: ${fullTranscriptText.substring(0, 3000)}`
                                            }
                                        ],
                                        temperature: 0.1,
                                        response_format: { type: "json_object" }
                                    });

                                    let tagContent = tagCompletion.choices[0]?.message?.content || "{}";
                                    const tagData = JSON.parse(tagContent);
                                    const selectedPillars = tagData.pillars || [];

                                    for (const pName of selectedPillars) {
                                        const cleanStr = pName?.trim().toLowerCase() || "";
                                        const matchedPillar = allPillarsList.find(p => p.name.trim().toLowerCase() === cleanStr);
                                        if (matchedPillar) {
                                            await supabase.from('video_pillars').insert({
                                                video_id: videoId,
                                                pillar_id: matchedPillar.id
                                            });
                                        }
                                    }
                                    console.log(`Tagged transcript with pillars: ${selectedPillars.join(", ")}`);
                                }
                            } catch (tagError) {
                                console.error("Transcript pillar tagging failed (non-fatal):", tagError);
                            }
                            // --- END TRANSCRIPT PILLAR TAGGING ---

                            // --- BACKGROUND IDEA GENERATION ---
                            try {
                                console.log(`Generating 5 background ideas for ${user.id}...`);
                                const pillarNames = allPillarsList.map(p => p.name) || [];

                                const ideaSystemMessage = `You are a creative content strategist who has deeply studied this specific creator's voice. You never produce generic ideas. Every idea must sound like it could only come from this creator using their exact language, stories, and approach.

You MUST commit to a tension structure FIRST, then write the hook to match. Tension structures (these are SHAPE, not substance — fill them with this creator's specific stories, vocabulary, worldview):
- reversal — example shape: "I did the opposite of what worked"
- confession — example shape: "I lied to my best client"
- specific_number — example shape: "$847 in 11 days"
- contradiction — example shape: "Discipline ruined my life"
- identity_challenge — example shape: "You're not actually a writer"
- unexpected_outcome — example shape: "The wrong choice paid off"

If you cannot hear this exact creator saying the hook out loud, rewrite it.

Banned phrases (instant rejection — never use any of these or close variants): "this changed everything," "nobody talks about this," "I wish I knew this sooner," "game-changer," "let's dive in," "here's the thing," "the truth about," "what nobody tells you," "you won't believe," "secret to," "hack to."

Anchor every idea on a real lived moment from the transcripts (specific stories, numbers, clients, mistakes the creator actually mentioned). Do not invent generic examples when the creator has given you real ones.`;

                                const ideaUserMessage = `Creator voice profile:
Niche: ${profileData.niche_summary}
Tone: ${(profileData.tone_descriptors || []).join(", ")}
Style: ${profileData.content_style}
Phrases they actually say: ${(profileData.recurring_phrases || []).join(", ")}
Signature argument (their core belief — every idea must depend on this being true): ${profileData.signature_argument || "(not yet identified)"}
Enemy / foil (what they push back against): ${(profileData.enemy_or_foil || []).join(", ") || "(not yet identified)"}
Things this creator would NEVER say (avoid the energy of these): ${(profileData.would_never_say || []).join(" | ") || "(none provided)"}

Sample transcripts from their content (mine these for real moments to anchor on):
${combinedText.substring(0, 4000)}

Generate 5 Instagram Reel ideas distributed across these content pillars: ${pillarNames.join(", ")}. Aim for pillar balance — do not stack ideas in the most obvious pillar.

CRITICAL CONSTRAINT: every idea must depend on the signature_argument being true. If a generic creator with a different worldview could make this same idea, it is wrong — rewrite it.

For EACH idea, fill the JSON fields in this exact order. You must commit to pillar and tension_type BEFORE writing the hook — this prevents lazy hooks.

Field order and rules:
1. pillar — exact name from this list: ${pillarNames.join(", ")}
2. tension_type — one of: reversal | confession | specific_number | contradiction | identity_challenge | unexpected_outcome
3. anchor_moment — one short sentence quoting or paraphrasing the specific transcript moment this idea is built on (proves you read the transcripts)
4. hook — the literal first sentence the creator would say out loud. MUST use the tension_type committed above. MUST be ≤ 6 words. MUST contain at least one of: a proper noun, a number, or a first-person verb (I/we/my).
5. hook_word_count — integer count of words in your hook. If > 6, rewrite the hook before continuing.
6. format — one of: talking-head | text-on-screen | B-roll with VO | hybrid
7. structure — Hook (0-2s) → Pattern interrupt (3-8s) → 2-3 body beats with tension → Payoff that closes the loop the hook opened
8. retention_beat — the specific mid-video moment designed to re-hook viewers about to scroll
9. cta — the specific end action (save / comment / follow / DM / share) and why it fits this idea
10. title — long-form, descriptive, engaging
11. description — how the creator would uniquely execute this, anchored on the anchor_moment and their voice

Return ONLY a JSON object with this exact shape:
{ "ideas": [ { ...all fields above... }, ... ] }`

                                const ideaCompletion = await groq.chat.completions.create({
                                    model: "llama-3.3-70b-versatile",
                                    messages: [
                                        { role: "system", content: ideaSystemMessage },
                                        { role: "user", content: ideaUserMessage }
                                    ],
                                    temperature: 0.85,
                                    response_format: { type: "json_object" }
                                });

                                let ideaContent = ideaCompletion.choices[0]?.message?.content || "[]";
                                if (ideaContent.startsWith("```json")) ideaContent = ideaContent.replace(/^```json\n/, "").replace(/\n```$/, "");
                                else if (ideaContent.startsWith("```")) ideaContent = ideaContent.replace(/^```\n/, "").replace(/\n```$/, "");

                                let ideasData = JSON.parse(ideaContent.trim());
                                if (!Array.isArray(ideasData)) {
                                    ideasData = ideasData.ideas && Array.isArray(ideasData.ideas) ? ideasData.ideas : [ideasData];
                                }

                                for (const idea of ideasData) {
                                    const cleanIdeaPillar = idea.pillar?.trim().toLowerCase() || "";
                                    const matchedPillar = allPillarsList.find(p => p.name.trim().toLowerCase() === cleanIdeaPillar);
                                    const reasoningParts = [
                                        idea.description || idea.reasoning,
                                        idea.tension_type ? `Tension: ${idea.tension_type}` : null,
                                        idea.anchor_moment ? `Anchor moment: ${idea.anchor_moment}` : null,
                                        idea.format ? `Format: ${idea.format}` : null,
                                        idea.retention_beat ? `Retention beat: ${idea.retention_beat}` : null,
                                        idea.cta ? `CTA: ${idea.cta}` : null,
                                    ].filter(Boolean);
                                    await supabase.from('content_ideas').insert({
                                        user_id: user.id,
                                        title: idea.title,
                                        hook: idea.hook,
                                        structure: idea.structure,
                                        reasoning: reasoningParts.join("\n\n"),
                                        pillar_id: matchedPillar ? matchedPillar.id : null,
                                        is_saved: false,
                                        is_used: false
                                    });
                                }
                                console.log("Successfully generated 5 background ideas.");
                            } catch (bgIdeaError) {
                                console.error("Background idea generation failed (non-fatal):", bgIdeaError);
                            }
                            // --- END BACKGROUND IDEA GENERATION ---
                        }
                    } catch (vpError) {
                        console.error("Voice Profile generation failed (non-fatal):", vpError);
                    }
                    // --- END VOICE PROFILE GENERATION ---

                    // Done
                    const { error: updateError4 } = await supabase.from('videos').update({ status: 'done' }).eq('id', videoId);
                    if (updateError4) throw new Error(`DB Update Error: ${updateError4.message}`);

                    // Client fetches the transcript from DB after this event, so we
                    // do not stream it again over the wire.
                    sendEvent({ step: 'done', video_id: videoId });
                    controller.close();
                } catch (err) {
                    console.error('Processing error:', err);
                    const errorMessage = err instanceof Error ? err.message : 'Processing failed';
                    sendEvent({ error: errorMessage });
                    controller.close();
                } finally {
                    // 6. Complete Cleanup Strategy
                    console.log(`Cleaning up ${tempFilesToCleanup.length} temporary files...`);
                    for (const tempFile of tempFilesToCleanup) {
                        try {
                            await unlink(tempFile);
                            console.log(`Deleted temp file: ${tempFile}`);
                        } catch (cleanupError) {
                            console.error(`Failed to delete temp file ${tempFile}:`, cleanupError);
                        }
                    }
                }
            }
        });

        return new Response(stream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
        });

    } catch (error) {
        console.error('Upload handler error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
