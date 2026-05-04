'use client'

// /concepts/[id] — Concept detail.
//
// Shows the full concept (original + voice-adapted side-by-side), score
// breakdown, ai_reason, structure, and the events timeline read from
// concept_events. Edits to title/hook are inline; status changes use the
// same transitionStatus pattern as the library page.

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
    Loader2,
    ArrowLeft,
    Star,
    Wand2,
    Save,
    X,
    Archive,
    Check,
    Trash2,
    Clock,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import AppLayout from '@/components/AppLayout'
import { featureFlags } from '@/lib/env'

interface ConceptScore {
    novelty: number
    fit: number
    specificity: number
    composite: number
}

interface Concept {
    id: string
    user_id: string
    pillar_id: string | null
    title: string
    hook: string | null
    angle: string | null
    structure: unknown
    research_summary: string | null
    ai_reason: string | null
    score: ConceptScore | null
    voice_adapted_title: string | null
    voice_adapted_hook: string | null
    voice_adapted_text: string | null
    status: 'draft' | 'reviewed' | 'saved' | 'used' | 'rejected' | 'archived'
    source_kind: string
    source_content_idea_id: string | null
    pipeline_run_id: string | null
    created_at: string
    saved_at: string | null
    used_at: string | null
    pillars?: { id: string; name: string; color: string }
}

interface ConceptEvent {
    id: number
    event_type: string
    from_status: string | null
    to_status: string | null
    metadata: unknown
    created_at: string
}

