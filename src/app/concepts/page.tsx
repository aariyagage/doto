'use client'

// /concepts — Concept Library.
//
// First user-visible vNext surface. Mirrors /ideas patterns (pillar chip
// filter, card grid, optimistic mutations, toast) but for the new
// concepts data model.
//
// Status filter: All / Saved / Used / Archive (the last bucket includes
// rejected + archived statuses). Draft and Reviewed merge into All by
// default — this is more compact than a 6-tab strip and matches /ideas'
// 3-tab cadence.
//
// Generate: requires exactly one selected pillar so we can call
// /api/concepts/generate with a single pillar_id. The button label
// changes based on selection state.

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Loader2, Sparkles, Star, Trash2, ChevronDown, ChevronUp, RefreshCw, X, Archive, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import AppLayout, { displayBg, getPairedTextColor } from '@/components/AppLayout'
import PillarFolderChip, { AllIdeasFolderChip } from '@/components/PillarFolderChip'
import { featureFlags } from '@/lib/env'

interface Pillar {
    id: string
    name: string
    color: string
    description?: string | null
    is_series?: boolean
}

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
    pillars?: { id: string; name: string; color: string }
    // UI-local
    isExpanded?: boolean
    isStyling?: boolean
}

type FilterTab = 'All' | 'Saved' | 'Used' | 'Archive'

