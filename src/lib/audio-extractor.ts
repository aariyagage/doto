'use client'

// Client-side audio extraction via ffmpeg.wasm. Running extraction in the
// browser keeps raw video off the server entirely — we only ever upload a
// small mp3, which sidesteps both Vercel's 4.5MB body limit and Supabase
// free-tier's 50MB per-request cap.

import type { FFmpeg } from '@ffmpeg/ffmpeg'

const FFMPEG_CORE_VERSION = '0.12.6'
const CORE_BASE = `https://unpkg.com/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd`

let ffmpegInstance: FFmpeg | null = null
let loadPromise: Promise<FFmpeg> | null = null

async function getFfmpeg(): Promise<FFmpeg> {
    if (ffmpegInstance) return ffmpegInstance
    if (loadPromise) return loadPromise

    loadPromise = (async () => {
        const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
            import('@ffmpeg/ffmpeg'),
            import('@ffmpeg/util'),
        ])
        const ffmpeg = new FFmpeg()
        // toBlobURL fetches the CDN assets and rebinds them as same-origin
        // blob URLs so the browser will actually load the worker/wasm.
        await ffmpeg.load({
            coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
        })
        ffmpegInstance = ffmpeg
        return ffmpeg
    })()

    return loadPromise
}

function inferInputName(fileName: string): string {
    const lastDot = fileName.lastIndexOf('.')
    const ext = lastDot >= 0 ? fileName.slice(lastDot).toLowerCase() : '.mp4'
    return `input${ext}`
}

export interface AudioExtractionResult {
    blob: Blob
    durationMs: number
}

export async function extractAudioFromVideo(
    file: File,
    onProgress: (pct: number) => void,
    signal?: AbortSignal,
): Promise<AudioExtractionResult> {
    const ffmpeg = await getFfmpeg()
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    const { fetchFile } = await import('@ffmpeg/util')

    const inputName = inferInputName(file.name)
    const outputName = 'output.mp3'

    const progressHandler = ({ progress }: { progress: number }) => {
        const pct = Math.min(100, Math.max(0, Math.round(progress * 100)))
        onProgress(pct)
    }
    ffmpeg.on('progress', progressHandler)

    const onAbort = () => {
        try {
            ffmpeg.terminate()
        } catch {
            /* terminate throws if load never finished; ignore */
        }
        ffmpegInstance = null
        loadPromise = null
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    const startedAt = Date.now()
    try {
        await ffmpeg.writeFile(inputName, await fetchFile(file))

        // Match the server's historical encoding params: mono, 16kHz, mp3.
        // 64k bitrate keeps files small (≈30MB/hour) while preserving the
        // signal Whisper needs.
        await ffmpeg.exec([
            '-i', inputName,
            '-vn',
            '-ac', '1',
            '-ar', '16000',
            '-b:a', '64k',
            outputName,
        ])

        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

        const data = await ffmpeg.readFile(outputName)
        // Copy into a fresh ArrayBuffer-backed Uint8Array so Blob construction
        // is happy regardless of whether ffmpeg's output sits on Shared or
        // plain ArrayBuffer memory.
        const source = typeof data === 'string' ? new TextEncoder().encode(data) : data
        const bytes = new Uint8Array(source.byteLength)
        bytes.set(source)
        const blob = new Blob([bytes], { type: 'audio/mpeg' })

        try { await ffmpeg.deleteFile(inputName) } catch { /* noop */ }
        try { await ffmpeg.deleteFile(outputName) } catch { /* noop */ }

        return { blob, durationMs: Date.now() - startedAt }
    } finally {
        ffmpeg.off('progress', progressHandler)
        signal?.removeEventListener('abort', onAbort)
    }
}
