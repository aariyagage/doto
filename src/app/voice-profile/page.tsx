'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Sparkles, Loader2, Quote, Hash, MessagesSquare, CheckCircle2, Fingerprint, Video } from 'lucide-react'
import Link from 'next/link'
import AppLayout from '@/components/AppLayout'

interface VoiceProfile {
    niche_summary?: string;
    content_style?: string;
    tone_descriptors?: string[];
    recurring_phrases?: string[];
    updated_at: string;
}

export default function VoiceProfilePage() {
    const supabase = createClient()
    const [profile, setProfile] = useState<VoiceProfile | null>(null)
    const [isLoading, setIsLoading] = useState(true)

    useEffect(() => {
        const loadProfile = async () => {
            setIsLoading(true)
            const { data: sessionData } = await supabase.auth.getSession()
            const token = sessionData.session?.access_token

            if (token) {
                try {
                    const res = await fetch('/api/voice-profile', {
                        headers: { 'Authorization': `Bearer ${token}` }
                    })
                    const data = await res.json()
                    if (data.profile) {
                        setProfile(data.profile)
                    }
                } catch (e) {
                    console.error('Failed to fetch voice profile:', e)
                }
            }
            setIsLoading(false)
        }
        loadProfile()
    }, [supabase])

    return (
        <AppLayout>
            {/* Main Content Area */}
            <div className="flex-1 flex flex-col overflow-hidden w-full relative">
                <main className="flex-1 w-full">
                    <div className="w-full max-w-5xl mx-auto space-y-8">
                        {/* Top Bar */}
                        <div className="flex items-center justify-between mb-8">
                            <div>
                                <h1 className="text-3xl md:text-5xl font-heading tracking-tight text-gray-900 dark:text-white flex items-center gap-3">
                                    Voice Profile
                                </h1>
                                <p className="text-[var(--muted-foreground)] font-ui mt-2">Your unique creator DNA, continuously trained by AI.</p>
                            </div>
                        </div>

                        {/* Content Area */}
                        {isLoading ? (
                            <div className="flex flex-col items-center justify-center py-24 text-center">
                                <Loader2 className="h-8 w-8 animate-spin text-gray-300 dark:text-gray-600" />
                                <p className="text-sm text-gray-500 dark:text-gray-400 mt-4 font-ui">Loading profile...</p>
                            </div>
                        ) : !profile ? (
                            <div className="flex flex-col items-center justify-center py-24 text-center border-2 border-dashed border-gray-200 dark:border-gray-800 rounded-3xl bg-[var(--bg-panel)]">
                                <div className="bg-gray-100 dark:bg-gray-800 shadow-sm p-4 rounded-full mb-4">
                                    <Fingerprint className="h-10 w-10 text-gray-400 dark:text-gray-500" />
                                </div>
                                <h3 className="text-xl font-bold font-heading text-gray-900 dark:text-white mb-2">No Voice Profile found</h3>
                                <p className="text-gray-500 dark:text-gray-400 mb-6 max-w-sm mx-auto leading-relaxed font-ui">
                                    Upload a video to train your personalized creator DNA. The AI will analyze your speech and generate your profile.
                                </p>
                                <Link href="/upload">
                                    <button className="bg-[var(--text-primary)] text-[var(--bg-primary)] hover:scale-105 transition-all font-heading rounded-full px-5 py-2.5 text-sm shadow-sm inline-flex items-center gap-2">
                                        <Video className="h-4 w-4" /> Upload Video
                                    </button>
                                </Link>
                            </div>
                        ) : (
                            <div className="space-y-6 lg:space-y-8">
                                {/* Top Banner summary - Grape Border */}
                                <div className="bg-[var(--bg-panel)] border-l-[6px] border-[#7523B4] rounded-3xl p-6 md:p-8 relative overflow-hidden shadow-sm">
                                    <div className="absolute top-0 right-0 p-8 opacity-[0.03] dark:opacity-10 pointer-events-none">
                                        <Fingerprint className="h-32 w-32 text-[#7523B4] transform rotate-12" />
                                    </div>
                                    <div className="relative z-10 max-w-3xl">
                                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#7523B4]/10 text-[#7523B4] text-xs font-bold uppercase tracking-widest mb-4">
                                            <Sparkles className="h-3.5 w-3.5" /> Trained by AI
                                        </span>
                                        <h2 className="text-2xl md:text-4xl font-bold font-heading text-gray-900 dark:text-white leading-tight mb-4">
                                            {profile.niche_summary || "Generating niche summary..."}
                                        </h2>
                                        <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider font-heading">
                                            Last updated {new Date(profile.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                                        </p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {/* Tone Descriptors */}
                                    <div className="bg-[var(--bg-panel)] border border-gray-100 dark:border-gray-800 rounded-3xl p-6 shadow-sm flex flex-col hover:scale-[1.01] transition-transform">
                                        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-gray-100 dark:border-gray-800">
                                            <div className="h-10 w-10 rounded-full bg-orange-50 dark:bg-orange-500/10 flex items-center justify-center">
                                                <Hash className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                                            </div>
                                            <h3 className="text-xl font-bold font-heading text-gray-900 dark:text-white">Your Unique Tone</h3>
                                        </div>
                                        <div className="flex flex-wrap gap-2 mt-auto">
                                            {(profile.tone_descriptors || []).map((tone: string, i: number) => (
                                                <span key={i} className="px-3 py-1.5 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium hover:border-orange-300 dark:hover:border-orange-500 transition-colors shadow-xs font-ui">
                                                    {tone}
                                                </span>
                                            ))}
                                            {(!profile.tone_descriptors || profile.tone_descriptors.length === 0) && (
                                                <span className="text-gray-400 dark:text-gray-500 text-sm font-ui italic">No tone descriptors detected yet.</span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Content Style */}
                                    <div className="bg-[var(--bg-panel)] border border-gray-100 dark:border-gray-800 rounded-3xl p-6 shadow-sm flex flex-col hover:scale-[1.01] transition-transform">
                                        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-gray-100 dark:border-gray-800">
                                            <div className="h-10 w-10 rounded-full bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center">
                                                <MessagesSquare className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                                            </div>
                                            <h3 className="text-xl font-bold font-heading text-gray-900 dark:text-white">Content Archetype</h3>
                                        </div>
                                        <div className="mt-auto">
                                            <div className="inline-flex items-center gap-3 px-5 py-4 bg-emerald-50/50 dark:bg-emerald-500/5 text-emerald-800 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-500/20 rounded-2xl font-bold capitalize text-lg shadow-sm font-heading">
                                                <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                                                {profile.content_style || "Analyzing..."}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Recurring Phrases */}
                                    <div className="bg-[var(--bg-panel)] border border-gray-100 dark:border-gray-800 rounded-3xl p-6 md:p-8 shadow-sm md:col-span-2">
                                        <div className="flex items-center gap-3 mb-8 pb-4 border-b border-gray-100 dark:border-gray-800">
                                            <div className="h-10 w-10 rounded-full bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center">
                                                <Quote className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                                            </div>
                                            <h3 className="text-xl font-bold font-heading text-gray-900 dark:text-white">Signature Phrases</h3>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                                            {(profile.recurring_phrases || []).map((phrase: string, i: number) => (
                                                <div key={i} className="flex gap-3 items-start p-4 bg-gray-50/80 dark:bg-gray-800/50 rounded-2xl border border-gray-100/50 dark:border-gray-800 hover:bg-white dark:hover:bg-gray-800 transition-colors group shadow-sm hover:shadow-md">
                                                    <span className="text-blue-300 dark:text-blue-500/50 font-serif text-3xl leading-none mt-1 group-hover:text-blue-400 transition-colors">&quot;</span>
                                                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300 italic flex-1 leading-relaxed font-ui mt-1">
                                                        {phrase}
                                                    </p>
                                                </div>
                                            ))}
                                            {(!profile.recurring_phrases || profile.recurring_phrases.length === 0) && (
                                                <span className="text-gray-400 dark:text-gray-500 text-sm italic font-ui">Need to analyze more videos...</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </main>
            </div>
        </AppLayout>
    )
}
