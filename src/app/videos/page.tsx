'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Trash2, Calendar, Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import AppLayout, { getPairedTextColor } from '@/components/AppLayout'
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
                            <h1 className="text-2xl md:text-4xl font-heading uppercase tracking-tight text-[var(--text-primary)]">Video Library</h1>
                            <Link href="/upload">
                                <Button
                                    className="bg-[var(--text-primary)] text-[var(--bg-primary)] hover:scale-105 transition-all font-heading rounded-full px-5 py-5 shadow-sm"
                                >
                                    Upload new video
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
                                    <Folder color="var(--combo-3-bg)" size="sm" tilt={-3} />
                                    <h3 className="text-xl font-heading tracking-tight text-[var(--text-primary)] mt-6 mb-2 uppercase">An empty shelf</h3>
                                    <p className="font-caslon italic text-lg text-[var(--text-primary)]/70 mb-6 max-w-sm">
                                        Upload a video to start filling your library. We&rsquo;ll transcribe it, tag it to a pillar, and file it here.
                                    </p>
                                    <Link href="/upload">
                                        <Button className="bg-[var(--text-primary)] text-[var(--bg-primary)] rounded-full px-6 transition-transform hover:scale-105 font-ui">
                                            Upload your first video
                                        </Button>
                                    </Link>
                                </div>
                            )}

                            {!isLoading && transcripts.map(transcript => {
                                const mainColor = transcript.attachedPillars?.[0]?.color || '#9ca3af';

                                return (
                                    <div key={transcript.id} className="relative flex flex-col rounded-2xl border border-gray-200 dark:border-gray-800 bg-[var(--bg-panel)] shadow-sm hover:shadow-lg transition-shadow">
                                        {/* Folder cover */}
                                        <div className="w-full flex items-end justify-center pt-6 pb-3 px-5 bg-black/[0.02] dark:bg-white/[0.02] border-b border-gray-100 dark:border-gray-800 rounded-t-2xl">
                                            <Folder
                                                color={mainColor}
                                                monogram={(transcript.videos?.file_name || 'V').trim().charAt(0).toUpperCase()}
                                                size="sm"
                                            />
                                        </div>

                                        <div className="p-5 flex flex-col flex-1">
                                            <div className="flex items-start justify-between mb-3">
                                                <div className="flex flex-col">
                                                    <h2 className="text-base font-bold font-heading text-gray-900 dark:text-white truncate max-w-[200px] mb-2" title={transcript.videos?.file_name}>
                                                        {transcript.videos?.file_name || 'Untitled Video'}
                                                    </h2>

                                                    {/* Pillar Tags */}
                                                    {transcript.attachedPillars && transcript.attachedPillars.length > 0 ? (
                                                        <div className="flex flex-wrap gap-1.5 mb-2">
                                                            {transcript.attachedPillars.map(p => (
                                                                <span
                                                                    key={p.id}
                                                                    className="inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                                                                    style={{ backgroundColor: p.color, color: getPairedTextColor(p.color) }}
                                                                >
                                                                    {p.name}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <div className="flex mb-2">
                                                            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-gray-600 bg-gray-200">
                                                                Uncategorized
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Action */}
                                                <div className="flex items-center gap-2 relative z-20">
                                                    {transcript.isDeleting ? (
                                                        <div className="absolute right-0 top-0 bg-[var(--bg-panel)] shadow-xl border border-gray-100 dark:border-gray-800 rounded-xl p-3 flex flex-col gap-2 min-w-[220px]">
                                                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest text-center">Delete Options</span>
                                                            <button
                                                                onClick={() => confirmDelete(transcript.id, 'soft')}
                                                                className="text-xs font-bold font-heading border rounded-lg px-2 py-2 bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 transition-colors"
                                                            >
                                                                Hide from library
                                                                <span className="block text-[10px] font-normal text-gray-400 mt-0.5 normal-case tracking-normal">Transcript stays for voice profile</span>
                                                            </button>
                                                            <div className="border-t border-gray-100 dark:border-gray-800 pt-2">
                                                                <p className="text-[10px] text-[var(--combo-6-bg)] font-medium mb-1.5 px-1">
                                                                    Permanent delete removes the video, transcript, and ideas. This cannot be undone.
                                                                </p>
                                                                <button
                                                                    onClick={() => {
                                                                        if (transcript.hardDeleteArmed) {
                                                                            confirmDelete(transcript.id, 'hard')
                                                                        } else {
                                                                            setTranscripts(prev => prev.map(t => t.id === transcript.id ? { ...t, hardDeleteArmed: true } : t))
                                                                        }
                                                                    }}
                                                                    className={`w-full text-xs font-bold font-heading border rounded-lg px-2 py-2 transition-colors ${transcript.hardDeleteArmed
                                                                        ? 'bg-[var(--combo-6-bg)] border-[var(--combo-6-bg)] text-white hover:opacity-90'
                                                                        : 'bg-[var(--combo-6-bg)]/10 border-[var(--combo-6-bg)]/30 text-[var(--combo-6-bg)] hover:bg-[var(--combo-6-bg)]/20'
                                                                    }`}
                                                                >
                                                                    {transcript.hardDeleteArmed ? 'Click again to permanently delete' : 'Delete permanently'}
                                                                </button>
                                                            </div>
                                                            <button
                                                                onClick={() => setTranscripts(prev => prev.map(t => t.id === transcript.id ? { ...t, isDeleting: false, hardDeleteArmed: false } : t))}
                                                                className="text-xs font-medium text-gray-400 hover:text-gray-900 dark:hover:text-white pt-1"
                                                            >
                                                                Cancel
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
                                                                className="rounded-full p-2 text-[var(--text-primary)]/40 transition-colors hover:bg-blue-500/10 hover:text-blue-600"
                                                            >
                                                                <Layers className="h-4 w-4" />
                                                            </button>
                                                            <button
                                                                onClick={() => setTranscripts(prev => prev.map(t => t.id === transcript.id ? { ...t, isDeleting: true } : t))}
                                                                aria-label={`Delete ${transcript.videos?.file_name || 'video'}`}
                                                                className="rounded-full p-2 text-[var(--text-primary)]/40 transition-colors hover:bg-[var(--combo-6-bg)]/10 hover:text-[var(--combo-6-bg)]"
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Transcript Text Preview */}
                                            <div className="bg-black/5 dark:bg-white/5 rounded-lg p-3 max-h-[100px] overflow-hidden relative mt-auto border border-gray-100 dark:border-gray-800">
                                                <div className="absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-[var(--bg-panel)] to-transparent pointer-events-none"></div>
                                                <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed font-ui">
                                                    {transcript.raw_text}
                                                </p>
                                            </div>

                                            <div className="mt-4 flex items-center justify-between text-[10px] text-[var(--text-primary)]/60 font-bold uppercase tracking-wider font-heading border-t border-gray-100 dark:border-gray-800 pt-3">
                                                <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {new Date(transcript.created_at).toLocaleDateString()}</span>
                                                <span className="flex items-center gap-1.5">
                                                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: mainColor }} aria-hidden="true" />
                                                    Analyzed
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
