'use client'

// /inbox — Brainstorm Inbox.
//
// Quick-capture textarea at top (Cmd/Ctrl+Enter to save, blur to autosave
// non-empty drafts). Notes list below, grouped by cluster_id when present.
// Per-note actions: expand, retag pillar, promote-to-concept, archive,
// delete. Bulk action: "group similar" runs the cluster RPC.
//
// First user-visible vNext surface that lets a creator type a thought
// and have AI sharpen it before deciding it's worth a real concept card.

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import {
    Loader2,
    Send,
    Wand2,
    Sparkles,
    Trash2,
    Archive,
    Layers,
    Inbox,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import AppLayout from '@/components/AppLayout'
import { featureFlags } from '@/lib/env'

interface Pillar {
    id: string
    name: string
    color: string
}

interface Note {
    id: string
    user_id: string
    raw_text: string
    expanded_text: string | null
    cluster_id: string | null
    pillar_id: string | null
    status: 'inbox' | 'clustered' | 'converted' | 'archived'
    converted_concept_id: string | null
    created_at: string
    updated_at: string
    // local-only
    isExpanding?: boolean
    isPromoting?: boolean
}

export default function InboxPage() {
    const router = useRouter()
    const supabase = createClient()
    const [pillars, setPillars] = useState<Pillar[]>([])
    const [notes, setNotes] = useState<Note[]>([])
    const [draft, setDraft] = useState('')
    const [isLoading, setIsLoading] = useState(true)
    const [isCapturing, setIsCapturing] = useState(false)
    const [isClustering, setIsClustering] = useState(false)
    const [toasts, setToasts] = useState<{ id: string; message: string }[]>([])

    const showToast = useCallback((message: string) => {
        const tid = Math.random().toString()
        setToasts(prev => [...prev, { id: tid, message }])
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== tid)), 3000)
    }, [])

    const getToken = useCallback(async () => {
        const { data } = await supabase.auth.getSession()
        return data.session?.access_token
    }, [supabase])

    useEffect(() => {
        const load = async () => {
            setIsLoading(true)
            const { data: pillarsData } = await supabase
                .from('pillars')
                .select('*')
                .order('created_at', { ascending: true })
            if (pillarsData) setPillars(pillarsData)

            const token = await getToken()
            if (token) {
                try {
                    const res = await fetch('/api/brainstorm', { headers: { Authorization: `Bearer ${token}` } })
                    if (res.ok) {
                        const data = await res.json()
                        if (Array.isArray(data)) setNotes(data)
                    } else if (res.status === 503) {
                        showToast('Brainstorm inbox is not enabled in this environment.')
                    }
                } catch (e) {
                    console.error('Failed to load notes:', e)
                }
            }
            setIsLoading(false)
        }
        load()
    }, [supabase, getToken, showToast])

    const captureNote = async () => {
        const text = draft.trim()
        if (!text) return
        setIsCapturing(true)
        const token = await getToken()
        try {
            const res = await fetch('/api/brainstorm', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ raw_text: text }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
            setNotes(prev => [data, ...prev])
            setDraft('')
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Capture failed'
            showToast(msg)
        } finally {
            setIsCapturing(false)
        }
    }

    const expandNote = async (note: Note) => {
        if (note.isExpanding) return
        setNotes(prev => prev.map(n => (n.id === note.id ? { ...n, isExpanding: true } : n)))
        const token = await getToken()
        try {
            const res = await fetch(`/api/brainstorm/${note.id}/expand`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error ?? 'Expand failed')
            setNotes(prev =>
                prev.map(n => (n.id === note.id ? { ...n, expanded_text: data.expanded_text, isExpanding: false } : n)),
            )
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Expand failed'
            setNotes(prev => prev.map(n => (n.id === note.id ? { ...n, isExpanding: false } : n)))
            showToast(msg)
        }
    }

    const setNotePillar = async (note: Note, pillarId: string | null) => {
        const previous = note.pillar_id
        setNotes(prev => prev.map(n => (n.id === note.id ? { ...n, pillar_id: pillarId } : n)))
        const token = await getToken()
        try {
            const res = await fetch(`/api/brainstorm/${note.id}`, {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ pillar_id: pillarId }),
            })
            if (!res.ok) {
                const data = await res.json().catch(() => ({}))
                throw new Error(data.error ?? `HTTP ${res.status}`)
            }
        } catch (err) {
            setNotes(prev => prev.map(n => (n.id === note.id ? { ...n, pillar_id: previous } : n)))
            const msg = err instanceof Error ? err.message : 'Failed to update pillar'
            showToast(msg)
        }
    }

    const archiveNote = async (note: Note) => {
        const previous = note.status
        setNotes(prev => prev.filter(n => n.id !== note.id))
        const token = await getToken()
        try {
            const res = await fetch(`/api/brainstorm/${note.id}`, {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'archived' }),
            })
            if (!res.ok) throw new Error()
            showToast('Archived')
        } catch {
            // Revert: re-fetch and restore.
            setNotes(prev => [...prev, { ...note, status: previous }])
            showToast('Failed to archive')
        }
    }

    const deleteNote = async (note: Note) => {
        if (!confirm(`Delete note: "${note.raw_text.slice(0, 60)}${note.raw_text.length > 60 ? '…' : ''}"?`)) return
        const previous = notes
        setNotes(prev => prev.filter(n => n.id !== note.id))
        const token = await getToken()
        try {
            const res = await fetch(`/api/brainstorm/${note.id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
            })
            if (!res.ok) throw new Error()
            showToast('Deleted')
        } catch {
            setNotes(previous)
            showToast('Failed to delete')
        }
    }

    const promoteNote = async (note: Note) => {
        if (!note.pillar_id) {
            showToast('Pick a pillar first.')
            return
        }
        if (note.isPromoting) return
        setNotes(prev => prev.map(n => (n.id === note.id ? { ...n, isPromoting: true } : n)))
        const token = await getToken()
        try {
            const res = await fetch(`/api/brainstorm/${note.id}/promote`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ pillar_id: note.pillar_id }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error ?? 'Promote failed')
            showToast('Promoted to draft concept ✓')
            // Update the note locally so it disappears from inbox view
            // (status='converted'), then push the user to the new concept.
            setNotes(prev =>
                prev.map(n =>
                    n.id === note.id
                        ? { ...n, status: 'converted', converted_concept_id: data.concept_id, isPromoting: false }
                        : n,
                ),
            )
            router.push(`/concepts/${data.concept_id}`)
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Promote failed'
            setNotes(prev => prev.map(n => (n.id === note.id ? { ...n, isPromoting: false } : n)))
            showToast(msg)
        }
    }

    const runCluster = async () => {
        setIsClustering(true)
        const token = await getToken()
        try {
            const res = await fetch('/api/brainstorm/cluster', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error ?? 'Cluster failed')
            showToast(`${data.clusters} cluster${data.clusters === 1 ? '' : 's'} from ${data.notes_processed} notes`)
            // Reload to get fresh cluster_ids.
            const listRes = await fetch('/api/brainstorm', { headers: { Authorization: `Bearer ${token}` } })
            if (listRes.ok) {
                const fresh = await listRes.json()
                if (Array.isArray(fresh)) setNotes(fresh)
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Cluster failed'
            showToast(msg)
        } finally {
            setIsClustering(false)
        }
    }

    if (!featureFlags.brainstormInbox()) {
        return (
            <AppLayout>
                <div className="max-w-2xl mx-auto py-24 text-center">
                    <Inbox className="h-12 w-12 mx-auto text-ink-faint mb-4" />
                    <h1 className="text-title-1 mb-3">inbox</h1>
                    <p className="text-ink-muted">
                        the brainstorm inbox is not enabled. set
                        <code className="mx-1 px-1.5 py-0.5 rounded bg-ink/[0.06] text-xs">NEXT_PUBLIC_BRAINSTORM_INBOX=true</code>
                        and{' '}
                        <code className="mx-1 px-1.5 py-0.5 rounded bg-ink/[0.06] text-xs">NEXT_PUBLIC_CONCEPT_PIPELINE=true</code>
                        in your env to unlock it.
                    </p>
                </div>
            </AppLayout>
        )
    }

    // Show only inbox + clustered (hide converted + archived from main view).
    const visible = notes.filter(n => n.status === 'inbox' || n.status === 'clustered')

    // Group by cluster_id, with singletons (cluster_id=null) at the end.
    const groups = new Map<string, Note[]>()
    const singletons: Note[] = []
    for (const n of visible) {
        if (n.cluster_id) {
            const arr = groups.get(n.cluster_id) ?? []
            arr.push(n)
            groups.set(n.cluster_id, arr)
        } else {
            singletons.push(n)
        }
    }
    // Order: clusters by oldest member created_at descending, then singletons newest first.
    const clusterEntries = Array.from(groups.entries()).sort((a, b) => {
        const ai = Math.min(...a[1].map(n => +new Date(n.created_at)))
        const bi = Math.min(...b[1].map(n => +new Date(n.created_at)))
        return bi - ai
    })
    singletons.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))

    return (
        <AppLayout>
            <div className="max-w-3xl mx-auto pb-20">
                <div className="mb-8">
                    <h1 className="text-title-1 text-ink">inbox</h1>
                    <p className="text-ink-muted text-sm mt-1">
                        rough thoughts go here. AI sharpens them. you decide which become concepts.
                    </p>
                </div>

                {/* Capture box */}
                <div className="mb-8 rounded-2xl border border-rule bg-paper-elevated p-4">
                    <textarea
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                                e.preventDefault()
                                captureNote()
                            }
                        }}
                        rows={2}
                        placeholder="drop a thought. two words is enough."
                        maxLength={2000}
                        className="w-full bg-transparent text-base outline-none resize-none placeholder:text-ink-faint"
                    />
                    <div className="flex items-center justify-between mt-2">
                        <span className="text-xs text-ink-faint">
                            {draft.length}/2000 · ⌘↵ to save
                        </span>
                        <Button
                            onClick={captureNote}
                            disabled={isCapturing || !draft.trim()}
                            className="rounded-full bg-ink text-paper hover:bg-ink/90 px-5"
                        >
                            {isCapturing ? (
                                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> saving</>
                            ) : (
                                <><Send className="mr-2 h-4 w-4" /> capture</>
                            )}
                        </Button>
                    </div>
                </div>

                {/* Toolbar: cluster, count */}
                <div className="flex items-center justify-between mb-4">
                    <span className="text-sm text-ink-muted">
                        {visible.length} note{visible.length === 1 ? '' : 's'}
                    </span>
                    {visible.length >= 2 && (
                        <Button
                            onClick={runCluster}
                            disabled={isClustering}
                            variant="outline"
                            className="rounded-full text-xs"
                        >
                            {isClustering ? (
                                <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> grouping…</>
                            ) : (
                                <><Layers className="mr-2 h-3.5 w-3.5" /> group similar</>
                            )}
                        </Button>
                    )}
                </div>

                {/* Empty state */}
                {!isLoading && visible.length === 0 && (
                    <div className="py-16 text-center">
                        <Inbox className="h-12 w-12 mx-auto text-ink-faint mb-3" />
                        <h3 className="text-title-3 mb-2">empty inbox</h3>
                        <p className="text-ink-muted text-sm max-w-sm mx-auto">
                            type rough thoughts above. the AI will help sharpen them and you can promote the good
                            ones into draft concepts.
                        </p>
                    </div>
                )}

                {/* Loading skeleton */}
                {isLoading &&
                    Array.from({ length: 3 }).map((_, i) => (
                        <div key={`l-${i}`} className="h-24 rounded-xl bg-paper-sunken animate-pulse mb-3" />
                    ))}

                {/* Cluster groups */}
                {clusterEntries.map(([clusterId, arr]) => (
                    <div key={clusterId} className="mb-6">
                        <div className="flex items-center gap-2 mb-2">
                            <Layers className="h-3.5 w-3.5 text-ink-faint" />
                            <span className="text-xs font-medium text-ink-muted uppercase tracking-wide">
                                related ({arr.length})
                            </span>
                        </div>
                        <div className="space-y-2 border-l-2 border-rule pl-4">
                            {arr.map(n => (
                                <NoteCard
                                    key={n.id}
                                    note={n}
                                    pillars={pillars}
                                    onExpand={() => expandNote(n)}
                                    onSetPillar={pid => setNotePillar(n, pid)}
                                    onPromote={() => promoteNote(n)}
                                    onArchive={() => archiveNote(n)}
                                    onDelete={() => deleteNote(n)}
                                />
                            ))}
                        </div>
                    </div>
                ))}

                {/* Singletons */}
                {singletons.length > 0 && clusterEntries.length > 0 && (
                    <div className="text-xs font-medium text-ink-muted uppercase tracking-wide mt-6 mb-2">
                        unclustered
                    </div>
                )}
                <div className="space-y-2">
                    {singletons.map(n => (
                        <NoteCard
                            key={n.id}
                            note={n}
                            pillars={pillars}
                            onExpand={() => expandNote(n)}
                            onSetPillar={pid => setNotePillar(n, pid)}
                            onPromote={() => promoteNote(n)}
                            onArchive={() => archiveNote(n)}
                            onDelete={() => deleteNote(n)}
                        />
                    ))}
                </div>
            </div>

            {/* Toasts */}
            <div className="fixed bottom-6 right-6 flex flex-col gap-2 z-50 pointer-events-none">
                {toasts.map(t => (
                    <div key={t.id} className="bg-ink text-paper px-4 py-3 rounded-xl shadow-xl text-sm font-medium animate-in slide-in-from-bottom-5 fade-in pointer-events-auto">
                        {t.message}
                    </div>
                ))}
            </div>
        </AppLayout>
    )
}

interface NoteCardProps {
    note: Note
    pillars: Pillar[]
    onExpand: () => void
    onSetPillar: (id: string | null) => void
    onPromote: () => void
    onArchive: () => void
    onDelete: () => void
}

function NoteCard({ note, pillars, onExpand, onSetPillar, onPromote, onArchive, onDelete }: NoteCardProps) {
    const pillar = pillars.find(p => p.id === note.pillar_id) ?? null

    return (
        <div className="rounded-xl border border-rule bg-paper-elevated p-4">
            <p className="text-base text-ink whitespace-pre-wrap leading-relaxed">{note.raw_text}</p>

            {note.expanded_text && (
                <div className="mt-3 rounded-lg bg-paper-sunken px-3 py-2">
                    <span className="text-[10px] font-semibold block mb-1 text-ink-faint uppercase tracking-wide">sharpened</span>
                    <p className="text-sm text-ink-muted leading-relaxed">{note.expanded_text}</p>
                </div>
            )}

            {/* Action row */}
            <div className="mt-3 flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                    {!note.expanded_text && (
                        <button
                            onClick={onExpand}
                            disabled={note.isExpanding}
                            className="text-xs font-medium text-ink-muted hover:text-ink transition-colors flex items-center gap-1"
                        >
                            {note.isExpanding ? (
                                <><Loader2 className="h-3 w-3 animate-spin" /> sharpening</>
                            ) : (
                                <><Wand2 className="h-3 w-3" /> sharpen</>
                            )}
                        </button>
                    )}
                    {/* Pillar selector */}
                    <select
                        value={note.pillar_id ?? ''}
                        onChange={e => onSetPillar(e.target.value || null)}
                        className="text-xs bg-ink/[0.04] hover:bg-ink/[0.08] rounded-md px-2 py-1 outline-none border-none text-ink-muted"
                    >
                        <option value="">no pillar</option>
                        {pillars.map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                    </select>
                    {pillar && (
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-ink/[0.06] text-ink-muted">
                            {pillar.name}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    <Button
                        onClick={onPromote}
                        disabled={note.isPromoting || !note.pillar_id}
                        variant="outline"
                        className="rounded-full text-xs h-8 px-3"
                        title={note.pillar_id ? 'Promote to draft concept (1 Groq call)' : 'Pick a pillar first'}
                    >
                        {note.isPromoting ? (
                            <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> promoting</>
                        ) : (
                            <><Sparkles className="mr-1 h-3 w-3" /> to concept</>
                        )}
                    </Button>
                    <button
                        onClick={onArchive}
                        className="p-1.5 text-ink-faint hover:text-ink hover:bg-ink/[0.06] rounded-md transition-colors"
                        title="Archive"
                    >
                        <Archive className="h-3.5 w-3.5" />
                    </button>
                    <button
                        onClick={onDelete}
                        className="p-1.5 text-ink-faint hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                        title="Delete"
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                    </button>
                </div>
            </div>
        </div>
    )
}
