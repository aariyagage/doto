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
import { ensureEssenceForTranscript } from '@/lib/pillars/essence';
import { bootstrapPillarsForUser } from '@/lib/pillars/bootstrap';
import { tagOrCreatePillarsForVideo } from '@/lib/pillars/tag-or-create';
import { detectAndPersistSeriesIfApplicable } from '@/lib/pillars/series-detector';
import { topUpIdeasForPillars } from '@/lib/pillars/auto-ideas';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const ALLOWED_VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.m4v', '.mkv', '.avi']);
const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024; // 500MB — matches the client-side cap on the source video.
const STORAGE_BUCKET = 'video-uploads';

function isAcceptedVideoName(fileName: string): boolean {
    const ext = extname(fileName).toLowerCase();
    return ALLOWED_VIDEO_EXTENSIONS.has(ext);
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

        let body: { storagePath?: unknown; fileName?: unknown; fileSize?: unknown };
        try {
            body = await request.json();
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }

        const storagePath = typeof body.storagePath === 'string' ? body.storagePath : '';
        const fileName = typeof body.fileName === 'string' ? body.fileName : '';
        const fileSize = typeof body.fileSize === 'number' ? body.fileSize : 0;

        if (!storagePath || !fileName) {
            return NextResponse.json({ error: 'Missing storagePath or fileName' }, { status: 400 });
        }

        if (fileSize > MAX_FILE_SIZE_BYTES) {
            return NextResponse.json(
                { error: `File exceeds the maximum size of ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB` },
                { status: 413 }
            );
        }

        if (!isAcceptedVideoName(fileName)) {
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

        // Storage paths are `{user_id}/{uuid}.ext` — reject anything outside
        // the caller's own folder so one user can't process another's upload.
        if (!storagePath.startsWith(`${user.id}/`) || storagePath.includes('..')) {
            return NextResponse.json({ error: 'Forbidden storage path' }, { status: 403 });
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
                    // 1. Uploading (download the already-extracted audio from
                    // Storage into /tmp — the browser ran ffmpeg.wasm locally,
                    // so we skip server-side extraction entirely).
                    sendEvent({ step: 'uploading' });
                    const { data: blob, error: dlError } = await supabase.storage
                        .from(STORAGE_BUCKET)
                        .download(storagePath);
                    if (dlError || !blob) {
                        throw new Error(`Failed to download uploaded audio: ${dlError?.message || 'unknown error'}`);
                    }
                    const buffer = Buffer.from(await blob.arrayBuffer());

                    const tempDir = os.tmpdir();
                    const videoId = uuidv4();

                    const audioPath = join(tempDir, `${videoId}-audio.mp3`);
                    tempFilesToCleanup.push(audioPath);
                    await writeFile(audioPath, buffer);
                    console.log(`Saved temp audio to ${audioPath}`);

                    // Create basic video record with strict error checking
                    const { error: insertError } = await supabase.from('videos').insert({
                        id: videoId,
                        user_id: user.id,
                        file_name: fileName,
                        status: 'uploading'
                    });
                    if (insertError) throw new Error(`DB Insert Error: ${insertError.message}`);

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

                    // --- PILLAR PIPELINE (Non-Fatal) ---
                    // Kill switch: set NEW_PILLAR_PIPELINE=false to skip the pillar
                    // block entirely (transcripts still save). Default is on.
                    if (process.env.NEW_PILLAR_PIPELINE !== 'false') {
                        try {
                            // 1. Per-transcript essence + embedding (idempotent).
                            await ensureEssenceForTranscript(supabase, transcriptId, groq);

                            // 2. Count user's eligible (non-hidden) transcripts.
                            const { count: transcriptCount, error: countErr } = await supabase
                                .from('transcripts')
                                .select('*', { count: 'exact', head: true })
                                .eq('user_id', user.id)
                                .or('is_hidden.is.null,is_hidden.eq.false');
                            if (countErr) throw new Error(`Failed to count transcripts: ${countErr.message}`);

                            // 3. Branch on transcript count.
                            //    - 1: onboarding state, no pillars yet.
                            //    - 2: bootstrap path — generate first pillars + voice profile.
                            //    - 3+: steady state — tag-or-create against existing pillars.
                            if (transcriptCount === 1) {
                                console.log(`User ${user.id} has 1 transcript — deferring pillar generation until 2nd upload.`);
                            } else if (transcriptCount === 2) {
                                await bootstrapPillarsForUser({ supabase, groq, userId: user.id });
                            } else {
                                await tagOrCreatePillarsForVideo({
                                    supabase, groq, userId: user.id, videoId, transcriptId,
                                });
                            }

                            // 4. Series detection (regex pre-filter; LLM only fires on hits).
                            await detectAndPersistSeriesIfApplicable({
                                supabase, groq, userId: user.id, videoId,
                                transcriptText: fullTranscriptText,
                            });
                        } catch (pillarErr) {
                            console.error('Pillar pipeline failed (non-fatal):', pillarErr);
                        }
                        // Tell the client pillar tags are ready to fetch. Fired even if
                        // the pillar block threw — the upload-context listener should
                        // still proceed and re-fetch (it'll get whatever exists).
                        sendEvent({ step: 'pillars_ready' });

                        // 5. Auto-generate ideas for any pillar this video was
                        //    tagged to (only tops up to 3 unused — won't repeat
                        //    work if the user already has fresh ideas pending).
                        //    Non-fatal.
                        try {
                            const { data: tagged } = await supabase
                                .from('video_pillars')
                                .select('pillar_id')
                                .eq('video_id', videoId);
                            const taggedPillarIds = (tagged || []).map(t => t.pillar_id as string).filter(Boolean);
                            if (taggedPillarIds.length > 0) {
                                const result = await topUpIdeasForPillars({
                                    supabase, groq, userId: user.id, pillarIds: taggedPillarIds,
                                });
                                console.log(`auto-ideas video=${videoId} pillars=${taggedPillarIds.length} generated=${result.generated} toppedUp=${result.pillarsToppedUp}`);
                            }
                        } catch (ideasErr) {
                            console.error('Auto idea top-up failed (non-fatal):', ideasErr);
                        }
                        sendEvent({ step: 'ideas_ready' });
                    }
                    // --- END PILLAR PIPELINE ---

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
                    // Delete the source video from Storage — transcripts are the
                    // durable artifact, raw video is never retained.
                    try {
                        const { error: removeError } = await supabase.storage
                            .from(STORAGE_BUCKET)
                            .remove([storagePath]);
                        if (removeError) {
                            console.error(`Failed to remove storage object ${storagePath}:`, removeError.message);
                        } else {
                            console.log(`Removed storage object ${storagePath}`);
                        }
                    } catch (storageCleanupError) {
                        console.error(`Storage cleanup threw for ${storagePath}:`, storageCleanupError);
                    }

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
