'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { v4 as uuidv4 } from 'uuid'
import { UploadCloud, CheckCircle2, AlertCircle, RefreshCw, X, Loader2, Copy } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import AppLayout from '@/components/AppLayout'

const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024 // 500MB

type UploadStatus =
    | 'queued'
    | 'uploading'
    | 'extract_audio'
    | 'chunk_audio'
    | 'transcribe'
    | 'save_transcript'
    | 'analyze'
    | 'done'
    | 'error'
    | 'cancelled'

interface FileUploadTask {
    id: string
    file: File
    status: UploadStatus
    progress: number
    errorMessage?: string
    abortController?: AbortController
    transcript?: string
    wordCount?: number
    videoId?: string
    pillars?: { id: string, name: string, color: string }[]
}

export default function UploadPage() {
    const router = useRouter()
    const supabase = createClient()
    const [tasks, setTasks] = useState<FileUploadTask[]>([])
    const [isDragging, setIsDragging] = useState(false)
    const [completedCount, setCompletedCount] = useState<number>(0)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(true)
    }

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(false)
    }

    const validateAndAddFiles = (files: FileList | File[]) => {
        const newTasks: FileUploadTask[] = []
        Array.from(files).forEach((file) => {
            if (!file.type.startsWith('video/')) {
                alert(`File ${file.name} is not a supported video type.`)
                return
            }
            if (file.size > MAX_FILE_SIZE_BYTES) {
                alert(`File ${file.name} exceeds the maximum size of 500MB.`)
                return
            }
            newTasks.push({
                id: uuidv4(),
                file,
                progress: 0,
                status: 'queued'
            })
        })
        if (newTasks.length > 0) {
            setTasks(prev => [...prev, ...newTasks])
        }
    }

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(false)
        if (e.dataTransfer.files?.length) {
            validateAndAddFiles(e.dataTransfer.files)
        }
    }

    const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.length) {
            validateAndAddFiles(e.target.files)
        }
        if (fileInputRef.current) fileInputRef.current.value = ''
    }

    const updateTask = (id: string, updates: Partial<FileUploadTask>) => {
        setTasks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t))
    }

    useEffect(() => {
        const processQueue = async () => {
            const currentTasks = [...tasks]
            const isProcessing = currentTasks.some(t =>
                !['queued', 'done', 'error', 'cancelled'].includes(t.status)
            )
            if (isProcessing) return
            const nextTask = currentTasks.find(t => t.status === 'queued')
            if (nextTask) {
                await processTask(nextTask)
            }
        }
        processQueue()

        // Fetch total completed videos count
        const fetchCompletedCount = async () => {
            const { data: sessionData } = await supabase.auth.getSession()
            if (!sessionData.session?.user) return

            const { count, error } = await supabase
                .from('videos')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', sessionData.session.user.id)
                .eq('status', 'done')

            if (!error && count !== null) {
                setCompletedCount(count)
            }
        }
        fetchCompletedCount()

        // Fetch transcripts for completed tasks that don't have it yet
        tasks.forEach(async (task) => {
            if (task.status === 'done' && task.videoId && (!task.transcript || !task.pillars) && !task.errorMessage) {
                try {
                    const { data: tsData, error: tsErr } = await supabase
                        .from('transcripts')
                        .select('raw_text, word_count')
                        .eq('video_id', task.videoId)
                        .single()

                    // Fetch pillars
                    const { data: vpData } = await supabase
                        .from('video_pillars')
                        .select('pillar_id')
                        .eq('video_id', task.videoId)

                    let taskPillars: { id: string, name: string, color: string }[] = [];
                    if (vpData && vpData.length > 0) {
                        const pillarIds = vpData.map(vp => vp.pillar_id);
                        const { data: pData } = await supabase
                            .from('pillars')
                            .select('id, name, color')
                            .in('id', pillarIds);

                        if (pData) {
                            taskPillars = pData;
                        }
                    }

                    if (!tsErr && tsData) {
                        updateTask(task.id, {
                            transcript: tsData.raw_text,
                            wordCount: tsData.word_count,
                            pillars: taskPillars
                        })
                    }
                } catch (err) {
                    console.error("Transcript fetch block error:", err)
                }
            }
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tasks, supabase])

    const processTask = async (task: FileUploadTask) => {
        const abortController = new AbortController()
        updateTask(task.id, { status: 'uploading', progress: 0, errorMessage: undefined, abortController })

        try {
            const { data: sessionData } = await supabase.auth.getSession()
            const token = sessionData.session?.access_token
            if (!token) throw new Error("Session expired. Please sign out and sign back in.")

            const formData = new FormData()
            formData.append('file', task.file)

            const response = await fetch(`/api/videos/process`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                },
                body: formData,
                signal: abortController.signal
            })

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}))
                throw new Error(errorData.detail || `Upload failed with status ${response.status}`)
            }

            if (!response.body) throw new Error("No response stream available")

            const reader = response.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ''

            while (true) {
                const { value, done } = await reader.read()
                if (done) break

                buffer += decoder.decode(value, { stream: true })
                const lines = buffer.split('\n')
                buffer = lines.pop() || ''

                for (const line of lines) {
                    if (line.trim() === '') continue
                    if (line.startsWith('data: ')) {
                        let data;
                        try {
                            data = JSON.parse(line.substring(6))
                        } catch {
                            continue; // Ignored JSON parse error
                        }

                        if (data.error) {
                            throw new Error(data.error)
                        }
                        if (data.step) {
                            updateTask(task.id, {
                                status: data.step as UploadStatus,
                                ...(data.video_id && { videoId: data.video_id })
                            })
                        }
                    }
                }
            }

            updateTask(task.id, { status: 'done', progress: 100 })

        } catch (error) {
            const err = error as Error;
            if (err.name === 'AbortError') {
                updateTask(task.id, { status: 'cancelled', errorMessage: 'Upload cancelled' })
            } else {
                updateTask(task.id, { status: 'error', errorMessage: err.message || 'An error occurred during processing' })
            }
        }
    }

    const handleRetry = (task: FileUploadTask) => {
        const resetTask = { ...task, id: uuidv4(), progress: 0, status: 'queued' as UploadStatus, errorMessage: undefined, abortController: undefined }
        setTasks(prev => prev.map(t => t.id === task.id ? resetTask : t))
    }

    const handleCancel = (task: FileUploadTask) => {
        if (task.abortController) {
            task.abortController.abort()
        }
    }

    const activeSteps = ['uploading', 'extract_audio', 'chunk_audio', 'transcribe', 'save_transcript', 'analyze']

    return (
        <AppLayout>
            <div className="flex-1 flex flex-col overflow-hidden w-full relative">
                <main className="flex-1 w-full">
                    <div className="w-full max-w-4xl mx-auto space-y-6">
                        <div className="flex items-center justify-between mb-8">
                            <h1 className="text-3xl md:text-5xl font-heading tracking-tight text-gray-900 dark:text-white">Upload Videos</h1>
                            <Button variant="outline" onClick={() => router.push('/dashboard')}>Back to Dashboard</Button>
                        </div>

                        <div
                            className={`flex min-h-[300px] cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed transition-all duration-300 ${isDragging ? 'border-[#125603] bg-[var(--combo-3-bg)]/10 scale-105' : 'border-gray-300 dark:border-gray-700 bg-[var(--bg-panel)] hover:border-[#125603] hover:bg-[var(--combo-3-bg)]/5'}`}
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={handleDrop}
                            onClick={() => fileInputRef.current?.click()}
                            role="button"
                            tabIndex={0}
                        >
                            <input type="file" ref={fileInputRef} onChange={handleFileInput} accept="video/*" multiple className="hidden" />
                            <UploadCloud className={`mb-4 h-16 w-16 transition-colors duration-300 ${isDragging ? 'text-[#125603]' : 'text-gray-400 dark:text-gray-500 hover:text-[#125603]'}`} />
                            <p className="mb-2 text-lg font-medium text-gray-700">Drag videos here or click to browse</p>
                            <p className="text-sm text-gray-500">MP4, WebM, or MOV (max 500MB per file)</p>
                        </div>

                        <p className="text-sm text-gray-500 text-center">Videos are processed one at a time to ensure quality.</p>

                        {completedCount > 0 && (
                            <div className="text-center font-medium text-blue-600 mt-2">
                                {completedCount === 1 && "1 video analyzed · Add 2-3 more for best results"}
                                {completedCount === 2 && "2 videos analyzed · Getting better"}
                                {(completedCount >= 3 && completedCount <= 4) && `${completedCount} videos analyzed · Good coverage`}
                                {completedCount >= 5 && `${completedCount} videos analyzed · Great coverage`}
                            </div>
                        )}

                        {tasks.length > 0 && (
                            <div className="space-y-4">
                                {tasks.map(task => (
                                    <div key={task.id} className="relative flex flex-col rounded-lg border bg-white p-6 shadow-sm">
                                        <div className="flex items-center justify-between mb-8">
                                            <span className="truncate font-medium text-gray-700 max-w-[50%]" title={task.file.name}>
                                                {task.file.name}
                                            </span>
                                            <span className="text-sm text-gray-400">{(task.file.size / (1024 * 1024)).toFixed(1)} MB</span>

                                            <div className="absolute top-4 right-4 flex items-center gap-2">
                                                {(task.status === 'error' || task.status === 'cancelled') && (
                                                    <Button variant="outline" size="sm" onClick={() => handleRetry(task)} className="h-8 gap-1"><RefreshCw className="h-3 w-3" /> Retry</Button>
                                                )}
                                                {task.status !== 'done' && (
                                                    <Button variant="ghost" size="sm" onClick={() => handleCancel(task)} className="h-8 w-8 p-0 text-gray-400 hover:text-red-600"><X className="h-4 w-4" /></Button>
                                                )}
                                            </div>
                                        </div>

                                        <div className="flex justify-between relative px-2 mb-2">
                                            <div className="absolute top-3 left-0 w-full h-0.5 bg-gray-100 -z-10" />
                                            {['Upload', 'Audio', 'Chunk', 'Transcribe', 'Save DB', 'Analyze', 'Done'].map((step, idx) => {
                                                const stepKeys: UploadStatus[] = ['uploading', 'extract_audio', 'chunk_audio', 'transcribe', 'save_transcript', 'analyze', 'done']
                                                const currentStepIdx = stepKeys.indexOf(task.status)

                                                // If chunking is skipped in backend, visually advance it if we moved past it
                                                let adjustedCurrentIdx = currentStepIdx;
                                                if (task.status === 'transcribe' && idx === stepKeys.indexOf('chunk_audio')) {
                                                    adjustedCurrentIdx = stepKeys.indexOf('transcribe');
                                                }

                                                let statusColor = 'border-gray-200 dark:border-gray-700 bg-[var(--bg-panel)] text-gray-400'
                                                if (task.status === 'error' || task.status === 'cancelled') {
                                                    if (adjustedCurrentIdx === idx) {
                                                        statusColor = 'border-red-500 bg-[var(--bg-panel)] text-red-500'
                                                    } else if (adjustedCurrentIdx > idx) {
                                                        statusColor = 'border-red-200 bg-red-100 text-red-400'
                                                    } else {
                                                        statusColor = 'border-gray-200 dark:border-gray-700 bg-[var(--bg-panel)] text-gray-400'
                                                    }
                                                } else if (adjustedCurrentIdx > idx || task.status === 'done') {
                                                    statusColor = 'border-[#125603] bg-[#125603] text-[var(--bg-panel)]'
                                                } else if (adjustedCurrentIdx === idx) {
                                                    statusColor = 'border-[#125603] bg-[var(--bg-panel)] text-[#125603]'
                                                }

                                                return (
                                                    <div key={step} className="flex flex-col items-center gap-2 bg-white px-2">
                                                        <div className={`flex h-6 w-6 items-center justify-center rounded-full border-2 ${statusColor}`}>
                                                            {(adjustedCurrentIdx > idx || task.status === 'done' || (task.status === 'error' && adjustedCurrentIdx > idx)) ? <CheckCircle2 className="h-4 w-4" /> :
                                                                (adjustedCurrentIdx === idx && activeSteps.includes(task.status)) ? <Loader2 className="h-3 w-3 animate-spin" /> :
                                                                    (adjustedCurrentIdx === idx && (task.status === 'error' || task.status === 'cancelled')) ? <AlertCircle className="h-4 w-4" /> :
                                                                        <div className="h-2 w-2 rounded-full bg-current" />}
                                                        </div>
                                                        <span className={`text-xs font-heading font-bold ${adjustedCurrentIdx >= idx ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400'}`}>{step}</span>
                                                    </div>
                                                )
                                            })}
                                        </div>

                                        {task.errorMessage && (
                                            <div className="mt-4 flex items-center text-sm text-red-600">
                                                <AlertCircle className="mr-2 h-4 w-4" />
                                                {task.errorMessage}
                                            </div>
                                        )}

                                        {task.transcript && (
                                            <div className="mt-6 rounded-md bg-gray-50 p-4 border border-gray-100 text-sm text-gray-700 relative">
                                                <div className="flex items-center justify-between mb-4">
                                                    <div className="flex items-center gap-3">
                                                        <h4 className="font-semibold text-gray-900 flex items-center gap-2">
                                                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                                                            Extracted Transcript
                                                        </h4>
                                                        {(task.pillars && task.pillars.length > 0) ? (
                                                            <div className="flex gap-1.5 ml-2">
                                                                {task.pillars.map(p => (
                                                                    <span key={p.id} style={{ backgroundColor: p.color }} className="text-[10px] font-bold px-2 py-0.5 rounded text-gray-900 uppercase tracking-widest">
                                                                        {p.name}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        ) : (
                                                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-gray-200 text-gray-500 uppercase tracking-widest ml-2 flex items-center gap-1">
                                                                Uncategorized
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-4 text-xs font-medium text-gray-400">
                                                        <span>{task.wordCount || 0} words</span>
                                                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => navigator.clipboard.writeText(task.transcript || "")}>
                                                            <Copy className="h-3 w-3 mr-1" /> Copy
                                                        </Button>
                                                    </div>
                                                </div>
                                                <div className="max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                                                    <p className="whitespace-pre-wrap leading-relaxed text-gray-600">{task.transcript}</p>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </main>
            </div>
        </AppLayout>
    )
}
