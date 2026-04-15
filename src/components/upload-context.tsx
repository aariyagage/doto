'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/toast'

const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024 // 500MB

export type UploadStatus =
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

export interface UploadTaskPillar {
    id: string
    name: string
    color: string
}

export interface FileUploadTask {
    id: string
    file: File
    status: UploadStatus
    progress: number
    errorMessage?: string
    abortController?: AbortController
    transcript?: string
    wordCount?: number
    videoId?: string
    pillars?: UploadTaskPillar[]
}

interface UploadContextValue {
    tasks: FileUploadTask[]
    completedCount: number
    addFiles: (files: FileList | File[]) => void
    retryTask: (taskId: string) => void
    cancelTask: (taskId: string) => void
    activeCount: number
}

const UploadContext = createContext<UploadContextValue | null>(null)

const TERMINAL_STATUSES: UploadStatus[] = ['queued', 'done', 'error', 'cancelled']

export function UploadProvider({ children }: { children: React.ReactNode }) {
    const supabase = createClient()
    const { showToast } = useToast()
    const [tasks, setTasks] = useState<FileUploadTask[]>([])
    const [completedCount, setCompletedCount] = useState(0)

    // Ref mirror of tasks so the queue worker can read current state without
    // re-running the effect on every state change.
    const tasksRef = useRef<FileUploadTask[]>([])
    useEffect(() => { tasksRef.current = tasks }, [tasks])

    const updateTask = useCallback((id: string, updates: Partial<FileUploadTask>) => {
        setTasks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t))
    }, [])

    const processTask = useCallback(async (task: FileUploadTask) => {
        const abortController = new AbortController()
        updateTask(task.id, { status: 'uploading', progress: 0, errorMessage: undefined, abortController })

        try {
            const { data: sessionData } = await supabase.auth.getSession()
            const token = sessionData.session?.access_token
            if (!token) throw new Error('Session expired. Please sign out and sign back in.')

            const formData = new FormData()
            formData.append('file', task.file)

            const response = await fetch('/api/videos/process', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData,
                signal: abortController.signal,
            })

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}))
                throw new Error(errorData.detail || errorData.error || `Upload failed with status ${response.status}`)
            }
            if (!response.body) throw new Error('No response stream available')

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
                        let data: { step?: string; video_id?: string; error?: string }
                        try {
                            data = JSON.parse(line.substring(6))
                        } catch {
                            continue
                        }
                        if (data.error) throw new Error(data.error)
                        if (data.step) {
                            updateTask(task.id, {
                                status: data.step as UploadStatus,
                                ...(data.video_id && { videoId: data.video_id }),
                            })
                        }
                    }
                }
            }

            updateTask(task.id, { status: 'done', progress: 100 })
        } catch (error) {
            const err = error as Error
            if (err.name === 'AbortError') {
                updateTask(task.id, { status: 'cancelled', errorMessage: 'Upload cancelled' })
            } else {
                updateTask(task.id, { status: 'error', errorMessage: err.message || 'An error occurred during processing' })
                showToast(err.message || 'Upload failed', 'error')
            }
        }
    }, [supabase, updateTask, showToast])

    // Queue worker: pick up next queued task whenever nothing active.
    useEffect(() => {
        const active = tasks.some(t => !TERMINAL_STATUSES.includes(t.status))
        if (active) return
        const next = tasks.find(t => t.status === 'queued')
        if (next) {
            processTask(next)
        }
    }, [tasks, processTask])

    // Enrich completed tasks with transcript + pillars (display-only data).
    useEffect(() => {
        tasks.forEach(async (task) => {
            if (task.status !== 'done' || !task.videoId) return
            if (task.transcript && task.pillars) return
            if (task.errorMessage) return

            try {
                const { data: { user } } = await supabase.auth.getUser()
                if (!user) return

                const { data: tsData, error: tsErr } = await supabase
                    .from('transcripts')
                    .select('raw_text, word_count')
                    .eq('video_id', task.videoId)
                    .eq('user_id', user.id)
                    .single()

                const { data: vpData } = await supabase
                    .from('video_pillars')
                    .select('pillar_id')
                    .eq('video_id', task.videoId)

                let taskPillars: UploadTaskPillar[] = []
                if (vpData && vpData.length > 0) {
                    const pillarIds = vpData.map(vp => vp.pillar_id)
                    const { data: pData } = await supabase
                        .from('pillars')
                        .select('id, name, color')
                        .eq('user_id', user.id)
                        .in('id', pillarIds)
                    if (pData) taskPillars = pData
                }

                if (!tsErr && tsData) {
                    updateTask(task.id, {
                        transcript: tsData.raw_text,
                        wordCount: tsData.word_count,
                        pillars: taskPillars,
                    })
                }
            } catch (err) {
                console.error('Transcript fetch error:', err)
            }
        })
    }, [tasks, supabase, updateTask])

    // Keep the completedCount summary fresh so other parts of the app can read it.
    const refreshCompletedCount = useCallback(async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        const { count, error } = await supabase
            .from('videos')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq('status', 'done')
        if (!error && count !== null) setCompletedCount(count)
    }, [supabase])

    useEffect(() => {
        refreshCompletedCount()
    }, [refreshCompletedCount])

    // Whenever a task finishes, refresh the count.
    useEffect(() => {
        if (tasks.some(t => t.status === 'done')) {
            refreshCompletedCount()
        }
    }, [tasks, refreshCompletedCount])

    // Warn the user if they try to close the browser while work is active.
    // This is the only case we genuinely cannot recover from.
    useEffect(() => {
        const hasActive = tasks.some(t => !TERMINAL_STATUSES.includes(t.status))
        if (!hasActive) return
        const handler = (e: BeforeUnloadEvent) => {
            e.preventDefault()
            e.returnValue = ''
        }
        window.addEventListener('beforeunload', handler)
        return () => window.removeEventListener('beforeunload', handler)
    }, [tasks])

    const addFiles = useCallback((files: FileList | File[]) => {
        const newTasks: FileUploadTask[] = []
        Array.from(files).forEach((file) => {
            if (!file.type.startsWith('video/')) {
                showToast(`${file.name} is not a supported video type`, 'error')
                return
            }
            if (file.size > MAX_FILE_SIZE_BYTES) {
                showToast(`${file.name} exceeds the 500MB maximum`, 'error')
                return
            }
            newTasks.push({ id: uuidv4(), file, progress: 0, status: 'queued' })
        })
        if (newTasks.length > 0) {
            setTasks(prev => [...prev, ...newTasks])
        }
    }, [showToast])

    const retryTask = useCallback((taskId: string) => {
        setTasks(prev => prev.map(t => t.id === taskId
            ? { ...t, id: uuidv4(), progress: 0, status: 'queued', errorMessage: undefined, abortController: undefined }
            : t,
        ))
    }, [])

    const cancelTask = useCallback((taskId: string) => {
        const current = tasksRef.current.find(t => t.id === taskId)
        current?.abortController?.abort()
    }, [])

    const activeCount = tasks.filter(t => !TERMINAL_STATUSES.includes(t.status)).length

    return (
        <UploadContext.Provider value={{ tasks, completedCount, addFiles, retryTask, cancelTask, activeCount }}>
            {children}
        </UploadContext.Provider>
    )
}

export function useUpload(): UploadContextValue {
    const ctx = useContext(UploadContext)
    if (!ctx) throw new Error('useUpload must be used inside <UploadProvider>')
    return ctx
}
