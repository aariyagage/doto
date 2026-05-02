'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Bookmark, Trash2, ChevronDown, ChevronUp, Loader2, Sparkles, Check, RefreshCw, X, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import AppLayout, { displayBg } from '@/components/AppLayout'

interface Pillar {
    id: string;
    name: string;
    color: string;
    description?: string | null;
    is_series?: boolean;
    last_tagged_at?: string | null;
}

interface PillarState {
    pillarCount: number;
    isOverSoftCap: boolean;
    softCap: number;
    untaggedRecentVideos: number;
    staleNudgeThreshold: number;
    shouldShowStaleNudge: boolean;
    eligibleTranscriptCount: number;
}

interface Idea {
    id: string;
    title: string;
    hook: string;
    structure: string;
    reasoning: string;
    pillar_id: string;
    is_saved: boolean;
    is_used: boolean;
    generated_at: string;
    isExpanded?: boolean;
    isDeleting?: boolean;
    isRegenerating?: boolean;
    pillars?: { id: string, name: string, color: string };
}

export default function IdeasPage() {
    const supabase = createClient()
    const [pillars, setPillars] = useState<Pillar[]>([])
    const [ideas, setIdeas] = useState<Idea[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [isGenerating, setIsGenerating] = useState(false)
    const [isDeletingAll, setIsDeletingAll] = useState(false)
    const [selectedPillars, setSelectedPillars] = useState<string[]>([])
    const [filterStatus, setFilterStatus] = useState<'All' | 'Saved' | 'Used'>('All')
    const [toasts, setToasts] = useState<{ id: string, message: string }[]>([])

    // Pillar Management States
    const [editingPillarId, setEditingPillarId] = useState<string | null>(null)
    const [editingPillarName, setEditingPillarName] = useState("")
    const [isDeletingPillars, setIsDeletingPillars] = useState(false)
    const [isRegeneratingPillars, setIsRegeneratingPillars] = useState(false)
    const [pillarState, setPillarState] = useState<PillarState | null>(null)

    // Refetches the auxiliary pillar state (used by the empty-state, soft-cap,
    // and stale-pillar banners). Cheap call; fire it after any pillar mutation.
    const fetchPillarState = async () => {
        try {
            const res = await fetch('/api/pillars/state')
            if (!res.ok) return
            const data: PillarState = await res.json()
            setPillarState(data)
        } catch (e) {
            console.error('Failed to fetch pillar state:', e)
        }
    }

    // Fetch initial data
    useEffect(() => {
        const loadData = async () => {
            setIsLoading(true)

            // 1. Fetch pillars from Supabase client
            const { data: pillarsData } = await supabase
                .from('pillars')
                .select('*')
                .order('created_at', { ascending: true })

            if (pillarsData) setPillars(pillarsData)

            // Fetch auxiliary pillar state (banners, soft cap, stale nudge).
            await fetchPillarState()

            // 2. Fetch ideas from backend with Auth header
            const { data: sessionData } = await supabase.auth.getSession()
            const token = sessionData.session?.access_token

            if (token) {
                try {
                    const res = await fetch('/api/ideas', {
                        headers: { 'Authorization': `Bearer ${token}` }
                    })
                    const data = await res.json()
                    if (Array.isArray(data)) {
                        setIdeas(data.map(d => ({ ...d, isExpanded: false, isDeleting: false })))
                    }
                } catch (e) {
                    console.error('Failed to fetch ideas:', e)
                }
            }
            setIsLoading(false)
        }
        loadData()
    }, [supabase])

    const showToast = (message: string) => {
        const id = Math.random().toString()
        setToasts(prev => [...prev, { id, message }])
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id))
        }, 3000)
    }

    const getToken = async () => {
        const { data: sessionData } = await supabase.auth.getSession()
        return sessionData.session?.access_token
    }

    // Toggle save
    const toggleSave = async (id: string, currentSaved: boolean) => {
        // Optimistic update
        setIdeas(prev => prev.map(i => i.id === id ? { ...i, is_saved: !currentSaved } : i))

        const token = await getToken()
        try {
            const res = await fetch(`/api/ideas/${id}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ is_saved: !currentSaved })
            })
            if (!res.ok) throw new Error()
        } catch {
            // Revert on fail
            setIdeas(prev => prev.map(i => i.id === id ? { ...i, is_saved: currentSaved } : i))
            showToast("Failed to save idea")
        }
    }

    // Toggle used
    const markAsUsed = async (id: string) => {
        setIdeas(prev => prev.map(i => i.id === id ? { ...i, is_used: true } : i))

        const token = await getToken()
        try {
            await fetch(`/api/ideas/${id}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ is_used: true })
            })
        } catch {
            setIdeas(prev => prev.map(i => i.id === id ? { ...i, is_used: false } : i))
            showToast("Failed to mark as used")
        }
    }

    // Delete flow
    const confirmDelete = async (id: string) => {
        const token = await getToken()
        try {
            const res = await fetch(`/api/ideas/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            })
            if (res.ok) {
                setIdeas(prev => prev.filter(i => i.id !== id))
                showToast("Idea deleted")
            } else {
                showToast("Failed to delete idea")
                setIdeas(prev => prev.map(i => i.id === id ? { ...i, isDeleting: false } : i))
            }
        } catch {
            showToast("Failed to delete idea")
            setIdeas(prev => prev.map(i => i.id === id ? { ...i, isDeleting: false } : i))
        }
    }

    // Delete all flow
    const confirmDeleteAll = async () => {
        if (!confirm("Are you sure you want to delete ALL your content ideas? This cannot be undone.")) return;

        setIsDeletingAll(true)
        const token = await getToken()
        try {
            const res = await fetch(`/api/ideas`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ confirm: 'DELETE_ALL_IDEAS' }),
            })
            if (res.ok) {
                setIdeas([])
                showToast("All ideas cleared")
            } else {
                showToast("Failed to clear ideas")
            }
        } catch {
            showToast("Failed to clear ideas")
        } finally {
            setIsDeletingAll(false)
        }
    }

    // Regenerate an idea
    const regenerateIdea = async (id: string, pillarId: string) => {
        setIdeas(prev => prev.map(i => i.id === id ? { ...i, isRegenerating: true } : i))
        const token = await getToken()

        try {
            const res = await fetch('/api/ideas/generate', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ count: 1, pillar_ids: pillarId ? [pillarId] : [] })
            })
            const newIdeas = await res.json()
            if (Array.isArray(newIdeas) && newIdeas.length > 0) {
                // Delete old idea in background
                fetch(`/api/ideas/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } }).catch(() => { })

                // Replace in list
                setIdeas(prev => {
                    const idx = prev.findIndex(i => i.id === id)
                    const updated = [...prev]
                    updated[idx] = { ...newIdeas[0], isExpanded: false, isDeleting: false }
                    return updated
                })
                showToast("Idea regenerated")
            } else {
                throw new Error("No ideas returned")
            }
        } catch (e) {
            setIdeas(prev => prev.map(i => i.id === id ? { ...i, isRegenerating: false } : i))
            showToast("Failed to regenerate idea")
        }
    }

    // Generate batch. `count` is per-pillar — 3 ideas for each pillar in scope.
    // Scope = selected pillars OR all pillars if "All Ideas" is on.
    const generateBatch = async () => {
        setIsGenerating(true)
        const token = await getToken()
        try {
            const perPillarCount = 3

            const res = await fetch('/api/ideas/generate', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ count: perPillarCount, pillar_ids: selectedPillars })
            })

            const newIdeas = await res.json()
            if (res.ok && Array.isArray(newIdeas)) {
                setIdeas(prev => [...newIdeas.map(i => ({ ...i, isExpanded: false, isDeleting: false })), ...prev])
                const pillarsCovered = new Set(newIdeas.map(i => i.pillar_id).filter(Boolean)).size
                showToast(
                    pillarsCovered > 1
                        ? `✦ ${newIdeas.length} ideas generated across ${pillarsCovered} pillars`
                        : `✦ ${newIdeas.length} new ideas generated`
                )
            } else {
                throw new Error(newIdeas.error || "Generation failed")
            }
        } catch (e) {
            showToast("Failed to generate ideas. Try again.")
        } finally {
            setIsGenerating(false)
        }
    }

    const togglePillar = (id: string) => {
        setSelectedPillars(prev =>
            prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
        )
    }

    // Pillar Management Functions
    const deletePillar = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation()
        const token = await getToken()
        try {
            const res = await fetch(`/api/pillars/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            })
            if (res.ok) {
                setPillars(prev => prev.filter(p => p.id !== id))
                setSelectedPillars(prev => prev.filter(pid => pid !== id))
                fetchPillarState()
                showToast("Pillar deleted")
            } else throw new Error()
        } catch {
            showToast("Failed to delete pillar")
        }
    }

    const deleteAllPillars = async () => {
        if (!confirm("Are you sure you want to delete ALL content pillars?")) return;
        setIsDeletingPillars(true)
        const token = await getToken()
        try {
            const res = await fetch(`/api/pillars`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ confirm: 'DELETE_ALL_PILLARS' }),
            })
            if (res.ok) {
                setPillars([])
                setSelectedPillars([])
                fetchPillarState()
                showToast("All pillars deleted")
            } else throw new Error()
        } catch {
            showToast("Failed to clear pillars")
        } finally {
            setIsDeletingPillars(false)
        }
    }

    const regeneratePillars = async () => {
        setIsRegeneratingPillars(true)
        const token = await getToken()
        try {
            const res = await fetch(`/api/pillars/generate`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            })
            const body = await res.json().catch(() => ({}))
            if (res.ok) {
                const { data } = await supabase.from('pillars').select('*').order('created_at', { ascending: true })
                if (data) setPillars(data)
                await fetchPillarState()
                showToast("pillars regenerated!")
            } else {
                // Surface the real error from the API so we can debug instead
                // of staring at a generic "Failed to regenerate."
                const msg = (body && typeof body.error === 'string') ? body.error : `Failed to regenerate (HTTP ${res.status})`
                showToast(msg)
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to regenerate'
            showToast(msg)
        } finally {
            setIsRegeneratingPillars(false)
        }
    }

    const savePillarRename = async (id: string) => {
        if (!editingPillarName.trim()) {
            setEditingPillarId(null)
            return
        }

        const originalName = pillars.find(p => p.id === id)?.name || ""
        if (originalName === editingPillarName.trim()) {
            setEditingPillarId(null)
            return
        }

        // Optimistic update
        setPillars(prev => prev.map(p => p.id === id ? { ...p, name: editingPillarName.trim() } : p))
        setEditingPillarId(null)

        const token = await getToken()
        try {
            const res = await fetch(`/api/pillars/${id}`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: editingPillarName.trim() })
            })
            if (!res.ok) throw new Error()
            showToast("Pillar renamed")
        } catch {
            // Revert on fail
            setPillars(prev => prev.map(p => p.id === id ? { ...p, name: originalName } : p))
            showToast("Failed to rename pillar")
        }
    }

    const startEditingPillar = (id: string, currentName: string) => {
        setEditingPillarId(id)
        setEditingPillarName(currentName)
    }

    // Filters
    const filteredIdeas = ideas.filter(idea => {
        if (filterStatus === 'Saved' && !idea.is_saved) return false
        if (filterStatus === 'Used' && !idea.is_used) return false
        if (selectedPillars.length > 0 && !selectedPillars.includes(idea.pillar_id)) return false
        return true
    })

    return (
        <AppLayout>
            <div className="flex-1 flex flex-col overflow-hidden w-full relative">
                <main className="flex-1 w-full">
                    <div className="w-full max-w-7xl mx-auto space-y-8">
                        {/* Top Bar */}
                        <div className="flex items-center justify-between mb-8">
                            <h1 className="text-title-1 text-ink">ideas</h1>
                            <div className="flex items-center gap-3">
                                {ideas.length > 0 && (
                                    <Button
                                        onClick={confirmDeleteAll}
                                        disabled={isDeletingAll || isGenerating}
                                        variant="outline"
                                        className="text-red-500 hover:bg-red-50 hover:text-red-600 border-red-200 transition-all font-medium rounded-full px-5 py-5 shadow-sm"
                                    >
                                        {isDeletingAll ? (
                                            <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> clearing...</>
                                        ) : (
                                            <><Trash2 className="mr-2 h-4 w-4" /> start fresh</>
                                        )}
                                    </Button>
                                )}
                                <Button
                                    onClick={generateBatch}
                                    disabled={isGenerating || isDeletingAll}
                                    className="bg-ink text-paper hover:bg-ink/90 transition-all font-medium rounded-full px-5 py-5 shadow-sm min-w-[170px]"
                                >
                                    {isGenerating ? (
                                        <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> generating...</>
                                    ) : (
                                        <><Sparkles className="mr-2 h-4 w-4" /> ✦ generate ideas</>
                                    )}
                                </Button>
                            </div>
                        </div>

                        {/* Pillars Management Row */}
                        <div className="mb-4">
                            <div className="flex items-start justify-between mb-5">
                                <div>
                                    <h3 className="text-title-3 text-ink leading-tight">your content pillars</h3>
                                    <p className="text-ink-muted text-sm mt-1">folders for your videos. click discover to organize them, or select pillars below to filter ideas.</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    {pillars.length > 0 && (
                                        <button
                                            onClick={deleteAllPillars}
                                            disabled={isDeletingPillars}
                                            className="text-xs font-medium text-red-500 hover:text-red-600 transition-colors flex items-center whitespace-nowrap bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20 px-3 py-1.5 rounded-lg"
                                        >
                                            {isDeletingPillars ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Trash2 className="h-4 w-4 mr-1.5" />}
                                            clear all
                                        </button>
                                    )}
                                    {/* Discover/Regenerate is always visible once the user has at least
                                        one transcript. Pillars are no longer auto-created on upload —
                                        the user runs Discover when they're ready to organize their videos. */}
                                    {(pillarState?.eligibleTranscriptCount ?? 0) >= 1 && (
                                        <button
                                            onClick={regeneratePillars}
                                            disabled={isRegeneratingPillars}
                                            className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors flex items-center whitespace-nowrap bg-blue-50 dark:bg-blue-500/10 hover:bg-blue-100 px-3 py-1.5 rounded-lg"
                                        >
                                            {isRegeneratingPillars ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
                                            {pillars.length === 0 ? 'discover pillars' : 'regenerate'}
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Soft-cap nudge: pillar list is getting unwieldy. */}
                            {pillarState?.isOverSoftCap && (
                                <div className="mb-4 px-4 py-3 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30">
                                    <p className="text-sm text-amber-900 dark:text-amber-100">
                                        you have {pillarState.pillarCount} pillars. content tends to lose focus past {pillarState.softCap} —
                                        consider deleting the least-tagged ones below.
                                    </p>
                                </div>
                            )}

                            {/* Stale-pillar nudge: recent uploads aren't fitting any existing pillar. */}
                            {pillarState?.shouldShowStaleNudge && (
                                <div className="mb-4 px-4 py-3 rounded-lg bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 flex items-center justify-between gap-4">
                                    <p className="text-sm text-blue-900 dark:text-blue-100">
                                        {pillarState.untaggedRecentVideos} recent video{pillarState.untaggedRecentVideos === 1 ? '' : 's'}{' '}
                                        didn&apos;t fit any pillar. your content may have shifted.
                                    </p>
                                    <button
                                        onClick={regeneratePillars}
                                        disabled={isRegeneratingPillars}
                                        className="text-xs font-medium text-blue-700 dark:text-blue-200 hover:underline whitespace-nowrap"
                                    >
                                        {isRegeneratingPillars ? 'regenerating…' : 'regenerate →'}
                                    </button>
                                </div>
                            )}

                            <div className="flex flex-wrap gap-4 relative">
                                {pillars.length === 0 ? (
                                    (pillarState?.eligibleTranscriptCount ?? 0) < 1 ? (
                                        <p className="text-ink-muted text-sm w-full">
                                            upload a video to get started.
                                            {' '}
                                            <a href="/upload" className="font-bold text-blue-600 hover:underline">upload now →</a>
                                        </p>
                                    ) : (
                                        <p className="text-ink-faint text-sm italic w-full">
                                            you have {pillarState?.eligibleTranscriptCount ?? 0} video{(pillarState?.eligibleTranscriptCount ?? 0) === 1 ? '' : 's'} ready.
                                            click <span className="font-bold text-blue-600">discover pillars</span> above to organize them into folders.
                                        </p>
                                    )
                                ) : (
                                    <div
                                        onClick={() => setSelectedPillars([])}
                                        className={`group relative flex items-center justify-center cursor-pointer transition-transform hover:-translate-y-1 h-10 px-5 rounded-t-xl rounded-br-xl ${selectedPillars.length === 0 ? 'bg-ink text-paper z-10' : 'bg-paper-sunken text-ink-muted'}`}
                                        style={{ borderTopLeftRadius: '0.75rem' }}
                                    >
                                        <div className={`absolute -top-2.5 left-0 w-1/2 h-3.5 rounded-t-lg ${selectedPillars.length === 0 ? 'bg-ink' : 'bg-paper-sunken'}`}></div>
                                        <span className="font-medium text-xs relative z-10">all ideas</span>
                                    </div>
                                )}

                                {pillars.map(p => {
                                    const isSelected = selectedPillars.includes(p.id)
                                    const isEditing = editingPillarId === p.id

                                    if (isEditing) {
                                        return (
                                            <div key={p.id} className="group relative flex items-center h-10 bg-paper-elevated border-2 border-[#125603] rounded-t-xl rounded-br-xl px-2 z-20">
                                                <input
                                                    type="text"
                                                    value={editingPillarName}
                                                    onChange={(e) => setEditingPillarName(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') savePillarRename(p.id)
                                                        if (e.key === 'Escape') setEditingPillarId(null)
                                                    }}
                                                    onBlur={() => savePillarRename(p.id)}
                                                    autoFocus
                                                    className="text-xs font-bold outline-none border-none py-1 min-w-[110px] bg-transparent text-ink"
                                                />
                                            </div>
                                        )
                                    }

                                    return (
                                        <div
                                            key={p.id}
                                            onClick={() => togglePillar(p.id)}
                                            style={{
                                                backgroundColor: isSelected ? displayBg(p.color) : undefined,
                                                color: isSelected ? '#111827' : undefined,
                                                borderColor: !isSelected ? displayBg(p.color) : 'transparent',
                                            }}
                                            className={`group relative flex items-center gap-2 h-10 px-4 cursor-pointer transition-transform hover:-translate-y-1 rounded-t-xl rounded-br-xl shadow-sm hover:shadow ${!isSelected ? 'bg-paper-elevated border-2 opacity-80 hover:opacity-100 text-ink-muted' : 'font-bold border border-black/10 z-10'}`}
                                        >
                                            <div
                                                className="absolute -top-2.5 left-0 w-1/2 h-3.5 rounded-t-lg transition-colors"
                                                style={{
                                                    backgroundColor: displayBg(p.color),
                                                    opacity: isSelected ? 1 : 0.4,
                                                    borderTop: !isSelected ? `1px solid ${displayBg(p.color)}` : 'none',
                                                    borderLeft: !isSelected ? `1px solid ${displayBg(p.color)}` : 'none',
                                                    borderRight: !isSelected ? `1px solid ${displayBg(p.color)}` : 'none'
                                                }}
                                            ></div>

                                            <span
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    startEditingPillar(p.id, p.name);
                                                }}
                                                className={`text-[11px] ${isSelected ? 'font-semibold' : 'font-medium'} hover:underline decoration-black/30 underline-offset-2 relative z-10`}
                                                title="Click to rename"
                                            >
                                                {p.name}
                                            </span>
                                            {p.is_series && (
                                                <span
                                                    className={`text-[10px] font-semibold rounded-sm px-1 py-0.5 relative z-10 ${isSelected ? 'bg-black/10 text-black/70' : 'bg-paper-sunken text-ink-muted'}`}
                                                    title="series pillar"
                                                >
                                                    series
                                                </span>
                                            )}
                                            <button
                                                onClick={(e) => deletePillar(e, p.id)}
                                                className={`rounded-md p-1 transition-all opacity-0 group-hover:opacity-100 relative z-10 ${isSelected ? 'text-black/50 hover:bg-black/10' : 'text-ink-faint hover:text-red-500 hover:bg-paper-sunken'}`}
                                                title="Delete pillar"
                                            >
                                                <X className="h-3.5 w-3.5 stroke-[3]" />
                                            </button>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>

                        {/* Filter Row 2: Status Controls */}
                        <div className="flex gap-1 p-1 bg-ink/5 dark:bg-ink/5 rounded-lg w-fit">
                            {(['All', 'Saved', 'Used'] as const).map(status => (
                                <button
                                    key={status}
                                    onClick={() => setFilterStatus(status)}
                                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${filterStatus === status ? 'bg-paper-elevated shadow-sm text-ink' : 'text-ink-muted hover:text-ink'}`}
                                >
                                    {status.toLowerCase()}
                                </button>
                            ))}
                        </div>

                        {/* Ideas List */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-20">
                            {/* Loading State */}
                            {isLoading && (
                                Array.from({ length: 4 }).map((_, i) => (
                                    <div key={`loading-${i}`} className="h-64 rounded-2xl bg-paper-sunken animate-pulse w-full"></div>
                                ))
                            )}

                            {/* Batch Generating State Skeleton */}
                            {isGenerating && (
                                Array.from({ length: 3 }).map((_, i) => (
                                    <div key={`gen-${i}`} className="h-64 rounded-2xl bg-paper-sunken animate-pulse w-full"></div>
                                ))
                            )}

                            {!isLoading && filteredIdeas.length === 0 && !isGenerating && (
                                <div className="flex flex-col items-center justify-center py-24 text-center">
                                    <div className="bg-paper-sunken p-4 rounded-full mb-4 flex items-center justify-center">
                                        <Sparkles className="h-12 w-12 text-ink-faint" />
                                    </div>
                                    <h3 className="text-title-3 text-ink mb-2">no ideas yet</h3>
                                    <p className="text-body-sm text-ink-muted mb-6 max-w-sm">
                                        generate your first batch of personalized content ideas tailored strictly to your voice profile.
                                    </p>
                                    <Button onClick={generateBatch} className="bg-ink text-paper hover:bg-ink/90 rounded-full px-6 transition-colors">
                                        ✦ generate ideas
                                    </Button>
                                </div>
                            )}

                            {/* Render Ideas */}
                            {!isLoading && filteredIdeas.map(idea => {
                                const pillar = idea.pillars || pillars.find(p => p.id === idea.pillar_id)
                                const comboColorBg = pillar?.color ? displayBg(pillar.color) : 'var(--paper-elevated)';
                                const isDefault = !pillar?.color;

                                return (
                                    <div
                                        key={idea.id}
                                        className={`relative flex flex-col rounded-3xl border ${isDefault ? 'border-rule bg-paper-elevated' : 'border-transparent'} p-6 shadow-sm transition-opacity duration-300 ${idea.is_used ? 'opacity-50' : 'opacity-100'} overflow-hidden`}
                                        style={{ backgroundColor: isDefault ? undefined : comboColorBg }}
                                    >
                                        {!isDefault && (
                                            <div className="absolute right-0 top-0 bottom-0 w-32 pointer-events-none z-0">
                                                <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full text-paper fill-current opacity-20 dark:opacity-5">
                                                    <path d="M100,0 L0,50 L100,100 Z" />
                                                </svg>
                                            </div>
                                        )}

                                        {idea.isRegenerating && (
                                            <div className="absolute inset-0 z-20 flex items-center justify-center bg-paper-elevated/80 dark:bg-paper/80 rounded-3xl backdrop-blur-sm">
                                                <Loader2 className="h-8 w-8 animate-spin text-ink" />
                                            </div>
                                        )}

                                        <div className="relative z-10 flex flex-col h-full">
                                            {/* Card Top Row - Pillar Badge Only */}
                                            <div className="mb-3 flex items-center justify-between">
                                                <span
                                                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-medium ${isDefault ? 'bg-ink/[0.06] text-ink-muted' : 'bg-black/10 text-gray-900'}`}
                                                >
                                                    {pillar?.name || 'uncategorized'}
                                                </span>
                                                <button
                                                    onClick={() => toggleSave(idea.id, idea.is_saved)}
                                                    className={`transition-colors hover:scale-110 ${idea.is_saved ? (isDefault ? 'text-blue-500' : 'text-gray-900') : (isDefault ? 'text-ink-faint hover:text-ink-muted' : 'text-black/30 hover:text-black/60')}`}
                                                >
                                                    <Star className={`h-5 w-5 ${idea.is_saved ? 'fill-current' : ''}`} strokeWidth={idea.is_saved ? 2 : 1.5} />
                                                </button>
                                            </div>

                                            {/* Title */}
                                            <h2 className={`text-xl md:text-2xl font-semibold tracking-tight leading-tight mb-5 ${isDefault ? 'text-ink' : 'text-gray-900'}`}>
                                                {idea.title}
                                            </h2>

                                            {/* Hook Section */}
                                            <div className="mb-5">
                                                <span className={`text-[11px] font-semibold block mb-1.5 ${isDefault ? 'text-ink-faint' : 'text-black/50'}`}>hook</span>
                                                <p className={`text-base md:text-lg font-medium ${isDefault ? 'text-ink' : 'text-gray-900'}`}>
                                                    &ldquo;{idea.hook}&rdquo;
                                                </p>
                                            </div>

                                            {/* Expandable Structure */}
                                            <div className={`mb-6 pt-4 border-t ${isDefault ? 'border-rule-soft' : 'border-black/10'}`}>
                                                <button
                                                    onClick={() => setIdeas(prev => prev.map(i => i.id === idea.id ? { ...i, isExpanded: !idea.isExpanded } : i))}
                                                    className={`flex items-center text-xs font-medium transition-colors ${isDefault ? 'text-ink-muted hover:text-ink' : 'text-black/70 hover:text-black'}`}
                                                >
                                                    {idea.isExpanded ? (
                                                        <><ChevronUp className="mr-1 h-3.5 w-3.5" /> less</>
                                                    ) : (
                                                        <><ChevronDown className="mr-1 h-3.5 w-3.5" /> structure &amp; concept</>
                                                    )}
                                                </button>

                                                {idea.isExpanded && (
                                                    <div className={`mt-5 space-y-5 rounded-2xl p-5 md:p-6 animate-in slide-in-from-top-2 fade-in duration-200 ${isDefault ? 'bg-paper-sunken' : 'bg-black/5'}`}>
                                                        <div>
                                                            <span className={`text-[11px] font-semibold block mb-2 ${isDefault ? 'text-ink-faint' : 'text-black/40'}`}>structure</span>
                                                            <p className={`text-sm leading-relaxed whitespace-pre-wrap ${isDefault ? 'text-ink-muted' : 'text-gray-900'}`}>
                                                                {idea.structure.split('→').map((step, idx, arr) => (
                                                                    <span key={idx}>
                                                                        {step.trim()}
                                                                        {idx < arr.length - 1 && <span className={`mx-2 ${isDefault ? 'text-ink-faint' : 'text-black/20'}`}>→</span>}
                                                                    </span>
                                                                ))}
                                                            </p>
                                                        </div>
                                                        <div>
                                                            <span className={`text-[11px] font-semibold block mb-2 ${isDefault ? 'text-ink-faint' : 'text-black/40'}`}>concept</span>
                                                            <p className={`text-sm leading-relaxed ${isDefault ? 'text-ink-muted' : 'text-gray-900'}`}>{idea.reasoning}</p>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Card Bottom Row */}
                                            <div className={`flex items-center justify-between mt-auto pt-4 border-t ${isDefault ? 'border-rule-soft' : 'border-black/10'}`}>
                                                <div className="flex items-center gap-4">
                                                    <button
                                                        onClick={() => regenerateIdea(idea.id, idea.pillar_id)}
                                                        className={`text-xs font-medium transition-colors flex items-center ${isDefault ? 'text-ink-muted hover:text-ink' : 'text-black/50 hover:text-black'}`}
                                                    >
                                                        ↺ regenerate
                                                    </button>
                                                </div>

                                                <div className="flex items-center gap-3">
                                                    <button
                                                        onClick={() => markAsUsed(idea.id)}
                                                        disabled={idea.is_used}
                                                        className={`flex items-center px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${idea.is_used ? (isDefault ? 'bg-green-50 text-green-600 dark:bg-green-500/10 dark:text-green-400' : 'bg-black/10 text-gray-900') : (isDefault ? 'bg-ink/[0.06] text-ink-muted hover:bg-ink/[0.1]' : 'bg-black/5 text-black/70 hover:bg-black/10')}`}
                                                    >
                                                        {idea.is_used && <Check className="mr-1.5 h-3.5 w-3.5" />}
                                                        {idea.is_used ? 'used' : 'mark used'}
                                                    </button>

                                                    {idea.isDeleting ? (
                                                        <div className={`flex items-center gap-2 text-xs font-medium border rounded-xl px-3 py-2 ${isDefault ? 'bg-red-50 border-red-100 dark:bg-red-500/10 dark:border-red-500/20' : 'bg-red-500/20 border-red-500/30'}`}>
                                                            <button onClick={() => confirmDelete(idea.id)} className={`${isDefault ? 'text-red-600 dark:text-red-400' : 'text-red-900'} hover:underline`}>confirm</button>
                                                            <span className={isDefault ? 'text-ink-faint' : 'text-black/20'}>/</span>
                                                            <button onClick={() => setIdeas(prev => prev.map(i => i.id === idea.id ? { ...i, isDeleting: false } : i))} className={`${isDefault ? 'text-ink-muted' : 'text-black/60'} hover:underline`}>cancel</button>
                                                        </div>
                                                    ) : (
                                                        <button
                                                            onClick={() => setIdeas(prev => prev.map(i => i.id === idea.id ? { ...i, isDeleting: true } : i))}
                                                            className={`rounded-xl p-2 transition-colors ${isDefault ? 'text-ink-faint hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10' : 'text-black/40 hover:bg-black/10 hover:text-red-700'}`}
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                </main>
            </div>

            {/* Toasts overlay */}
            <div className="fixed bottom-6 right-6 flex flex-col gap-2 z-50 pointer-events-none">
                {toasts.map(toast => (
                    <div key={toast.id} className="bg-ink text-paper px-4 py-3 rounded-xl shadow-xl text-sm font-medium animate-in slide-in-from-bottom-5 fade-in pointer-events-auto flex items-center">
                        {toast.message}
                    </div>
                ))}
            </div>
        </AppLayout>
    )
}
