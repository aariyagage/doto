'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Trash2, Calendar, Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import AppLayout, { getPairedTextColor, displayBg } from '@/components/AppLayout'
import { useToast } from '@/components/toast'
import Folder from '@/components/Folder'
import PillarSeriesDeclareModal from '@/components/PillarSeriesDeclareModal'

interface Pillar {
    id: string;
    name: string;
    color: string;
    is_series?: boolean;
}

interface VideoPillar {
    video_id: string;
    pillar_id: string;
}

interface Transcript {
    id: string;
    video_id: string;
    raw_text: string;
    created_at: string;
    videos?: { file_name: string };
    attachedPillars?: Pillar[];
    isDeleting?: boolean;
    hardDeleteArmed?: boolean;
}

export default function VideoLibraryPage() {
    const supabase = createClient()
    const { showToast } = useToast()
    const [transcripts, setTranscripts] = useState<Transcript[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [seriesModalVideoId, setSeriesModalVideoId] = useState<string | null>(null)
    const [seriesModalVideoTitle, setSeriesModalVideoTitle] = useState<string | undefined>(undefined)

    const loadData = useCallback(async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            setIsLoading(false)
            return
        }

        // Fetch pillars (owned by this user)
        const { data: pillarsData } = await supabase
            .from('pillars')
            .select('*')
            .eq('user_id', user.id)

        const pillars: Pillar[] = pillarsData || [];

        // Fetch this user's transcripts with the joined video filenames
        const { data: tsData, error } = await supabase
            .from('transcripts')
            .select(`
                id,
                video_id,
                raw_text,
                created_at,
                videos ( file_name )
            `)
            .eq('user_id', user.id)
            .or('is_hidden.is.null,is_hidden.eq.false')
            .order('created_at', { ascending: false })

        // video_pillars has no user_id column — scope by video_ids the user owns.
        const userVideoIds = (tsData || []).map(t => t.video_id);
        const { data: vpData } = userVideoIds.length > 0
            ? await supabase.from('video_pillars').select('*').in('video_id', userVideoIds)
            : { data: [] };
        const videoPillars: VideoPillar[] = vpData || [];

        if (!error && tsData) {
            // Map the resolved pillars to each transcript
            const processed = tsData.map(t => {
                const tvps = videoPillars.filter(vp => vp.video_id === t.video_id);
                const attachedPillars = tvps.map(vp => pillars.find(p => p.id === vp.pillar_id)).filter(Boolean) as Pillar[];
                return {
                    ...t,
                    videos: Array.isArray(t.videos) ? t.videos[0] : t.videos,
                    attachedPillars,
                    isDeleting: false
                }
            }) as Transcript[];

            setTranscripts(processed)
        }

        setIsLoading(false)
    }, [supabase])

    useEffect(() => {
        setIsLoading(true)
        loadData()
    }, [loadData])

    const confirmDelete = async (id: string, type: 'soft' | 'hard') => {
        try {
            const { data: sessionData } = await supabase.auth.getSession()
            // getSession() is correct here — we only need the JWT to attach to the
            // request; the server revalidates with getUser() before acting.
            const token = sessionData.session?.access_token

            const res = await fetch(`/api/transcripts/${id}?type=${type}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            })
            if (res.ok) {
                setTranscripts(prev => prev.filter(t => t.id !== id))
                showToast(type === 'soft' ? "Video hidden from library" : "Video permanently deleted", 'success')
            } else {
                throw new Error("Failed to delete")
            }
        } catch {
            showToast("Failed to delete transcript", 'error')
            setTranscripts(prev => prev.map(t => t.id === id ? { ...t, isDeleting: false, hardDeleteArmed: false } : t))
        }
    }

    return (
        <AppLayout>
            <div className="flex-1 flex flex-col overflow-hidden w-full relative">
                <main className="flex-1 w-full">
                    <div className="w-full max-w-7xl mx-auto space-y-8">
                        {/* Top Bar */}
                        <div className="flex items-center justify-between mb-8">
                            <h1 className="text-title-1 text-ink">library</h1>
                            <Link href="/upload">
                                <Button
                                    className="bg-ink text-paper hover:bg-ink/90 transition-colors rounded-full px-5 h-10 font-medium"
                                >
                                    upload video
                                </Button>
                            </Link>
                        </div>

                        {/* List */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {isLoading && (
                                Array.from({ length: 6 }).map((_, i) => (
                                    <div key={`loading-${i}`} className="h-64 rounded-2xl bg-[var(--skeleton)] animate-pulse w-full"></div>
                                ))
                            )}

                            {!isLoading && transcripts.length === 0 && (
                                <div className="col-span-full flex flex-col items-center justify-center py-16 md:py-24 text-center">
                                    <Folder color="var(--combo-3-bg)" size="sm" />
                                    <h3 className="text-title-3 text-ink mt-6 mb-2">an empty shelf</h3>
                                    <p className="text-body-sm text-ink-muted mb-6 max-w-sm">
                                        upload a video to start filling your library. we&rsquo;ll transcribe it, tag it to a pillar, and file it here.
                                    </p>
                                    <Link href="/upload">
                                        <Button className="bg-ink text-paper rounded-full px-6 hover:bg-ink/90 transition-colors font-medium">
                                            upload your first video
                                        </Button>
                                    </Link>
                                </div>
                            )}

                            {!isLoading && transcripts.map(transcript => {
                                const mainColor = displayBg(transcript.attachedPillars?.[0]?.color || '#9ca3af');

                                return (
                                    <div key={transcript.id} className="relative flex flex-col rounded-2xl border border-rule bg-paper-elevated shadow-sm hover:shadow-md hover:border-ink/15 transition-all">
                                        {/* Folder cover */}
                                        <div className="w-full flex items-end justify-center pt-6 pb-3 px-5 bg-ink/[0.02] border-b border-rule rounded-t-2xl">
                                            <Folder
                                                color={mainColor}
                                                index={(transcript.videos?.file_name || 'V').trim().charAt(0).toUpperCase()}
                                                size="sm"
                                            />
                                        </div>

                                        <div className="p-5 flex flex-col flex-1">
                                            <div className="flex items-start justify-between mb-3">
                                                <div className="flex flex-col">
                                                    <h2 className="text-base font-semibold tracking-tight text-ink truncate max-w-[200px] mb-2" title={transcript.videos?.file_name}>
                                                        {transcript.videos?.file_name || 'untitled video'}
                                                    </h2>

                                                    {/* Pillar Tags */}
                                                    {transcript.attachedPillars && transcript.attachedPillars.length > 0 ? (
                                                        <div className="flex flex-wrap gap-1.5 mb-2">
                                                            {transcript.attachedPillars.map(p => (
                                                                <span
                                                                    key={p.id}
                                                                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                                                                    style={{ backgroundColor: displayBg(p.color), color: getPairedTextColor(p.color) }}
                                                                >
                                                                    {p.name}
                                                                    {p.is_series && (
                                                                        <span
                                                                            className="rounded-sm px-1 text-[8px] font-bold"
                                                                            style={{ backgroundColor: 'rgba(0,0,0,0.15)', color: getPairedTextColor(p.color) }}
                                                                            title="Series pillar"
                                                                        >
                                                                            Series
                                                                        </span>
                                                                    )}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <div className="flex mb-2">
                                                            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium text-ink-muted bg-ink/[0.06]">
                                                                uncategorized
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Action */}
                                                <div className="flex items-center gap-2 relative z-20">
                                                    {transcript.isDeleting ? (
                                                        <div className="absolute right-0 top-0 bg-paper-elevated shadow-xl border border-rule rounded-xl p-3 flex flex-col gap-2 min-w-[220px]">
                                                            <span className="text-[11px] font-medium text-ink-muted text-center">delete options</span>
                                                            <button
                                                                onClick={() => confirmDelete(transcript.id, 'soft')}
                                                                className="text-xs font-medium border rounded-lg px-2 py-2 bg-ink/[0.04] border-rule text-ink hover:bg-ink/[0.06] transition-colors"
                                                            >
                                                                hide from library
                                                                <span className="block text-[10px] font-normal text-ink-muted mt-0.5">transcript stays for voice profile</span>
                                                            </button>
                                                            <div className="border-t border-rule pt-2">
                                                                <p className="text-[11px] text-[var(--combo-6-bg)] font-medium mb-1.5 px-1">
                                                                    permanent delete removes the video, transcript, and ideas. this cannot be undone.
                                                                </p>
                                                                <button
                                                                    onClick={() => {
                                                                        if (transcript.hardDeleteArmed) {
                                                                            confirmDelete(transcript.id, 'hard')
                                                                        } else {
                                                                            setTranscripts(prev => prev.map(t => t.id === transcript.id ? { ...t, hardDeleteArmed: true } : t))
                                                                        }
                                                                    }}
                                                                    className={`w-full text-xs font-medium border rounded-lg px-2 py-2 transition-colors ${transcript.hardDeleteArmed
                                                                        ? 'bg-[var(--combo-6-bg)] border-[var(--combo-6-bg)] text-white hover:opacity-90'
                                                                        : 'bg-[var(--combo-6-bg)]/10 border-[var(--combo-6-bg)]/30 text-[var(--combo-6-bg)] hover:bg-[var(--combo-6-bg)]/20'
                                                                    }`}
                                                                >
                                                                    {transcript.hardDeleteArmed ? 'click again to permanently delete' : 'delete permanently'}
                                                                </button>
                                                            </div>
                                                            <button
                                                                onClick={() => setTranscripts(prev => prev.map(t => t.id === transcript.id ? { ...t, isDeleting: false, hardDeleteArmed: false } : t))}
                                                                className="text-xs font-medium text-ink-muted hover:text-ink pt-1"
                                                            >
                                                                cancel
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <>
                                                            <button
                                                                onClick={() => {
                                                                    setSeriesModalVideoId(transcript.video_id)
                                                                    setSeriesModalVideoTitle(transcript.videos?.file_name)
                                                                }}
                                                                aria-label={`Declare ${transcript.videos?.file_name || 'video'} as part of a series`}
                                                                title="Declare as series"
                                                                className="rounded-full p-2 text-ink-faint transition-colors hover:bg-blue-500/10 hover:text-blue-600"
                                                            >
                                                                <Layers className="h-4 w-4" />
                                                            </button>
                                                            <button
                                                                onClick={() => setTranscripts(prev => prev.map(t => t.id === transcript.id ? { ...t, isDeleting: true } : t))}
                                                                aria-label={`Delete ${transcript.videos?.file_name || 'video'}`}
                                                                className="rounded-full p-2 text-ink-faint transition-colors hover:bg-[var(--combo-6-bg)]/10 hover:text-[var(--combo-6-bg)]"
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Transcript Text Preview */}
                                            <div className="bg-ink/[0.03] rounded-lg p-3 max-h-[100px] overflow-hidden relative mt-auto border border-rule">
                                                <div className="absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-paper-elevated to-transparent pointer-events-none"></div>
                                                <p className="text-xs text-ink-muted leading-relaxed">
                                                    {transcript.raw_text}
                                                </p>
                                            </div>

                                            <div className="mt-4 flex items-center justify-between text-[11px] text-ink-muted font-medium border-t border-rule pt-3">
                                                <span className="flex items-center gap-1.5"><Calendar className="h-3 w-3" /> {new Date(transcript.created_at).toLocaleDateString()}</span>
                                                <span className="flex items-center gap-1.5">
                                                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: mainColor }} aria-hidden="true" />
                                                    analyzed
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                </main>
            </div>
            <PillarSeriesDeclareModal
                open={seriesModalVideoId !== null}
                onClose={() => {
                    setSeriesModalVideoId(null)
                    setSeriesModalVideoTitle(undefined)
                }}
                videoId={seriesModalVideoId || ''}
                videoTitle={seriesModalVideoTitle}
                onSuccess={() => {
                    showToast('Series declared. Pillar created and video tagged.', 'success')
                    loadData()
                }}
            />
        </AppLayout>
    )
}
