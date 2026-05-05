'use client'

// /workspace — Pillar Workspace.
//
// Drag concepts between pillar columns with @dnd-kit. Merge a pillar
// into another, split selected concepts into a new pillar, rename inline,
// discover new pillars from transcripts, delete individual pillars.
// This is the home for pillar lifecycle (post /ideas retirement).
//
// Concepts shown: status in (draft, reviewed, saved). Used / rejected /
// archived hide here -- the workspace is for the active backlog.
// Cards link to /concepts/[id] for full edit.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
    DndContext,
    DragOverlay,
    PointerSensor,
    useSensor,
    useSensors,
    useDraggable,
    useDroppable,
    type DragEndEvent,
    type DragStartEvent,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import {
    Loader2,
    Layers,
    Scissors,
    Check,
    X,
    GitMerge,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import AppLayout, { displayBg, getPairedTextColor } from '@/components/AppLayout'
import { featureFlags } from '@/lib/env'

interface Pillar {
    id: string
    name: string
    color: string
    description: string | null
    is_series?: boolean
}

interface Concept {
    id: string
    pillar_id: string | null
    title: string
    hook: string | null
    voice_adapted_title: string | null
    voice_adapted_hook: string | null
    status: 'draft' | 'reviewed' | 'saved' | 'used' | 'rejected' | 'archived'
    score: { composite: number } | null
    pipeline_run_id: string | null
}

const ACTIVE_STATUSES = new Set(['draft', 'reviewed', 'saved'])

export default function WorkspacePage() {
    const supabase = createClient()
    const [pillars, setPillars] = useState<Pillar[]>([])
    const [concepts, setConcepts] = useState<Concept[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [activeDragId, setActiveDragId] = useState<string | null>(null)
    const [editingPillarId, setEditingPillarId] = useState<string | null>(null)
    const [editingPillarName, setEditingPillarName] = useState('')
    const [mergeTargetForPillarId, setMergeTargetForPillarId] = useState<string | null>(null)
    const [splitMode, setSplitMode] = useState(false)
    const [splitSelected, setSplitSelected] = useState<Set<string>>(new Set())
    const [splitName, setSplitName] = useState('')
    const [isMerging, setIsMerging] = useState(false)
    const [isSplitting, setIsSplitting] = useState(false)
    const [toasts, setToasts] = useState<{ id: string; message: string }[]>([])

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: { distance: 6 }, // start drag after 6px move (avoids click-vs-drag conflict)
        }),
    )

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
            if (pillarsData) setPillars(pillarsData as Pillar[])

            const token = await getToken()
            if (token) {
                try {
                    const res = await fetch('/api/concepts?limit=500', { headers: { Authorization: `Bearer ${token}` } })
                    if (res.ok) {
                        const data = await res.json()
                        if (Array.isArray(data)) setConcepts(data)
                    }
                } catch (e) {
                    console.error('Failed to load concepts:', e)
                }
            }
            setIsLoading(false)
        }
        load()
    }, [supabase, getToken])

    // Group active concepts by pillar.
    const conceptsByPillar = useMemo(() => {
        const groups = new Map<string, Concept[]>()
        for (const p of pillars) groups.set(p.id, [])
        for (const c of concepts) {
            if (!ACTIVE_STATUSES.has(c.status)) continue
            if (!c.pillar_id) continue
            const arr = groups.get(c.pillar_id)
            if (arr) arr.push(c)
        }
        // Sort each column by composite score desc when present, else
        // alphabetical by title.
        for (const arr of groups.values()) {
            arr.sort((a, b) => {
                const ac = a.score?.composite ?? -1
                const bc = b.score?.composite ?? -1
                if (ac !== bc) return bc - ac
                return a.title.localeCompare(b.title)
            })
        }
        return groups
    }, [pillars, concepts])

    const onDragStart = (e: DragStartEvent) => {
        setActiveDragId(String(e.active.id))
    }

    const onDragEnd = async (e: DragEndEvent) => {
        const draggedId = String(e.active.id)
        const overId = e.over ? String(e.over.id) : null
        setActiveDragId(null)
        if (!overId) return

        const concept = concepts.find(c => c.id === draggedId)
        if (!concept) return

        // Drop targets are pillar columns; their droppable id is the
        // pillar.id verbatim. If the target is the same pillar, no-op.
        if (overId === concept.pillar_id) return

        // Optimistic move.
        const previousPillarId = concept.pillar_id
        setConcepts(prev => prev.map(c => (c.id === draggedId ? { ...c, pillar_id: overId } : c)))

        const token = await getToken()
        try {
            const res = await fetch(`/api/concepts/${draggedId}`, {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ pillar_id: overId }),
            })
            if (!res.ok) {
                const data = await res.json().catch(() => ({}))
                throw new Error(data.error ?? `HTTP ${res.status}`)
            }
            const targetPillar = pillars.find(p => p.id === overId)
            showToast(`moved to ${targetPillar?.name ?? 'pillar'}`)
        } catch (err) {
            setConcepts(prev => prev.map(c => (c.id === draggedId ? { ...c, pillar_id: previousPillarId } : c)))
            const msg = err instanceof Error ? err.message : 'Move failed'
            showToast(msg)
        }
    }

    const startEditPillar = (p: Pillar) => {
        setEditingPillarId(p.id)
        setEditingPillarName(p.name)
    }

    const saveEditPillar = async (id: string) => {
        const trimmed = editingPillarName.trim()
        const original = pillars.find(p => p.id === id)?.name ?? ''
        setEditingPillarId(null)
        if (!trimmed || trimmed === original) return

        // Optimistic.
        setPillars(prev => prev.map(p => (p.id === id ? { ...p, name: trimmed } : p)))
        const token = await getToken()
        try {
            const res = await fetch(`/api/pillars/${id}`, {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: trimmed }),
            })
            if (!res.ok) throw new Error()
            showToast('renamed')
        } catch {
            setPillars(prev => prev.map(p => (p.id === id ? { ...p, name: original } : p)))
            showToast('rename failed')
        }
    }

    const performMerge = async (fromId: string, intoId: string) => {
        if (fromId === intoId) {
            setMergeTargetForPillarId(null)
            return
        }
        const fromName = pillars.find(p => p.id === fromId)?.name ?? 'pillar'
        const intoName = pillars.find(p => p.id === intoId)?.name ?? 'pillar'
        if (!confirm(`Merge "${fromName}" into "${intoName}"?\n\nAll concepts, videos, and ideas from "${fromName}" will move to "${intoName}". The "${fromName}" pillar will be deleted.`)) {
            return
        }

        setIsMerging(true)
        const token = await getToken()
        try {
            const res = await fetch('/api/pillars/merge', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ from_id: fromId, into_id: intoId }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)

            setPillars(prev => prev.filter(p => p.id !== fromId))
            setConcepts(prev => prev.map(c => (c.pillar_id === fromId ? { ...c, pillar_id: intoId } : c)))
            showToast(`merged · ${data.moved_concepts} concepts moved`)
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Merge failed'
            showToast(msg)
        } finally {
            setIsMerging(false)
            setMergeTargetForPillarId(null)
        }
    }

    const enterSplitMode = () => {
        setSplitMode(true)
        setSplitSelected(new Set())
        setSplitName('')
    }
    const cancelSplitMode = () => {
        setSplitMode(false)
        setSplitSelected(new Set())
        setSplitName('')
    }
    const toggleSplitSelect = (conceptId: string) => {
        setSplitSelected(prev => {
            const next = new Set(prev)
            if (next.has(conceptId)) next.delete(conceptId)
            else next.add(conceptId)
            return next
        })
    }

    const performSplit = async () => {
        const ids = Array.from(splitSelected)
        if (ids.length === 0) {
            showToast('select at least one concept')
            return
        }
        if (!splitName.trim()) {
            showToast('name the new pillar')
            return
        }
        // All selected concepts must belong to the same pillar.
        const sourcePillarIds = new Set(
            ids.map(id => concepts.find(c => c.id === id)?.pillar_id).filter(Boolean) as string[],
        )
        if (sourcePillarIds.size !== 1) {
            showToast('split: all selected concepts must come from the same pillar')
            return
        }
        const fromPillarId = Array.from(sourcePillarIds)[0]

        setIsSplitting(true)
        const token = await getToken()
        try {
            const res = await fetch('/api/pillars/split', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pillar_id: fromPillarId,
                    concept_ids: ids,
                    new_name: splitName.trim(),
                }),
            })
            const data = await res.json()
            if (!res.ok) {
                throw new Error(data.error ?? `HTTP ${res.status}`)
            }

            const newPillar = data.new_pillar as Pillar
            setPillars(prev => [...prev, newPillar])
            setConcepts(prev => prev.map(c => (ids.includes(c.id) ? { ...c, pillar_id: newPillar.id } : c)))
            showToast(`split · ${data.moved_concepts} concepts moved to "${newPillar.name}"`)
            cancelSplitMode()
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Split failed'
            showToast(msg)
        } finally {
            setIsSplitting(false)
        }
    }

    if (!featureFlags.workspaceV1()) {
        return (
            <AppLayout>
                <div className="max-w-2xl mx-auto py-24 text-center">
                    <Layers className="h-12 w-12 mx-auto text-ink-faint mb-4" />
                    <h1 className="text-title-1 mb-3">workspace</h1>
                    <p className="text-ink-muted">
                        the pillar workspace is not enabled. set
                        <code className="mx-1 px-1.5 py-0.5 rounded bg-ink/[0.06] text-xs">NEXT_PUBLIC_WORKSPACE_V1=true</code>
                        and{' '}
                        <code className="mx-1 px-1.5 py-0.5 rounded bg-ink/[0.06] text-xs">NEXT_PUBLIC_CONCEPT_PIPELINE=true</code>
                        in your env to unlock it.
                    </p>
                </div>
            </AppLayout>
        )
    }

    const activeConcept = activeDragId ? concepts.find(c => c.id === activeDragId) ?? null : null

    return (
        <AppLayout>
            <div className="w-full max-w-[1400px] mx-auto pb-20">
                {/* Top bar */}
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h1 className="text-title-1 text-ink">workspace</h1>
                        <p className="text-ink-muted text-sm mt-1">
                            drag concepts between pillars. rename, merge, or split.
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        {!splitMode ? (
                            <Button onClick={enterSplitMode} variant="outline" className="rounded-full">
                                <Scissors className="mr-2 h-4 w-4" /> split mode
                            </Button>
                        ) : (
                            <>
                                <input
                                    type="text"
                                    value={splitName}
                                    onChange={e => setSplitName(e.target.value)}
                                    placeholder="new pillar name"
                                    className="text-sm bg-paper-elevated border border-rule rounded-full px-4 py-2 outline-none focus:border-ink"
                                />
                                <Button
                                    onClick={performSplit}
                                    disabled={isSplitting || splitSelected.size === 0 || !splitName.trim()}
                                    className="rounded-full bg-ink text-paper hover:bg-ink/90"
                                >
                                    {isSplitting ? (
                                        <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> splitting</>
                                    ) : (
                                        <>split {splitSelected.size}</>
                                    )}
                                </Button>
                                <Button onClick={cancelSplitMode} variant="outline" className="rounded-full">
                                    <X className="h-4 w-4" />
                                </Button>
                            </>
                        )}
                    </div>
                </div>

                {/* Loading */}
                {isLoading && (
                    <div className="flex gap-4 overflow-x-auto pb-4">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <div key={`l-${i}`} className="w-72 h-96 rounded-2xl bg-paper-sunken animate-pulse shrink-0" />
                        ))}
                    </div>
                )}

                {/* Empty */}
                {!isLoading && pillars.length === 0 && (
                    <div className="py-24 text-center">
                        <Layers className="h-12 w-12 mx-auto text-ink-faint mb-3" />
                        <h3 className="text-title-3 mb-2">no pillars yet</h3>
                        <p className="text-ink-muted text-sm max-w-md mx-auto mb-4">
                            create pillars on{' '}
                            <a href="/concepts" className="font-semibold text-blue-600 hover:underline">/concepts</a>
                            {' '}first. once you have pillars and concepts, this workspace lets you drag concepts between them.
                        </p>
                    </div>
                )}

                {!isLoading && pillars.length > 0 && (
                    <DndContext
                        sensors={sensors}
                        onDragStart={onDragStart}
                        onDragEnd={onDragEnd}
                    >
                        <div className="flex gap-4 overflow-x-auto pb-6">
                            {pillars.map(pillar => {
                                const pillarConcepts = conceptsByPillar.get(pillar.id) ?? []
                                return (
                                    <PillarColumn
                                        key={pillar.id}
                                        pillar={pillar}
                                        otherPillars={pillars.filter(p => p.id !== pillar.id)}
                                        concepts={pillarConcepts}
                                        editingName={editingPillarId === pillar.id ? editingPillarName : null}
                                        onEditNameChange={setEditingPillarName}
                                        onStartEdit={() => startEditPillar(pillar)}
                                        onSaveEdit={() => saveEditPillar(pillar.id)}
                                        onCancelEdit={() => setEditingPillarId(null)}
                                        mergeOpen={mergeTargetForPillarId === pillar.id}
                                        onToggleMergeMenu={() =>
                                            setMergeTargetForPillarId(prev => (prev === pillar.id ? null : pillar.id))
                                        }
                                        onMergeInto={target => performMerge(pillar.id, target)}
                                        isMerging={isMerging}
                                        splitMode={splitMode}
                                        splitSelected={splitSelected}
                                        onToggleSplit={toggleSplitSelect}
                                    />
                                )
                            })}
                        </div>

                        <DragOverlay>
                            {activeConcept && <ConceptCardOverlay concept={activeConcept} />}
                        </DragOverlay>
                    </DndContext>
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

// ---- PillarColumn ---------------------------------------------------------

interface PillarColumnProps {
    pillar: Pillar
    otherPillars: Pillar[]
    concepts: Concept[]
    editingName: string | null
    onEditNameChange: (s: string) => void
    onStartEdit: () => void
    onSaveEdit: () => void
    onCancelEdit: () => void
    mergeOpen: boolean
    onToggleMergeMenu: () => void
    onMergeInto: (targetId: string) => void
    isMerging: boolean
    splitMode: boolean
    splitSelected: Set<string>
    onToggleSplit: (conceptId: string) => void
}

function PillarColumn({
    pillar,
    otherPillars,
    concepts,
    editingName,
    onEditNameChange,
    onStartEdit,
    onSaveEdit,
    onCancelEdit,
    mergeOpen,
    onToggleMergeMenu,
    onMergeInto,
    isMerging,
    splitMode,
    splitSelected,
    onToggleSplit,
}: PillarColumnProps) {
    const { isOver, setNodeRef } = useDroppable({ id: pillar.id })
    const colorBg = displayBg(pillar.color)
    const ink = getPairedTextColor(pillar.color || '')

    return (
        <div
            ref={setNodeRef}
            className={`shrink-0 w-72 rounded-2xl border ${isOver ? 'border-ink shadow-md' : 'border-rule'} bg-paper-elevated transition-colors`}
        >
            {/* Header */}
            <div
                className="rounded-t-2xl px-4 py-3 flex items-center justify-between gap-2"
                style={{ backgroundColor: colorBg, color: ink }}
            >
                {editingName !== null ? (
                    <input
                        type="text"
                        value={editingName}
                        onChange={e => onEditNameChange(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter') onSaveEdit()
                            if (e.key === 'Escape') onCancelEdit()
                        }}
                        onBlur={onSaveEdit}
                        autoFocus
                        className="flex-1 bg-white/30 rounded-md px-2 py-1 outline-none text-sm font-semibold"
                        style={{ color: ink }}
                    />
                ) : (
                    <button
                        onClick={onStartEdit}
                        className="flex-1 text-left text-sm font-semibold truncate hover:opacity-80"
                        title="Click to rename"
                    >
                        {pillar.name}
                    </button>
                )}
                <span className="text-xs opacity-70 shrink-0">{concepts.length}</span>
                {/* Merge menu trigger */}
                <div className="relative shrink-0">
                    <button
                        onClick={onToggleMergeMenu}
                        disabled={isMerging || otherPillars.length === 0}
                        className="p-1 rounded-md hover:bg-white/20 disabled:opacity-50"
                        title="Merge this pillar into another"
                    >
                        <GitMerge className="h-3.5 w-3.5" />
                    </button>
                    {mergeOpen && (
                        <div className="absolute right-0 top-full mt-1 z-10 w-56 rounded-lg border border-rule bg-paper-elevated shadow-lg p-1 text-ink">
                            <div className="px-3 py-2 text-xs text-ink-muted uppercase tracking-wide">merge into</div>
                            {otherPillars.map(t => (
                                <button
                                    key={t.id}
                                    onClick={() => onMergeInto(t.id)}
                                    className="w-full text-left text-sm px-3 py-2 hover:bg-ink/[0.06] rounded-md flex items-center justify-between"
                                >
                                    <span className="truncate">{t.name}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Concept list */}
            <div className="p-3 space-y-2 min-h-[200px] max-h-[70vh] overflow-y-auto">
                {concepts.length === 0 && (
                    <div className="text-xs text-ink-faint py-6 text-center italic">
                        drop concepts here
                    </div>
                )}
                {concepts.map(c => (
                    <DraggableConceptCard
                        key={c.id}
                        concept={c}
                        splitMode={splitMode}
                        splitSelected={splitSelected.has(c.id)}
                        onToggleSplit={() => onToggleSplit(c.id)}
                    />
                ))}
            </div>
        </div>
    )
}

// ---- DraggableConceptCard -------------------------------------------------

// pillarColor is currently unused (the card has no per-pillar tint —
// the column header carries the color). Kept on the props so it can be
// wired up later without re-threading data.
interface DraggableConceptCardProps {
    concept: Concept
    splitMode: boolean
    splitSelected: boolean
    onToggleSplit: () => void
}

function DraggableConceptCard({
    concept,
    splitMode,
    splitSelected,
    onToggleSplit,
}: DraggableConceptCardProps) {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: concept.id,
        disabled: splitMode, // in split mode, clicking should toggle selection, not drag
    })

    const style = {
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.4 : 1,
    }

    const composite = concept.score?.composite ?? null
    const compositePct = composite != null ? Math.round(composite * 100) : null

    const useVoice = Boolean(concept.voice_adapted_title)
    const displayTitle = useVoice && concept.voice_adapted_title ? concept.voice_adapted_title : concept.title
    const displayHook = useVoice && concept.voice_adapted_hook ? concept.voice_adapted_hook : concept.hook

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...(splitMode ? {} : { ...listeners, ...attributes })}
            className={`rounded-lg border ${splitSelected ? 'border-ink ring-2 ring-ink/20' : 'border-rule'} bg-paper px-3 py-2 ${splitMode ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'} hover:shadow-sm transition-shadow`}
            onClick={splitMode ? onToggleSplit : undefined}
        >
            <div className="flex items-start justify-between gap-2 mb-1">
                <p className="text-sm font-medium leading-snug line-clamp-2 flex-1">{displayTitle}</p>
                {compositePct != null && (
                    <span className="text-[10px] font-mono text-ink-faint shrink-0">{compositePct}%</span>
                )}
            </div>
            {displayHook && (
                <p className="text-xs text-ink-muted line-clamp-2 italic">&ldquo;{displayHook}&rdquo;</p>
            )}
            <div className="flex items-center justify-between mt-1.5">
                <span className="text-[10px] text-ink-faint uppercase tracking-wide">{concept.status}</span>
                {!splitMode && (
                    <a
                        href={`/concepts/${concept.id}`}
                        className="text-[10px] text-ink-muted hover:text-ink underline-offset-2 hover:underline"
                        onClick={e => e.stopPropagation()}
                        onPointerDown={e => e.stopPropagation()}
                    >
                        open
                    </a>
                )}
                {splitMode && (
                    <Check className={`h-3 w-3 ${splitSelected ? 'text-ink' : 'text-ink-faint'}`} />
                )}
            </div>
        </div>
    )
}

function ConceptCardOverlay({ concept }: { concept: Concept }) {
    const useVoice = Boolean(concept.voice_adapted_title)
    const displayTitle = useVoice && concept.voice_adapted_title ? concept.voice_adapted_title : concept.title
    return (
        <div className="rounded-lg border border-ink bg-paper-elevated px-3 py-2 shadow-xl rotate-2">
            <p className="text-sm font-medium leading-snug">{displayTitle}</p>
        </div>
    )
}
