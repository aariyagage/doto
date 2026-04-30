'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { UploadCloud, CheckCircle2, AlertCircle, RefreshCw, X, Loader2, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import AppLayout, { getPairedTextColor } from '@/components/AppLayout'
import { useUpload, type UploadStatus } from '@/components/upload-context'

const activeSteps: UploadStatus[] = ['extract_audio', 'uploading', 'chunk_audio', 'transcribe', 'save_transcript', 'analyze', 'pillars_ready']

export default function UploadPage() {
    const router = useRouter()
    const { tasks, completedCount, addFiles, retryTask, cancelTask } = useUpload()
    const [isDragging, setIsDragging] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(true)
    }

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(false)
    }

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(false)
        if (e.dataTransfer.files?.length) {
            addFiles(e.dataTransfer.files)
        }
    }

    const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.length) {
            addFiles(e.target.files)
        }
        if (fileInputRef.current) fileInputRef.current.value = ''
    }

    return (
        <AppLayout>
            <div className="flex-1 flex flex-col overflow-hidden w-full relative">
                <main className="flex-1 w-full">
                    <div className="w-full max-w-4xl mx-auto space-y-6">
                        <div className="flex items-center justify-between mb-8">
                            <h1 className="text-3xl md:text-[34px] font-semibold tracking-tight text-[var(--text-primary)]">Upload videos</h1>
                            <Button variant="outline" onClick={() => router.push('/dashboard')} className="border-[var(--border-manila)] bg-transparent text-[var(--text-primary)] font-medium">Back to dashboard</Button>
                        </div>

                        <div
                            className={`flex min-h-[300px] cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed transition-all duration-300 ${isDragging ? 'border-[var(--combo-3-bg)] bg-[var(--combo-3-bg)]/10' : 'border-[var(--border-manila)] bg-[var(--bg-panel-strong)] hover:border-[var(--combo-3-bg)] hover:bg-[var(--combo-3-bg)]/5'}`}
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={handleDrop}
                            onClick={() => fileInputRef.current?.click()}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault()
                                    fileInputRef.current?.click()
                                }
                            }}
                            role="button"
                            tabIndex={0}
                            aria-label="Upload videos: drag files here or press Enter to browse"
                        >
                            <input type="file" ref={fileInputRef} onChange={handleFileInput} accept="video/*" multiple className="hidden" />
                            <UploadCloud className={`mb-4 h-12 w-12 transition-colors duration-300 ${isDragging ? 'text-[var(--combo-3-bg)]' : 'text-[var(--text-primary)]/30'}`} strokeWidth={1.5} />
                            <p className="mb-2 text-base font-medium text-[var(--text-primary)]">Drag videos here, or click to browse</p>
                            <p className="text-sm text-[var(--text-primary)]/55">MP4, WebM, or MOV &mdash; up to 500MB per file</p>
                        </div>

                        <p className="text-sm text-[var(--text-primary)]/50 text-center">Videos are processed one at a time to ensure quality. Uploads continue if you switch tabs.</p>

                        {completedCount > 0 && (
                            <div className="text-center text-base text-[var(--text-primary)]/65 mt-2">
                                {completedCount === 1 && "1 video analyzed \u00b7 add 1 more to discover your pillars"}
                                {completedCount === 2 && "2 videos analyzed \u00b7 your first pillars are being discovered"}
                                {(completedCount >= 3 && completedCount <= 4) && `${completedCount} videos analyzed \u00b7 good coverage`}
                                {completedCount >= 5 && `${completedCount} videos analyzed \u00b7 great coverage`}
                            </div>
                        )}

                        {tasks.length > 0 && (
                            <div className="space-y-4">
                                {tasks.map(task => (
                                    <div key={task.id} className="relative flex flex-col rounded-2xl border border-[var(--border-manila)] bg-[var(--bg-panel-strong)] p-6 shadow-sm">
                                        <div className="flex items-center justify-between mb-8">
                                            <span className="truncate font-medium text-[var(--text-primary)] max-w-[50%]" title={task.file.name}>
                                                {task.file.name}
                                            </span>
                                            <span className="text-xs font-medium text-[var(--text-primary)]/45">{(task.file.size / (1024 * 1024)).toFixed(1)} MB</span>

                                            <div className="absolute top-4 right-4 flex items-center gap-2">
                                                {(task.status === 'error' || task.status === 'cancelled') && (
                                                    <Button variant="outline" size="sm" onClick={() => retryTask(task.id)} className="h-8 gap-1 border-[var(--border-manila)]"><RefreshCw className="h-3 w-3" /> Retry</Button>
                                                )}
                                                {task.status !== 'done' && (
                                                    <Button variant="ghost" size="sm" onClick={() => cancelTask(task.id)} className="h-8 w-8 p-0 text-[var(--text-primary)]/40 hover:text-[var(--combo-6-bg)]"><X className="h-4 w-4" /></Button>
                                                )}
                                            </div>
                                        </div>

                                        <div className="flex justify-between relative px-2 mb-2">
                                            <div className="absolute top-3 left-0 w-full h-0.5 bg-[var(--border-manila-soft)] -z-10" />
                                            {['Audio', 'Upload', 'Chunk', 'Transcribe', 'Save DB', 'Analyze', 'Pillars', 'Done'].map((step, idx) => {
                                                const stepKeys: UploadStatus[] = ['extract_audio', 'uploading', 'chunk_audio', 'transcribe', 'save_transcript', 'analyze', 'pillars_ready', 'done']
                                                const currentStepIdx = stepKeys.indexOf(task.status)

                                                let adjustedCurrentIdx = currentStepIdx
                                                if (task.status === 'transcribe' && idx === stepKeys.indexOf('chunk_audio')) {
                                                    adjustedCurrentIdx = stepKeys.indexOf('transcribe')
                                                }

                                                let statusColor = 'border-[var(--border-manila)] bg-[var(--bg-panel-strong)] text-[var(--text-primary)]/30'
                                                if (task.status === 'error' || task.status === 'cancelled') {
                                                    if (adjustedCurrentIdx === idx) {
                                                        statusColor = 'border-[var(--combo-6-bg)] bg-[var(--bg-panel-strong)] text-[var(--combo-6-bg)]'
                                                    } else if (adjustedCurrentIdx > idx) {
                                                        statusColor = 'border-[var(--combo-6-bg)]/40 bg-[var(--combo-6-bg)]/15 text-[var(--combo-6-bg)]/70'
                                                    }
                                                } else if (adjustedCurrentIdx > idx || task.status === 'done') {
                                                    statusColor = 'border-[var(--combo-3-bg)] bg-[var(--combo-3-bg)] text-[var(--combo-3-text)]'
                                                } else if (adjustedCurrentIdx === idx) {
                                                    statusColor = 'border-[var(--combo-3-bg)] bg-[var(--bg-panel-strong)] text-[var(--combo-3-bg)]'
                                                }

                                                return (
                                                    <div key={step} className="flex flex-col items-center gap-2 bg-[var(--bg-panel-strong)] px-2">
                                                        <div className={`flex h-6 w-6 items-center justify-center rounded-full border-2 ${statusColor}`}>
                                                            {(adjustedCurrentIdx > idx || task.status === 'done' || (task.status === 'error' && adjustedCurrentIdx > idx)) ? <CheckCircle2 className="h-4 w-4" /> :
                                                                (adjustedCurrentIdx === idx && activeSteps.includes(task.status)) ? <Loader2 className="h-3 w-3 animate-spin" /> :
                                                                    (adjustedCurrentIdx === idx && (task.status === 'error' || task.status === 'cancelled')) ? <AlertCircle className="h-4 w-4" /> :
                                                                        <div className="h-2 w-2 rounded-full bg-current" />}
                                                        </div>
                                                        <span className={`text-[10px] font-medium ${adjustedCurrentIdx >= idx ? 'text-[var(--text-primary)]' : 'text-[var(--text-primary)]/40'}`}>{step}</span>
                                                    </div>
                                                )
                                            })}
                                        </div>

                                        {task.errorMessage && (
                                            <div role="alert" className="mt-4 flex items-center text-sm text-[var(--combo-6-bg)] font-medium">
                                                <AlertCircle className="mr-2 h-4 w-4" />
                                                {task.errorMessage}
                                            </div>
                                        )}

                                        {task.transcript && (
                                            <div className="mt-6 rounded-2xl bg-[var(--bg-primary)] p-4 border border-[var(--border-manila-soft)] text-sm text-[var(--text-primary)] relative">
                                                <div className="flex items-center justify-between mb-4">
                                                    <div className="flex items-center gap-3">
                                                        <h4 className="text-sm font-semibold tracking-tight text-[var(--text-primary)] flex items-center gap-2">
                                                            <CheckCircle2 className="h-4 w-4 text-[var(--combo-3-bg)]" />
                                                            Extracted transcript
                                                        </h4>
                                                        {(task.pillars && task.pillars.length > 0) ? (
                                                            <div className="flex gap-1.5 ml-2">
                                                                {task.pillars.map(p => (
                                                                    <span key={p.id} style={{ backgroundColor: p.color, color: getPairedTextColor(p.color) }} className="text-[10px] font-medium px-2 py-0.5 rounded">
                                                                        {p.name}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        ) : (
                                                            <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-[var(--text-primary)]/[0.06] text-[var(--text-primary)]/60 ml-2 flex items-center gap-1">
                                                                Uncategorized
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-4 text-xs font-medium text-[var(--text-primary)]/50">
                                                        <span>{task.wordCount || 0} words</span>
                                                        <Button variant="outline" size="sm" className="h-7 text-xs border-[var(--border-manila)]" onClick={() => navigator.clipboard.writeText(task.transcript || "")}>
                                                            <Copy className="h-3 w-3 mr-1" /> Copy
                                                        </Button>
                                                    </div>
                                                </div>
                                                <div className="max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                                                    <p className="whitespace-pre-wrap leading-relaxed text-sm text-[var(--text-primary)]/75">{task.transcript}</p>
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
