'use client'

import { useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
    open: boolean
    onClose: () => void
    videoId: string
    videoTitle?: string
    onSuccess: () => void
}

export default function PillarSeriesDeclareModal({ open, onClose, videoId, videoTitle, onSuccess }: Props) {
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    if (!open) return null

    const reset = () => {
        setName('')
        setDescription('')
        setError(null)
        setSubmitting(false)
    }

    const close = () => {
        reset()
        onClose()
    }

    const submit = async () => {
        const trimmedName = name.trim()
        if (!trimmedName) {
            setError('Series name is required.')
            return
        }
        setSubmitting(true)
        setError(null)
        try {
            const res = await fetch('/api/pillars/series', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: trimmedName,
                    description: description.trim() || undefined,
                    video_ids: [videoId],
                }),
            })
            if (!res.ok) {
                const data = await res.json().catch(() => ({}))
                throw new Error(data.error || 'Failed to declare series')
            }
            onSuccess()
            close()
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to declare series')
            setSubmitting(false)
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={close}>
            <div
                className="bg-[var(--bg-panel)] rounded-2xl shadow-2xl w-full max-w-md p-6 relative"
                onClick={(e) => e.stopPropagation()}
            >
                <button
                    onClick={close}
                    className="absolute top-4 right-4 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                    aria-label="Close"
                >
                    <X className="h-5 w-5" />
                </button>

                <h2 className="text-lg font-semibold tracking-tight text-[var(--text-primary)] mb-1">Declare a series</h2>
                <p className="text-sm text-[var(--muted-foreground)] mb-4">
                    {videoTitle ? <>Mark <span className="font-medium text-[var(--text-primary)]">{videoTitle}</span> as part of a recurring series.</> : 'Mark this video as part of a recurring series.'}
                    {' '}A pillar will be created for the series so future episodes can be tagged automatically.
                </p>

                <label className="block text-sm font-medium text-[var(--text-primary)] mb-1.5">
                    Series name
                </label>
                <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Thought Daughter Diaries"
                    maxLength={60}
                    autoFocus
                    className="w-full mb-4 px-3 py-2 rounded-lg border border-[var(--border-manila)] bg-[var(--bg-panel)] text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--text-primary)]/20 focus:border-[var(--text-primary)]/40"
                />

                <label className="block text-sm font-medium text-[var(--text-primary)] mb-1.5">
                    Description <span className="font-normal text-[var(--muted-foreground)]">(optional)</span>
                </label>
                <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What is this series about?"
                    rows={3}
                    className="w-full mb-4 px-3 py-2 rounded-lg border border-[var(--border-manila)] bg-[var(--bg-panel)] text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--text-primary)]/20 focus:border-[var(--text-primary)]/40 resize-none"
                />

                {error && (
                    <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>
                )}

                <div className="flex justify-end gap-2">
                    <button
                        onClick={close}
                        disabled={submitting}
                        className="px-4 py-2 rounded-lg text-sm font-medium text-[var(--text-primary)]/70 hover:bg-[var(--text-primary)]/[0.04]"
                    >
                        Cancel
                    </button>
                    <Button
                        onClick={submit}
                        disabled={submitting || !name.trim()}
                        className="bg-[var(--text-primary)] text-[var(--bg-primary)] hover:opacity-90 transition-opacity font-medium rounded-lg px-4 py-2"
                    >
                        {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Declaring…</> : 'Declare series'}
                    </Button>
                </div>
            </div>
        </div>
    )
}