export default function ConceptDetailPage() {
    const params = useParams()
    const router = useRouter()
    const id = (params?.id as string) ?? ''
    const supabase = createClient()

    const [concept, setConcept] = useState<Concept | null>(null)
    const [events, setEvents] = useState<ConceptEvent[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [editingTitle, setEditingTitle] = useState(false)
    const [editingHook, setEditingHook] = useState(false)
    const [titleDraft, setTitleDraft] = useState('')
    const [hookDraft, setHookDraft] = useState('')
    const [isSaving, setIsSaving] = useState(false)
    const [isStyling, setIsStyling] = useState(false)
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

    const load = useCallback(async () => {
        setIsLoading(true)
        setError(null)
        const token = await getToken()
        if (!token) {
            setError('Not authenticated')
            setIsLoading(false)
            return
        }
        try {
            const res = await fetch(`/api/concepts/${id}`, {
                headers: { Authorization: `Bearer ${token}` },
            })
            if (res.status === 404) {
                setError('Concept not found.')
                setIsLoading(false)
                return
            }
            if (!res.ok) {
                const body = await res.json().catch(() => ({}))
                throw new Error(body.error ?? `HTTP ${res.status}`)
            }
            const data = await res.json()
            setConcept(data.concept)
            setEvents(data.events ?? [])
            setTitleDraft(data.concept?.title ?? '')
            setHookDraft(data.concept?.hook ?? '')
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Load failed'
            setError(msg)
        } finally {
            setIsLoading(false)
        }
    }, [getToken, id])

    useEffect(() => {
        if (id) load()
    }, [id, load])

    const saveEdit = async (field: 'title' | 'hook') => {
        if (!concept) return
        const value = field === 'title' ? titleDraft.trim() : hookDraft.trim()
        if (field === 'title' && !value) {
            showToast('Title cannot be empty.')
            setTitleDraft(concept.title)
            setEditingTitle(false)
            return
        }
        const previousVal = field === 'title' ? concept.title : (concept.hook ?? '')
        if (value === previousVal) {
            if (field === 'title') setEditingTitle(false)
            else setEditingHook(false)
            return
        }
        setIsSaving(true)
        const token = await getToken()
        try {
            const res = await fetch(`/api/concepts/${concept.id}`, {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ [field]: value }),
            })
            if (!res.ok) {
                const body = await res.json().catch(() => ({}))
                throw new Error(body.error ?? `HTTP ${res.status}`)
            }
            const updated = await res.json()
            setConcept(prev => (prev ? { ...prev, ...updated } : prev))
            if (field === 'title') setEditingTitle(false)
            else setEditingHook(false)
            showToast('Saved')
            // Refresh events to pick up the 'edited' row.
            load()
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Save failed'
            showToast(msg)
        } finally {
            setIsSaving(false)
        }
    }

    const transitionStatus = async (to: Concept['status']) => {
        if (!concept) return
        const previous = concept.status
        setConcept(prev => (prev ? { ...prev, status: to } : prev))
        const token = await getToken()
        try {
            const res = await fetch(`/api/concepts/${concept.id}`, {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ status: to }),
            })
            if (!res.ok) {
                const body = await res.json().catch(() => ({}))
                throw new Error(body.error ?? `HTTP ${res.status}`)
            }
            const updated = await res.json()
            setConcept(prev => (prev ? { ...prev, ...updated } : prev))
            const verb =
                to === 'saved' ? 'Saved'
                : to === 'used' ? 'Marked used'
                : to === 'reviewed' ? 'Marked reviewed'
                : to === 'rejected' ? 'Rejected'
                : to === 'archived' ? 'Archived'
                : 'Restored to draft'
            showToast(verb)
            load()
        } catch (err) {
            setConcept(prev => (prev ? { ...prev, status: previous } : prev))
            const msg = err instanceof Error ? err.message : 'Status change failed'
            showToast(msg)
        }
    }

    const styleNow = async () => {
        if (!concept) return
        if (concept.voice_adapted_text) return
        setIsStyling(true)
        const token = await getToken()
        try {
            const res = await fetch(`/api/concepts/${concept.id}/style`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error ?? 'Style failed')
            setConcept(prev =>
                prev
                    ? {
                          ...prev,
                          voice_adapted_title: data.voice_adapted_title ?? null,
                          voice_adapted_hook: data.voice_adapted_hook ?? null,
                          voice_adapted_text: data.voice_adapted_text ?? null,
                      }
                    : prev,
            )
            if (data.no_voice_profile) showToast('No voice profile yet.')
            else if (data.already_styled) showToast('Already styled.')
            else showToast('Voice-adapted ✓')
            load()
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Style failed'
            showToast(msg)
        } finally {
            setIsStyling(false)
        }
    }

    const deletePermanent = async () => {
        if (!concept) return
        if (!confirm(`Delete "${concept.title}" permanently?`)) return
        const token = await getToken()
        try {
            const res = await fetch(`/api/concepts/${concept.id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
            })
            if (!res.ok) throw new Error()
            showToast('Concept deleted')
            router.push('/concepts')
        } catch {
            showToast('Failed to delete concept')
        }
    }

    if (!featureFlags.conceptPipeline()) {
        return (
            <AppLayout>
                <div className="max-w-2xl mx-auto py-24 text-center">
                    <h1 className="text-title-1 mb-3">concepts</h1>
                    <p className="text-ink-muted">
                        feature disabled. set <code className="px-1 bg-ink/[0.06] rounded">NEXT_PUBLIC_CONCEPT_PIPELINE=true</code>.
                    </p>
                </div>
            </AppLayout>
        )
    }

    if (isLoading) {
        return (
            <AppLayout>
                <div className="max-w-3xl mx-auto py-24 flex items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-ink-muted" />
                </div>
            </AppLayout>
        )
    }

    if (error || !concept) {
        return (
            <AppLayout>
                <div className="max-w-2xl mx-auto py-24 text-center">
                    <h1 className="text-title-2 mb-3">{error ?? 'Not found'}</h1>
                    <Button onClick={() => router.push('/concepts')} variant="outline" className="rounded-full">
                        <ArrowLeft className="mr-2 h-4 w-4" /> back to concepts
                    </Button>
                </div>
            </AppLayout>
        )
    }

    const composite = concept.score?.composite ?? null
    const compositePct = composite != null ? Math.round(composite * 100) : null

    return (
        <AppLayout>
            <div className="max-w-3xl mx-auto pb-20">
                {/* Top bar */}
                <div className="flex items-center justify-between mb-8">
                    <button
                        onClick={() => router.push('/concepts')}
                        className="flex items-center gap-2 text-ink-muted hover:text-ink text-sm transition-colors"
                    >
                        <ArrowLeft className="h-4 w-4" /> back to concepts
                    </button>
                    <div className="flex items-center gap-2">
                        {concept.pillars && (
                            <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-ink/[0.06] text-ink-muted">
                                {concept.pillars.name}
                            </span>
                        )}
                        <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-ink/[0.04] text-ink-faint">
                            {concept.status}
                        </span>
                        {compositePct != null && (
                            <span
                                className="text-xs font-mono font-medium px-2 py-1 rounded-full bg-ink/[0.04] text-ink-faint"
                                title={`novelty ${concept.score?.novelty?.toFixed(2)} · fit ${concept.score?.fit?.toFixed(2)} · specificity ${concept.score?.specificity?.toFixed(2)}`}
                            >
                                {compositePct}%
                            </span>
                        )}
                    </div>
                </div>

                {/* Title (edit-in-place) */}
                <div className="mb-6">
                    <span className="text-[11px] font-semibold block mb-2 text-ink-faint uppercase tracking-wide">title</span>
                    {editingTitle ? (
                        <div className="flex items-center gap-2">
                            <input
                                type="text"
                                value={titleDraft}
                                onChange={e => setTitleDraft(e.target.value)}
                                autoFocus
                                onKeyDown={e => {
                                    if (e.key === 'Enter') saveEdit('title')
                                    if (e.key === 'Escape') {
                                        setTitleDraft(concept.title)
                                        setEditingTitle(false)
                                    }
                                }}
                                className="flex-1 text-2xl font-semibold tracking-tight bg-transparent border-b border-rule outline-none focus:border-ink py-1"
                            />
                            <button onClick={() => saveEdit('title')} disabled={isSaving} className="p-1.5 text-blue-600 hover:text-blue-700">
                                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                            </button>
                            <button
                                onClick={() => {
                                    setTitleDraft(concept.title)
                                    setEditingTitle(false)
                                }}
                                className="p-1.5 text-ink-muted hover:text-ink"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                    ) : (
                        <h1
                            className="text-3xl md:text-4xl font-semibold tracking-tight leading-tight cursor-pointer hover:bg-ink/[0.03] rounded-md px-1 -mx-1 transition-colors"
                            onClick={() => setEditingTitle(true)}
                            title="Click to edit"
                        >
                            {concept.title}
                        </h1>
                    )}
                    {concept.voice_adapted_title && concept.voice_adapted_title !== concept.title && (
                        <p className="text-sm text-ink-muted mt-2 italic">
                            in your voice: <span className="text-ink">&ldquo;{concept.voice_adapted_title}&rdquo;</span>
                        </p>
                    )}
                </div>

                {/* Hook */}
                <div className="mb-6">
                    <span className="text-[11px] font-semibold block mb-2 text-ink-faint uppercase tracking-wide">hook</span>
                    {editingHook ? (
                        <div className="flex items-start gap-2">
                            <textarea
                                value={hookDraft}
                                onChange={e => setHookDraft(e.target.value)}
                                autoFocus
                                rows={2}
                                onKeyDown={e => {
                                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveEdit('hook')
                                    if (e.key === 'Escape') {
                                        setHookDraft(concept.hook ?? '')
                                        setEditingHook(false)
                                    }
                                }}
                                className="flex-1 text-base bg-transparent border border-rule rounded-md p-2 outline-none focus:border-ink resize-none"
                            />
                            <div className="flex flex-col gap-1">
                                <button onClick={() => saveEdit('hook')} disabled={isSaving} className="p-1.5 text-blue-600 hover:text-blue-700">
                                    {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                </button>
                                <button
                                    onClick={() => {
                                        setHookDraft(concept.hook ?? '')
                                        setEditingHook(false)
                                    }}
                                    className="p-1.5 text-ink-muted hover:text-ink"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                        </div>
                    ) : concept.hook ? (
                        <p
                            className="text-lg cursor-pointer hover:bg-ink/[0.03] rounded-md px-1 -mx-1 transition-colors"
                            onClick={() => setEditingHook(true)}
                            title="Click to edit"
                        >
                            &ldquo;{concept.hook}&rdquo;
                        </p>
                    ) : (
                        <p
                            className="text-base text-ink-muted italic cursor-pointer hover:bg-ink/[0.03] rounded-md px-1 -mx-1 transition-colors"
                            onClick={() => setEditingHook(true)}
                        >
                            (no hook — click to add)
                        </p>
                    )}
                    {concept.voice_adapted_hook && concept.voice_adapted_hook !== concept.hook && (
                        <p className="text-sm text-ink-muted mt-2 italic">
                            in your voice: <span className="text-ink">&ldquo;{concept.voice_adapted_hook}&rdquo;</span>
                        </p>
                    )}
                </div>

                {/* Voice-adapted text or apply-voice CTA */}
                {concept.voice_adapted_text ? (
                    <div className="mb-6 rounded-2xl bg-paper-sunken p-5">
                        <span className="text-[11px] font-semibold block mb-2 text-ink-faint uppercase tracking-wide">in your voice</span>
                        <p className="text-base leading-relaxed">{concept.voice_adapted_text}</p>
                    </div>
                ) : (
                    <div className="mb-6">
                        <Button onClick={styleNow} disabled={isStyling} variant="outline" className="rounded-full">
                            {isStyling ? (
                                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> styling…</>
                            ) : (
                                <><Wand2 className="mr-2 h-4 w-4" /> apply your voice (1 model call)</>
                            )}
                        </Button>
                        <p className="text-xs text-ink-muted mt-2">
                            tail concepts skip voice styling at generation time to save tokens. click to run pass 3 now.
                        </p>
                    </div>
                )}

                {/* Angle, ai_reason, structure, scores */}
                {(concept.angle || concept.ai_reason || concept.score || concept.structure || concept.research_summary) && (
                    <div className="mb-6 space-y-5 rounded-2xl border border-rule p-5">
                        {concept.angle && (
                            <div>
                                <span className="text-[11px] font-semibold block mb-2 text-ink-faint uppercase tracking-wide">angle</span>
                                <p className="text-sm leading-relaxed text-ink-muted">{concept.angle}</p>
                            </div>
                        )}
                        {concept.ai_reason && (
                            <div>
                                <span className="text-[11px] font-semibold block mb-2 text-ink-faint uppercase tracking-wide">why this is novel</span>
                                <p className="text-sm leading-relaxed text-ink-muted">{concept.ai_reason}</p>
                            </div>
                        )}
                        {concept.research_summary && (
                            <div>
                                <span className="text-[11px] font-semibold block mb-2 text-ink-faint uppercase tracking-wide">research</span>
                                <p className="text-sm leading-relaxed text-ink-muted">{concept.research_summary}</p>
                            </div>
                        )}
                        {concept.structure ? (() => {
                            // Render PASS 1's {format, beats[]} jsonb readably.
                            // Fall back to compact JSON only for unexpected shapes.
                            const s = concept.structure as { format?: unknown; beats?: unknown };
                            const beats = Array.isArray(s.beats)
                                ? (s.beats.filter(b => typeof b === 'string') as string[])
                                : [];
                            const format = typeof s.format === 'string' ? s.format : null;
                            const knownShape = beats.length > 0 || format;
                            return (
                                <div>
                                    <span className="text-[11px] font-semibold block mb-2 text-ink-faint uppercase tracking-wide">how this video runs</span>
                                    {knownShape ? (
                                        <div className="text-sm space-y-2 text-ink">
                                            {format && (
                                                <p>
                                                    <span className="text-ink-muted">format · </span>
                                                    {format}
                                                </p>
                                            )}
                                            {beats.length > 0 && (
                                                <ol className="space-y-1 list-decimal list-inside marker:text-ink-muted">
                                                    {beats.map((b, i) => (
                                                        <li key={i} className="leading-relaxed">{b}</li>
                                                    ))}
                                                </ol>
                                            )}
                                        </div>
                                    ) : (
                                        <pre className="text-xs leading-relaxed font-mono whitespace-pre-wrap text-ink-muted">
                                            {JSON.stringify(concept.structure, null, 2)}
                                        </pre>
                                    )}
                                </div>
                            );
                        })() : null}
                    </div>
                )}

                {/* Status actions. Renders the legal next-states only. */}
                <div className="mb-8 flex flex-wrap gap-2">
                    {concept.status === 'draft' && (
                        <>
                            <Button onClick={() => transitionStatus('reviewed')} variant="outline" className="rounded-full">
                                <Check className="mr-2 h-4 w-4" /> mark reviewed
                            </Button>
                            <Button onClick={() => transitionStatus('saved')} variant="outline" className="rounded-full">
                                <Star className="mr-2 h-4 w-4" /> save
                            </Button>
                        </>
                    )}
                    {concept.status === 'reviewed' && (
                        <Button onClick={() => transitionStatus('saved')} variant="outline" className="rounded-full">
                            <Star className="mr-2 h-4 w-4" /> save
                        </Button>
                    )}
                    {concept.status === 'saved' && (
                        <Button onClick={() => transitionStatus('used')} variant="outline" className="rounded-full">
                            <Check className="mr-2 h-4 w-4" /> mark used
                        </Button>
                    )}
                    {(concept.status === 'rejected' || concept.status === 'archived') && (
                        <Button onClick={() => transitionStatus('draft')} variant="outline" className="rounded-full">
                            restore to draft
                        </Button>
                    )}
                    {concept.status !== 'rejected' && concept.status !== 'archived' && concept.status !== 'used' && (
                        <Button onClick={() => transitionStatus('rejected')} variant="outline" className="rounded-full text-red-600 border-red-200 hover:bg-red-50">
                            <X className="mr-2 h-4 w-4" /> reject
                        </Button>
                    )}
                    {concept.status !== 'archived' && (
                        <Button onClick={() => transitionStatus('archived')} variant="outline" className="rounded-full">
                            <Archive className="mr-2 h-4 w-4" /> archive
                        </Button>
                    )}
                    <Button
                        onClick={deletePermanent}
                        variant="outline"
                        className="rounded-full ml-auto text-red-600 border-red-200 hover:bg-red-50"
                    >
                        <Trash2 className="mr-2 h-4 w-4" /> delete
                    </Button>
                </div>

                {/* Events timeline. Read from concept_events. */}
                {events.length > 0 && (
                    <div>
                        <h2 className="text-title-3 mb-4 flex items-center gap-2">
                            <Clock className="h-4 w-4 text-ink-muted" /> history
                        </h2>
                        <ol className="border-l border-rule pl-4 space-y-3">
                            {events.map(ev => (
                                <li key={ev.id} className="text-sm">
                                    <div className="flex items-baseline justify-between gap-3">
                                        <div>
                                            <span className="font-medium text-ink">{ev.event_type}</span>
                                            {ev.from_status && ev.to_status && (
                                                <span className="text-ink-muted ml-2">
                                                    {ev.from_status} → {ev.to_status}
                                                </span>
                                            )}
                                        </div>
                                        <span className="text-xs text-ink-faint shrink-0">
                                            {new Date(ev.created_at).toLocaleString()}
                                        </span>
                                    </div>
                                </li>
                            ))}
                        </ol>
                    </div>
                )}
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
