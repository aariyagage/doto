'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Trash2, PlaySquare, Calendar } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import AppLayout from '@/components/AppLayout'

interface Pillar {
    id: string;
    name: string;
    color: string;
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
}

export default function VideoLibraryPage() {
    const supabase = createClient()
    const [transcripts, setTranscripts] = useState<Transcript[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [toasts, setToasts] = useState<{ id: string, message: string }[]>([])

    // Fetch initial data
    useEffect(() => {
        const loadData = async () => {
            setIsLoading(true)

            // Fetch pillars
            const { data: pillarsData } = await supabase
                .from('pillars')
                .select('*')

            const pillars: Pillar[] = pillarsData || [];

            // Fetch video pillars mapping
            const { data: vpData } = await supabase
                .from('video_pillars')
                .select('*')

            const videoPillars: VideoPillar[] = vpData || [];

            // Fetch transcripts with video filenames
            const { data: tsData, error } = await supabase
                .from('transcripts')
                .select(`
                    id,
                    video_id,
                    raw_text,
                    created_at,
                    videos ( file_name )
                `)
                .or('is_hidden.is.null,is_hidden.eq.false')
                .order('created_at', { ascending: false })

            console.log('--- DEBUG FETCH ---');
            console.log('Session User:', (await supabase.auth.getSession()).data.session?.user?.id)
            console.log('tsData Error:', error);
            console.log('tsData raw:', tsData);
            console.log('vpData raw:', vpData);
            console.log('pillars raw:', pillars);

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

    const confirmDelete = async (id: string, type: 'soft' | 'hard') => {
        try {
            const { data: sessionData } = await supabase.auth.getSession()
            const token = sessionData.session?.access_token

            const res = await fetch(`/api/transcripts/${id}?type=${type}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            })
            if (res.ok) {
                setTranscripts(prev => prev.filter(t => t.id !== id))
                showToast(type === 'soft' ? "Video hidden from library" : "Video completely wiped")
            } else {
                throw new Error("Failed to delete")
            }
        } catch {
            showToast("Failed to delete transcript")
            setTranscripts(prev => prev.map(t => t.id === id ? { ...t, isDeleting: false } : t))
        }
    }

    return (
        <AppLayout>
            <div className="flex-1 flex flex-col overflow-hidden w-full relative">
                <main className="flex-1 w-full">
                    <div className="w-full max-w-7xl mx-auto space-y-8">
                        {/* Top Bar */}
                        <div className="flex items-center justify-between mb-8">
                            <h1 className="text-3xl md:text-5xl font-heading tracking-tight text-gray-900 dark:text-white">Video Library</h1>
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
                                    <div key={`loading-${i}`} className="h-64 rounded-2xl bg-gray-100 dark:bg-gray-800 animate-pulse w-full"></div>
                                ))
                            )}

                            {!isLoading && transcripts.length === 0 && (
                                <div className="col-span-full flex flex-col items-center justify-center py-24 text-center">
                                    <div className="bg-blue-50 p-4 rounded-full mb-4 flex items-center justify-center">
                                        <PlaySquare className="h-12 w-12 text-blue-500" />
                                    </div>
                                    <h3 className="text-xl font-bold font-heading text-gray-900 dark:text-white mb-2">No videos yet</h3>
                                    <p className="text-[var(--muted-foreground)] mb-6 max-w-sm font-ui">
                                        Upload videos to automatically generate transcripts, track your content pillars, and build your voice profile.
                                    </p>
                                    <Link href="/upload">
                                        <Button className="bg-[var(--text-primary)] text-[var(--bg-primary)] rounded-full px-6 transition-transform hover:scale-105 font-heading">
                                            Upload your first video
                                        </Button>
                                    </Link>
                                </div>
                            )}

                            {!isLoading && transcripts.map(transcript => {
                                const mainColor = transcript.attachedPillars?.[0]?.color || '#9ca3af';

                                return (
                                    <div key={transcript.id} className="relative flex flex-col rounded-2xl border border-gray-200 dark:border-gray-800 bg-[var(--bg-panel)] shadow-sm overflow-hidden hover:scale-[1.02] transition-transform">
                                        {/* Thumbnail Area */}
                                        <div className="h-32 w-full flex items-center justify-center relative" style={{ backgroundColor: mainColor }}>
                                            <div className="absolute inset-0 bg-black/10 mix-blend-overlay"></div>
                                            <PlaySquare className="h-10 w-10 text-white opacity-90 drop-shadow-md z-10" />
                                        </div>

                                        <div className="p-5 flex flex-col flex-1">
                                            <div className="flex items-start justify-between mb-3">
                                                <div className="flex flex-col">
                                                    <h2 className="text-lg font-bold font-heading text-gray-900 dark:text-white truncate max-w-[200px] mb-2" title={transcript.videos?.file_name}>
                                                        {transcript.videos?.file_name || 'Untitled Video'}
                                                    </h2>

                                                    {/* Pillar Tags */}
                                                    {transcript.attachedPillars && transcript.attachedPillars.length > 0 ? (
                                                        <div className="flex flex-wrap gap-1.5 mb-2">
                                                            {transcript.attachedPillars.map(p => (
                                                                <span
                                                                    key={p.id}
                                                                    className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-900"
                                                                    style={{ backgroundColor: p.color }}
                                                                >
                                                                    {p.name}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <div className="flex mb-2">
                                                            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-600 bg-gray-200">
                                                                Uncategorized
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Action */}
                                                <div className="flex items-center gap-2 relative z-20">
                                                    {transcript.isDeleting ? (
                                                        <div className="absolute right-0 top-0 bg-[var(--bg-panel)] shadow-xl border border-gray-100 dark:border-gray-800 rounded-xl p-3 flex flex-col gap-2 min-w-[180px]">
                                                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest text-center">Delete Options</span>
                                                            <button
                                                                onClick={() => confirmDelete(transcript.id, 'hard')}
                                                                className="text-xs font-bold font-heading border rounded-lg px-2 py-2 bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 hover:bg-red-100 transition-colors"
                                                            >
                                                                Wipe completely
                                                            </button>
                                                            <button
                                                                onClick={() => confirmDelete(transcript.id, 'soft')}
                                                                className="text-xs font-bold font-heading border rounded-lg px-2 py-2 bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 transition-colors"
                                                            >
                                                                Hide (Keep memory)
                                                            </button>
                                                            <button
                                                                onClick={() => setTranscripts(prev => prev.map(t => t.id === transcript.id ? { ...t, isDeleting: false } : t))}
                                                                className="text-xs font-medium text-gray-400 hover:text-gray-900 dark:hover:text-white"
                                                            >
                                                                Cancel
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <button
                                                            onClick={() => setTranscripts(prev => prev.map(t => t.id === transcript.id ? { ...t, isDeleting: true } : t))}
                                                            className="rounded-full p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                        </button>
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

                                            <div className="mt-4 flex items-center justify-between text-[11px] text-gray-400 font-bold uppercase tracking-wider font-heading border-t border-gray-100 dark:border-gray-800 pt-3">
                                                <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {new Date(transcript.created_at).toLocaleDateString()}</span>
                                                <span style={{ color: mainColor }}>Analyzed</span>
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
                    <div key={toast.id} className="bg-gray-900 text-white px-4 py-3 rounded-lg shadow-xl text-sm font-medium animate-in slide-in-from-bottom-5 fade-in pointer-events-auto flex items-center">
                        {toast.message}
                    </div>
                ))}
            </div>
        </AppLayout>
    )
}
