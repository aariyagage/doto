'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { v4 as uuidv4 } from 'uuid'
import { UploadCloud, CheckCircle2, AlertCircle, RefreshCw, XCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'

const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024 // 500MB

type UploadStatus =
    | 'queued'
    | 'uploading'
    | 'uploaded_storage'
    | 'success' // DB + Storage success
    | 'failed_storage'
    | 'failed_db'
    | 'cancelled'

interface FileUploadTask {
    id: string
    file: File
    sanitizedName: string
    progress: number
    status: UploadStatus
    errorMessage?: string
    storagePath?: string // Set when uploading starts
    xhr?: XMLHttpRequest // To allow cancellation
}

export default function UploadPage() {
    const router = useRouter()
    const supabase = createClient()
    const [userId, setUserId] = useState<string | null>(null)
    const [tasks, setTasks] = useState<FileUploadTask[]>([])
    const [isDragging, setIsDragging] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        async function loadUser() {
            const { data: { user }, error } = await supabase.auth.getUser()
            if (error || !user) {
                console.error('Session error:', error)
                alert('Session expired — sign out and sign in again')
                router.push('/login')
                return
            }
            setUserId(user.id)
        }
        loadUser()
    }, [supabase, router])

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(true)
    }

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(false)
    }

    const sanitizeFilename = (name: string) => {
        return name.replace(/[^a-zA-Z0-9.\-_]/g, '_')
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
                sanitizedName: sanitizeFilename(file.name),
                progress: 0,
                status: 'queued'
            })
        })

        if (newTasks.length > 0) {
            setTasks(prev => [...prev, ...newTasks])
            // Automatically start uploads for new valid files
            newTasks.forEach(task => processTask(task))
        }
    }

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(false)
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            validateAndAddFiles(e.dataTransfer.files)
        }
    }

    const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            validateAndAddFiles(e.target.files)
        }
        // Reset so the same file selection triggers change again if retried via picker
        if (fileInputRef.current) fileInputRef.current.value = ''
    }

    const updateTask = (id: string, updates: Partial<FileUploadTask>) => {
        setTasks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t))
    }

    const insertDatabaseRow = async (task: FileUploadTask, storagePath: string) => {
        if (!userId) return

        updateTask(task.id, { errorMessage: undefined })

        const { error: dbError } = await supabase.from('videos').insert({
            id: task.id,
            user_id: userId,
            file_name: task.file.name,
            storage_path: storagePath,
            status: 'uploaded', // Final app state
            duration_seconds: null // Extraction out of scope for browser
        })

        if (dbError) {
            console.error(`DB Insert failed for ${task.file.name}:`, dbError)
            updateTask(task.id, {
                status: 'failed_db',
                errorMessage: 'Upload succeeded, but database save failed. Click "Save record" to retry.'
            })
        } else {
            updateTask(task.id, { status: 'success', progress: 100 })
        }
    }

    const processTask = async (task: FileUploadTask) => {
        if (!userId) {
            console.error("Cannot process task without logged in user ID")
            return
        }

        // Removed flaky navigator.onLine check

        // The RLS policy expects the file to be at the root of the user's UUID folder.
        // So the object path inside the 'videos' bucket is `[userId]/[filename]`.
        const objectPath = `${userId}/${task.id}_${task.sanitizedName}`
        const dbStoragePath = `videos/${objectPath}`

        // Check if we are retrying a DB failure
        if (task.status === 'failed_db' && task.storagePath) {
            // Just retry the DB insert
            await insertDatabaseRow(task, task.storagePath)
            return
        }

        const { data: sessionData } = await supabase.auth.getSession()
        const token = sessionData.session?.access_token

        if (!token) {
            updateTask(task.id, { status: 'failed_storage', errorMessage: 'Session expired — sign out and sign in again' })
            console.error("Missing Auth Token during upload attempt")
            return
        }

        const xhr = new XMLHttpRequest()
        updateTask(task.id, { status: 'uploading', progress: 0, errorMessage: undefined, storagePath: dbStoragePath, xhr })

        const uploadUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/videos/${objectPath}`

        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
                const percentComplete = Math.round((event.loaded / event.total) * 100)
                // Bound to 99% until fully verified by server
                updateTask(task.id, { progress: Math.min(percentComplete, 99) })
            }
        }

        xhr.onload = async () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                // Storage upload successful
                updateTask(task.id, { status: 'uploaded_storage', progress: 100 })
                await insertDatabaseRow(task, dbStoragePath)
            } else {
                // Storage upload failed
                console.error(`XHR Upload Failed [${xhr.status}]:`, xhr.responseText)

                // Handle auth explicitly
                if (xhr.status === 401 || xhr.status === 403) {
                    updateTask(task.id, { status: 'failed_storage', errorMessage: 'Session expired or forbidden. Please sign out and in again.' })
                } else if (xhr.status === 413) {
                    updateTask(task.id, { status: 'failed_storage', errorMessage: 'File too large for Supabase bucket limits (413). Check dashboard.' })
                } else {
                    updateTask(task.id, { status: 'failed_storage', errorMessage: `Storage upload failed (${xhr.status}). See console.` })
                }
            }
        }

        xhr.onerror = () => {
            updateTask(task.id, { status: 'failed_storage', errorMessage: 'Network or CORS error occurred during upload.' })
            console.error(`XHR Network Error for ${task.file.name}. Check CORS or network connection.`)
        }

        xhr.onabort = () => {
            updateTask(task.id, { status: 'cancelled', errorMessage: 'Upload cancelled' })
        }

        xhr.open('POST', uploadUrl, true)
        xhr.setRequestHeader('Authorization', `Bearer ${token}`)
        xhr.setRequestHeader('apikey', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
        xhr.setRequestHeader('Content-Type', task.file.type)
        xhr.send(task.file)
    }

    const handleRetry = (task: FileUploadTask) => {
        // If it was a storage failure or cancelled, generate new UUID to try a fresh upload
        if (task.status === 'failed_storage' || task.status === 'cancelled') {
            const resetTask = { ...task, id: uuidv4(), progress: 0, status: 'queued' as UploadStatus, errorMessage: undefined }
            setTasks(prev => prev.map(t => t.id === task.id ? resetTask : t))
            processTask(resetTask)
        } else if (task.status === 'failed_db') {
            // DB failure retry keeps original UUID and path
            processTask(task)
        }
    }

    const handleCancel = (task: FileUploadTask) => {
        if (task.xhr && task.status === 'uploading') {
            task.xhr.abort()
        }
    }

    return (
        <div className="flex min-h-screen flex-col items-center bg-gray-50 p-6">
            <div className="w-full max-w-4xl space-y-6">
                <div className="flex items-center justify-between">
                    <h1 className="text-3xl font-bold text-gray-900">Upload Videos</h1>
                    <Button variant="outline" onClick={() => router.push('/dashboard')}>Back to Dashboard</Button>
                </div>

                {/* Drag and Drop Area */}
                <div
                    className={`flex min-h-[250px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed transition-colors ${isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white hover:bg-gray-50'
                        }`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    role="button"
                    tabIndex={0}
                    aria-label="Upload video area. Drag and drop or click to select."
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click() }}
                >
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileInput}
                        accept="video/*"
                        multiple
                        className="hidden"
                    />
                    <UploadCloud className={`mb-4 h-12 w-12 ${isDragging ? 'text-blue-500' : 'text-gray-400'}`} />
                    <p className="mb-2 text-lg font-medium text-gray-700">Click to upload or drag and drop</p>
                    <p className="text-sm text-gray-500">MP4, WebM, or OGG (max 500MB per file)</p>
                </div>

                {/* Upload Queue */}
                {tasks.length > 0 && (
                    <div className="space-y-4">
                        <h2 className="text-xl font-semibold">Upload Queue</h2>
                        <div className="space-y-3">
                            {tasks.map(task => (
                                <div key={task.id} className="flex flex-col rounded-lg border bg-white p-4 shadow-sm">
                                    <div className="flex items-center justify-between mb-2">
                                        <span
                                            className="truncate font-medium text-gray-700 max-w-[50%]"
                                            title={task.file.name}
                                        >
                                            {task.file.name}
                                        </span>
                                        <div className="flex items-center gap-3">
                                            {/* Status Indicators */}
                                            {task.status === 'queued' && <span className="text-sm text-gray-500">Queued</span>}
                                            {task.status === 'uploading' && <span className="text-sm text-blue-600">Uploading... {Math.round(task.progress)}%</span>}
                                            {task.status === 'success' && <span className="flex items-center text-sm text-green-600"><CheckCircle2 className="mr-1 h-4 w-4" /> Uploaded ✓</span>}
                                            {task.status === 'failed_storage' && <span className="flex items-center text-sm text-red-600"><AlertCircle className="mr-1 h-4 w-4" /> Upload failed</span>}
                                            {task.status === 'failed_db' && <span className="flex items-center text-sm text-amber-600"><AlertCircle className="mr-1 h-4 w-4" /> Upload failed (db)</span>}
                                            {task.status === 'cancelled' && <span className="flex items-center text-sm text-gray-500"><XCircle className="mr-1 h-4 w-4" /> Cancelled</span>}

                                            {/* Action Buttons */}
                                            {task.status === 'uploading' && (
                                                <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); handleCancel(task) }} className="h-8 text-gray-500 hover:text-red-600">Cancel</Button>
                                            )}
                                            {(task.status === 'failed_storage' || task.status === 'cancelled') && (
                                                <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); handleRetry(task) }} className="h-8 gap-1"><RefreshCw className="h-3 w-3" /> Retry</Button>
                                            )}
                                            {task.status === 'failed_db' && (
                                                <Button variant="default" size="sm" onClick={(e) => { e.stopPropagation(); handleRetry(task) }} className="h-8 gap-1 bg-amber-600 hover:bg-amber-700"><RefreshCw className="h-3 w-3" /> Save record</Button>
                                            )}
                                        </div>
                                    </div>

                                    {/* Progress Bar & Error Context */}
                                    {task.status !== 'success' && task.status !== 'failed_db' && (
                                        <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100" aria-label={`Upload progress for ${task.file.name}`}>
                                            <div
                                                className={`h-full transition-all duration-300 ease-in-out ${task.status === 'failed_storage' || task.status === 'cancelled' ? 'bg-red-500' : 'bg-blue-600'}`}
                                                style={{ width: `${task.progress}%` }}
                                            />
                                        </div>
                                    )}
                                    {task.errorMessage && (
                                        <p className="mt-2 text-xs text-red-500">{task.errorMessage}</p>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