export default function ConceptsPage() {
    const supabase = createClient()
    const [pillars, setPillars] = useState<Pillar[]>([])
    const [concepts, setConcepts] = useState<Concept[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [isGenerating, setIsGenerating] = useState(false)
    const [isImporting, setIsImporting] = useState(false)
    const [selectedPillars, setSelectedPillars] = useState<string[]>([])
    const [filterTab, setFilterTab] = useState<FilterTab>('All')
    const [showVoiceAdapted, setShowVoiceAdapted] = useState(true)
    const [toasts, setToasts] = useState<{ id: string; message: string }[]>([])

    const showToast = useCallback((message: string) => {
        const id = Math.random().toString()
        setToasts(prev => [...prev, { id, message }])
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000)
    }, [])

    const getToken = useCallback(async () => {
        const { data } = await supabase.auth.getSession()
        return data.session?.access_token
    }, [supabase])

    // Initial load: pillars (direct via supabase client) + concepts (API).
    useEffect(() => {
        const loadData = async () => {
            setIsLoading(true)

            const { data: pillarsData } = await supabase
                .from('pillars')
                .select('*')
                .order('created_at', { ascending: true })
            if (pillarsData) setPillars(pillarsData)

            const token = await getToken()
            if (token) {
                try {
                    const res = await fetch('/api/concepts?limit=200', {
                        headers: { Authorization: `Bearer ${token}` },
                    })
                    if (res.status === 503) {
                        showToast('Concepts feature is not enabled in this environment.')
                    } else if (res.ok) {
                        const data = await res.json()
                        if (Array.isArray(data)) setConcepts(data.map(c => ({ ...c, isExpanded: false })))
                    }
                } catch (e) {
                    console.error('Failed to fetch concepts:', e)
                }
            }
            setIsLoading(false)
        }
        loadData()
    }, [supabase, getToken, showToast])

    const togglePillar = (id: string) => {
        // Single-select for the generate flow. Clicking the same pillar
        // again deselects (back to "All").
        setSelectedPillars(prev => (prev.length === 1 && prev[0] === id ? [] : [id]))
    }

    const generateForSelected = async () => {
        if (selectedPillars.length !== 1) {
            showToast('Pick exactly one pillar to generate concepts for.')
            return
        }
        setIsGenerating(true)
        const token = await getToken()
        try {
            const res = await fetch('/api/concepts/generate', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ pillar_id: selectedPillars[0], count: 5 }),
            })
            const data = await res.json()
            if (res.ok && Array.isArray(data.concepts)) {
                // Concepts API returns rows without the joined pillars relation;
                // attach manually so cards render colors immediately.
                const enriched = data.concepts.map((c: Concept) => ({
                    ...c,
                    pillars: pillars.find(p => p.id === c.pillar_id),
                    isExpanded: false,
                }))
                setConcepts(prev => [...enriched, ...prev])
                const rejected = data.rejected_count ?? 0
                const msg = rejected > 0
                    ? `✦ ${enriched.length} concepts generated · ${rejected} rejected by validator`
                    : `✦ ${enriched.length} concepts generated`
                showToast(msg)
            } else if (res.status === 200 && data.error === 'no_concepts_passed_validation') {
                showToast('All candidates rejected. Try adjusting the pillar or running again.')
            } else {
                throw new Error(data.error ?? `HTTP ${res.status}`)
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Generation failed'
            showToast(`Failed to generate: ${msg}`)
        } finally {
            setIsGenerating(false)
        }
    }

    const importLegacy = async () => {
        setIsImporting(true)
        const token = await getToken()
        try {
            const res = await fetch('/api/concepts/import-legacy', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
            })
            const data = await res.json()
            if (res.ok) {
                showToast(`Imported ${data.imported} legacy ideas`)
                if (data.imported > 0) {
                    // Reload list to pick up the imports.
                    const listRes = await fetch('/api/concepts?limit=200', {
                        headers: { Authorization: `Bearer ${token}` },
                    })
                    if (listRes.ok) {
                        const fresh = await listRes.json()
                        if (Array.isArray(fresh)) {
                            setConcepts(fresh.map((c: Concept) => ({ ...c, isExpanded: false })))
                        }
                    }
                }
            } else {
                throw new Error(data.error ?? 'Import failed')
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Import failed'
            showToast(msg)
        } finally {
            setIsImporting(false)
        }
    }

    // Generic status-change helper (handles save / used / reject / archive).
    // Optimistic update with revert-on-fail.
    const transitionStatus = async (concept: Concept, to: Concept['status']) => {
        const previous = concept.status
        setConcepts(prev => prev.map(c => (c.id === concept.id ? { ...c, status: to } : c)))

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
                const data = await res.json().catch(() => ({}))
                throw new Error(data.error ?? `HTTP ${res.status}`)
            }
            const verb = to === 'saved' ? 'Saved' : to === 'used' ? 'Marked used' : to === 'rejected' ? 'Rejected' : 'Archived'
            showToast(verb)
        } catch (err) {
            setConcepts(prev => prev.map(c => (c.id === concept.id ? { ...c, status: previous } : c)))
            const msg = err instanceof Error ? err.message : 'Status change failed'
            showToast(msg)
        }
    }

    const deleteConcept = async (concept: Concept) => {
        if (!confirm(`Delete "${concept.title}" permanently?`)) return
        const token = await getToken()
        const previous = concepts
        setConcepts(prev => prev.filter(c => c.id !== concept.id))
        try {
            const res = await fetch(`/api/concepts/${concept.id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
            })
            if (!res.ok) throw new Error()
            showToast('Concept deleted')
        } catch {
            setConcepts(previous)
            showToast('Failed to delete concept')
        }
    }

    // Lazy stylist trigger — only meaningful for tail concepts that PASS 3
    // skipped during eager top-K. Idempotent on the backend.
    const styleConcept = async (concept: Concept) => {
        if (concept.voice_adapted_text) return
        setConcepts(prev => prev.map(c => (c.id === concept.id ? { ...c, isStyling: true } : c)))
        const token = await getToken()
        try {
            const res = await fetch(`/api/concepts/${concept.id}/style`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error ?? 'Style failed')
            setConcepts(prev =>
                prev.map(c =>
                    c.id === concept.id
                        ? {
                              ...c,
                              voice_adapted_title: data.voice_adapted_title ?? null,
                              voice_adapted_hook: data.voice_adapted_hook ?? null,
                              voice_adapted_text: data.voice_adapted_text ?? null,
                              isStyling: false,
                          }
                        : c,
                ),
            )
            if (data.no_voice_profile) {
                showToast('No voice profile yet — upload more videos to enable styling.')
            } else if (data.already_styled) {
                showToast('Already styled.')
            } else {
                showToast('Voice-adapted ✓')
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Style failed'
            setConcepts(prev => prev.map(c => (c.id === concept.id ? { ...c, isStyling: false } : c)))
            showToast(msg)
        }
    }

    // Status-filter logic. Pillar filter is independent.
    const filteredConcepts = concepts.filter(c => {
        if (selectedPillars.length > 0 && (!c.pillar_id || !selectedPillars.includes(c.pillar_id))) return false
        if (filterTab === 'Saved') return c.status === 'saved'
        if (filterTab === 'Used') return c.status === 'used'
        if (filterTab === 'Archive') return c.status === 'rejected' || c.status === 'archived'
        // 'All' — everything except rejected + archived.
        return c.status !== 'rejected' && c.status !== 'archived'
    })

    const conceptPipelineEnabled = featureFlags.conceptPipeline()

    if (!conceptPipelineEnabled) {
        return (
            <AppLayout>
                <div className="max-w-2xl mx-auto py-24 text-center">
                    <Sparkles className="h-12 w-12 mx-auto text-ink-faint mb-4" />
                    <h1 className="text-title-1 mb-3">concepts</h1>
                    <p className="text-ink-muted">
                        the new creator workspace is not enabled in this environment. set
                        <code className="mx-1 px-1.5 py-0.5 rounded bg-ink/[0.06] text-xs">NEXT_PUBLIC_CONCEPT_PIPELINE=true</code>
                        in your env to unlock it.
                    </p>
                </div>
            </AppLayout>
        )
    }

    const selectedPillar = selectedPillars.length === 1 ? pillars.find(p => p.id === selectedPillars[0]) : null

    return (
        <AppLayout>
            <div className="flex-1 flex flex-col overflow-hidden w-full relative">
                <main className="flex-1 w-full">
                    <div className="w-full max-w-7xl mx-auto space-y-8">
                        {/* Top bar */}
                        <div className="flex items-center justify-between mb-8">
                            <div>
                                <h1 className="text-title-1 text-ink">concepts</h1>
                                <p className="text-ink-muted text-sm mt-1">
                                    novel concepts first; voice gets applied later, not during ideation.
                                </p>
                            </div>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => setShowVoiceAdapted(v => !v)}
                                    className="text-xs font-medium text-ink-muted hover:text-ink bg-ink/[0.06] hover:bg-ink/[0.1] rounded-full px-4 py-2 transition-colors flex items-center gap-1.5"
                                    title="Toggle between original concept and voice-adapted version"
                                >
                                    <Wand2 className="h-3.5 w-3.5" />
                                    {showVoiceAdapted ? 'in voice' : 'original'}
                                </button>
                                <Button
                                    onClick={generateForSelected}
                                    disabled={isGenerating || selectedPillars.length !== 1}
                                    className="bg-ink text-paper hover:bg-ink/90 transition-all font-medium rounded-full px-5 py-5 shadow-sm min-w-[170px]"
                                >
                                    {isGenerating ? (
                                        <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> 3-pass running…</>
                                    ) : selectedPillar ? (
                                        <><Sparkles className="mr-2 h-4 w-4" /> generate · {selectedPillar.name}</>
                                    ) : (
                                        <><Sparkles className="mr-2 h-4 w-4" /> pick a pillar</>
                                    )}
                                </Button>
                            </div>
                        </div>

                        {/* Pillar chip row (single-select for generate). */}
                        <div className="mb-4">
                            <div className="flex items-start justify-between mb-5">
                                <div>
                                    <h3 className="text-title-3 text-ink leading-tight">filter by pillar</h3>
                                    <p className="text-ink-muted text-sm mt-1">
                                        click a pillar to filter the list and unlock the generate button for that pillar.
                                    </p>
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-4 relative">
                                {pillars.length === 0 ? (
                                    <p className="text-ink-muted text-sm w-full">
                                        no pillars yet.{' '}
                                        <a href="/ideas" className="font-bold text-blue-600 hover:underline">
                                            visit /ideas to create them
                                        </a>{' '}
                                        — concepts shares the same pillar list as legacy ideas.
                                    </p>
                                ) : (
                                    <AllIdeasFolderChip
                                        isSelected={selectedPillars.length === 0}
                                        onClick={() => setSelectedPillars([])}
                                    />
                                )}

                                {pillars.map(p => (
                                    <PillarFolderChip
                                        key={p.id}
                                        name={p.name}
                                        color={p.color}
                                        isSelected={selectedPillars.includes(p.id)}
                                        isSeries={p.is_series}
                                        onClick={() => togglePillar(p.id)}
                                        // No delete/rename here — pillar mutation lives on /ideas
                                        // until M5 workspace ships.
                                        onDelete={undefined as unknown as (e: React.MouseEvent) => void}
                                        onRename={undefined as unknown as (e: React.MouseEvent) => void}
                                    />
                                ))}
                            </div>
                        </div>

                        {/* Status tabs. */}
                        <div className="flex gap-1 p-1 bg-ink/5 dark:bg-ink/5 rounded-lg w-fit">
                            {(['All', 'Saved', 'Used', 'Archive'] as const).map(tab => (
                                <button
                                    key={tab}
                                    onClick={() => setFilterTab(tab)}
                                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${filterTab === tab ? 'bg-paper-elevated shadow-sm text-ink' : 'text-ink-muted hover:text-ink'}`}
                                >
                                    {tab.toLowerCase()}
                                </button>
                            ))}
                        </div>

                        {/* Concept grid. items-start so an expanded card
                            doesn't stretch its sibling — CSS-grid default
                            is align-items: stretch which made each row's
                            cards match the tallest one's height. */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-20 items-start">
                            {isLoading && Array.from({ length: 4 }).map((_, i) => (
                                <div key={`l-${i}`} className="h-72 rounded-2xl bg-paper-sunken animate-pulse" />
                            ))}

                            {isGenerating && Array.from({ length: 3 }).map((_, i) => (
                                <div key={`g-${i}`} className="h-72 rounded-2xl bg-paper-sunken animate-pulse" />
                            ))}

                            {!isLoading && filteredConcepts.length === 0 && !isGenerating && (
                                <div className="col-span-full flex flex-col items-center justify-center py-24 text-center">
                                    <div className="bg-paper-sunken p-4 rounded-full mb-4 flex items-center justify-center">
                                        <Sparkles className="h-12 w-12 text-ink-faint" />
                                    </div>
                                    <h3 className="text-title-3 text-ink mb-2">
                                        {filterTab === 'All' ? 'no concepts yet' : `no ${filterTab.toLowerCase()} concepts`}
                                    </h3>
                                    {filterTab === 'All' && (
                                        <>
                                            <p className="text-body-sm text-ink-muted mb-6 max-w-md">
                                                pick a pillar above and click <span className="font-semibold">generate</span> to run the
                                                3-pass pipeline (concept → validate → style). first pass is voice-AGNOSTIC; voice
                                                only gets applied at the end.
                                            </p>
                                            <Button
                                                onClick={importLegacy}
                                                disabled={isImporting}
                                                variant="outline"
                                                className="rounded-full px-5 transition-colors"
                                            >
                                                {isImporting ? (
                                                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> importing…</>
                                                ) : (
                                                    <><RefreshCw className="mr-2 h-4 w-4" /> import my saved ideas from /ideas</>
                                                )}
                                            </Button>
                                        </>
                                    )}
                                </div>
                            )}

                            {!isLoading && filteredConcepts.map(concept => {
                                const pillar = concept.pillars || pillars.find(p => p.id === concept.pillar_id)
                                const comboColorBg = pillar?.color ? displayBg(pillar.color) : 'var(--paper-elevated)'
                                const isDefault = !pillar?.color
                                const cardInk = !isDefault && pillar?.color ? getPairedTextColor(pillar.color) : ''
                                const inkMuted = cardInk ? `color-mix(in srgb, ${cardInk} 75%, transparent)` : ''
                                const inkFaint = cardInk ? `color-mix(in srgb, ${cardInk} 55%, transparent)` : ''
                                const inkSubtle = cardInk ? `color-mix(in srgb, ${cardInk} 25%, transparent)` : ''

                                const useVoiceAdapted = showVoiceAdapted && Boolean(concept.voice_adapted_text)
                                const displayTitle = useVoiceAdapted && concept.voice_adapted_title ? concept.voice_adapted_title : concept.title
                                const displayHook = useVoiceAdapted && concept.voice_adapted_hook ? concept.voice_adapted_hook : concept.hook

                                const composite = concept.score?.composite ?? null
                                const compositePct = composite != null ? Math.round(composite * 100) : null

                                const isMuted = concept.status === 'used' || concept.status === 'rejected' || concept.status === 'archived'

                                return (
                                    <div
                                        key={concept.id}
                                        className={`relative flex flex-col rounded-3xl border ${isDefault ? 'border-rule bg-paper-elevated' : 'border-transparent'} p-6 shadow-sm transition-opacity duration-300 ${isMuted ? 'opacity-60' : 'opacity-100'} overflow-hidden`}
                                        style={{
                                            backgroundColor: isDefault ? undefined : comboColorBg,
                                            color: isDefault ? undefined : cardInk,
                                        }}
                                    >
                                        {!isDefault && (
                                            <div className="absolute right-0 top-0 bottom-0 w-32 pointer-events-none z-0">
                                                <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full fill-current opacity-10">
                                                    <path d="M100,0 L0,50 L100,100 Z" />
                                                </svg>
                                            </div>
                                        )}

                                        {concept.isStyling && (
                                            <div className="absolute inset-0 z-20 flex items-center justify-center bg-paper-elevated/80 rounded-3xl backdrop-blur-sm">
                                                <Loader2 className="h-8 w-8 animate-spin text-ink" />
                                            </div>
                                        )}

                                        <div className="relative z-10 flex flex-col h-full">
                                            {/* Top row: pillar badge + status pill + save star */}
                                            <div className="mb-3 flex items-center justify-between gap-2">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <span
                                                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-medium ${isDefault ? 'bg-ink/[0.06] text-ink-muted' : ''}`}
                                                        style={isDefault ? undefined : { backgroundColor: inkSubtle, color: cardInk }}
                                                    >
                                                        {pillar?.name || 'uncategorized'}
                                                    </span>
                                                    <span
                                                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-medium ${isDefault ? 'bg-ink/[0.04] text-ink-faint' : ''}`}
                                                        style={isDefault ? undefined : { backgroundColor: inkSubtle, color: inkMuted }}
                                                    >
                                                        {concept.status}
                                                    </span>
                                                    {compositePct != null && (
                                                        <span
                                                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-mono font-medium ${isDefault ? 'bg-ink/[0.04] text-ink-faint' : ''}`}
                                                            style={isDefault ? undefined : { backgroundColor: inkSubtle, color: inkMuted }}
                                                            title={`novelty ${concept.score?.novelty?.toFixed(2)} · fit ${concept.score?.fit?.toFixed(2)} · specificity ${concept.score?.specificity?.toFixed(2)}`}
                                                        >
                                                            {compositePct}%
                                                        </span>
                                                    )}
                                                </div>
                                                <button
                                                    onClick={() => transitionStatus(concept, concept.status === 'saved' ? 'draft' : 'saved')}
                                                    className={`shrink-0 transition-colors hover:scale-110 ${isDefault ? (concept.status === 'saved' ? 'text-blue-500' : 'text-ink-faint hover:text-ink-muted') : ''}`}
                                                    style={isDefault ? undefined : { color: concept.status === 'saved' ? cardInk : inkFaint }}
                                                    title={concept.status === 'saved' ? 'Unsave' : 'Save'}
                                                >
                                                    <Star className={`h-5 w-5 ${concept.status === 'saved' ? 'fill-current' : ''}`} strokeWidth={concept.status === 'saved' ? 2 : 1.5} />
                                                </button>
                                            </div>

                                            {/* Title */}
                                            <h2
                                                className={`text-xl md:text-2xl font-semibold tracking-tight leading-tight mb-5 ${isDefault ? 'text-ink' : ''}`}
                                                style={isDefault ? undefined : { color: cardInk }}
                                            >
                                                {displayTitle}
                                            </h2>

                                            {/* Hook */}
                                            {displayHook && (
                                                <div className="mb-5">
                                                    <span
                                                        className={`text-[11px] font-semibold block mb-1.5 ${isDefault ? 'text-ink-faint' : ''}`}
                                                        style={isDefault ? undefined : { color: inkFaint }}
                                                    >
                                                        hook
                                                    </span>
                                                    <p
                                                        className={`text-base md:text-lg font-medium ${isDefault ? 'text-ink' : ''}`}
                                                        style={isDefault ? undefined : { color: cardInk }}
                                                    >
                                                        &ldquo;{displayHook}&rdquo;
                                                    </p>
                                                </div>
                                            )}

                                            {/* Voice-adapted hint */}
                                            {!concept.voice_adapted_text && concept.status !== 'archived' && (
                                                <button
                                                    onClick={() => styleConcept(concept)}
                                                    className={`text-[11px] mb-3 self-start font-medium flex items-center gap-1.5 ${isDefault ? 'text-blue-600 hover:text-blue-700' : ''}`}
                                                    style={isDefault ? undefined : { color: inkMuted }}
                                                >
                                                    <Wand2 className="h-3 w-3" /> apply your voice (1 model call)
                                                </button>
                                            )}

                                            {/* Expandable: ai_reason + structure */}
                                            <div
                                                className={`mb-6 pt-4 border-t ${isDefault ? 'border-rule-soft' : ''}`}
                                                style={isDefault ? undefined : { borderColor: inkSubtle }}
                                            >
                                                <button
                                                    onClick={() => setConcepts(prev => prev.map(c => c.id === concept.id ? { ...c, isExpanded: !c.isExpanded } : c))}
                                                    className={`flex items-center text-xs font-medium transition-colors ${isDefault ? 'text-ink-muted hover:text-ink' : ''}`}
                                                    style={isDefault ? undefined : { color: inkMuted }}
                                                >
                                                    {concept.isExpanded ? (
                                                        <><ChevronUp className="mr-1 h-3.5 w-3.5" /> less</>
                                                    ) : (
                                                        <><ChevronDown className="mr-1 h-3.5 w-3.5" /> reasoning &amp; structure</>
                                                    )}
                                                </button>

                                                {concept.isExpanded && (
                                                    <div
                                                        className={`mt-5 space-y-5 rounded-2xl p-5 md:p-6 ${isDefault ? 'bg-paper-sunken' : ''}`}
                                                        style={isDefault ? undefined : { backgroundColor: inkSubtle }}
                                                    >
                                                        {concept.angle && (
                                                            <div>
                                                                <span className={`text-[11px] font-semibold block mb-2 ${isDefault ? 'text-ink-faint' : ''}`} style={isDefault ? undefined : { color: inkFaint }}>
                                                                    angle
                                                                </span>
                                                                <p className={`text-sm leading-relaxed ${isDefault ? 'text-ink-muted' : ''}`} style={isDefault ? undefined : { color: cardInk }}>
                                                                    {concept.angle}
                                                                </p>
                                                            </div>
                                                        )}
                                                        {concept.ai_reason && (
                                                            <div>
                                                                <span className={`text-[11px] font-semibold block mb-2 ${isDefault ? 'text-ink-faint' : ''}`} style={isDefault ? undefined : { color: inkFaint }}>
                                                                    why this is novel
                                                                </span>
                                                                <p className={`text-sm leading-relaxed ${isDefault ? 'text-ink-muted' : ''}`} style={isDefault ? undefined : { color: cardInk }}>
                                                                    {concept.ai_reason}
                                                                </p>
                                                            </div>
                                                        )}
                                                        {concept.structure ? (() => {
                                                            // PASS 1's structure jsonb is shaped {format, beats[]}.
                                                            // Render that readably; fall back to a compact JSON
                                                            // view only if the shape is unexpected.
                                                            const s = concept.structure as { format?: unknown; beats?: unknown };
                                                            const beats = Array.isArray(s.beats)
                                                                ? (s.beats.filter(b => typeof b === 'string') as string[])
                                                                : [];
                                                            const format = typeof s.format === 'string' ? s.format : null;
                                                            const knownShape = beats.length > 0 || format;
                                                            return (
                                                                <div>
                                                                    <span className={`text-[11px] font-semibold block mb-2 ${isDefault ? 'text-ink-faint' : ''}`} style={isDefault ? undefined : { color: inkFaint }}>
                                                                        how this video runs
                                                                    </span>
                                                                    {knownShape ? (
                                                                        <div className={`text-sm space-y-2 ${isDefault ? 'text-ink' : ''}`} style={isDefault ? undefined : { color: cardInk }}>
                                                                            {format && (
                                                                                <p>
                                                                                    <span className={isDefault ? 'text-ink-muted' : ''} style={isDefault ? undefined : { color: inkMuted }}>format · </span>
                                                                                    {format}
                                                                                </p>
                                                                            )}
                                                                            {beats.length > 0 && (
                                                                                <ol className="space-y-1 list-decimal list-inside marker:text-current/60">
                                                                                    {beats.map((b, i) => (
                                                                                        <li key={i} className="leading-relaxed">{b}</li>
                                                                                    ))}
                                                                                </ol>
                                                                            )}
                                                                        </div>
                                                                    ) : (
                                                                        <pre className={`text-xs leading-relaxed font-mono whitespace-pre-wrap ${isDefault ? 'text-ink-muted' : ''}`} style={isDefault ? undefined : { color: cardInk }}>
                                                                            {JSON.stringify(concept.structure, null, 2)}
                                                                        </pre>
                                                                    )}
                                                                </div>
                                                            );
                                                        })() : null}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Bottom row: actions */}
                                            <div
                                                className={`flex items-center justify-between mt-auto pt-4 border-t ${isDefault ? 'border-rule-soft' : ''}`}
                                                style={isDefault ? undefined : { borderColor: inkSubtle }}
                                            >
                                                <a
                                                    href={`/concepts/${concept.id}`}
                                                    className={`text-xs font-medium transition-colors ${isDefault ? 'text-ink-muted hover:text-ink underline-offset-2 hover:underline' : 'underline-offset-2 hover:underline'}`}
                                                    style={isDefault ? undefined : { color: inkMuted }}
                                                >
                                                    open →
                                                </a>
                                                <div className="flex items-center gap-2">
                                                    {concept.status === 'saved' && (
                                                        <button
                                                            onClick={() => transitionStatus(concept, 'used')}
                                                            className={`flex items-center px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${isDefault ? 'bg-ink/[0.06] text-ink-muted hover:bg-ink/[0.1]' : ''}`}
                                                            style={isDefault ? undefined : { backgroundColor: inkSubtle, color: cardInk }}
                                                        >
                                                            mark used
                                                        </button>
                                                    )}
                                                    {concept.status !== 'rejected' && concept.status !== 'archived' && (
                                                        <button
                                                            onClick={() => transitionStatus(concept, 'rejected')}
                                                            className={`flex items-center px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${isDefault ? 'text-ink-muted hover:bg-ink/[0.08]' : ''}`}
                                                            style={isDefault ? undefined : { color: inkMuted }}
                                                            title="Reject this concept"
                                                        >
                                                            <X className="h-3.5 w-3.5" />
                                                        </button>
                                                    )}
                                                    {concept.status !== 'archived' && (
                                                        <button
                                                            onClick={() => transitionStatus(concept, 'archived')}
                                                            className={`flex items-center px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${isDefault ? 'text-ink-muted hover:bg-ink/[0.08]' : ''}`}
                                                            style={isDefault ? undefined : { color: inkMuted }}
                                                            title="Archive (hide from main list)"
                                                        >
                                                            <Archive className="h-3.5 w-3.5" />
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => deleteConcept(concept)}
                                                        className={`rounded-xl p-2 transition-colors ${isDefault ? 'text-ink-faint hover:bg-red-50 hover:text-red-500' : ''}`}
                                                        style={isDefault ? undefined : { color: inkFaint }}
                                                        title="Delete permanently"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </button>
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
