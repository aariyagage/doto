'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Feather, Loader2, Quote, Hash, MessagesSquare, CheckCircle2, Fingerprint, Video } from 'lucide-react'
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
                                <h1 className="text-3xl md:text-[34px] font-semibold tracking-tight text-[var(--text-primary)]">
                                    Voice profile
                                </h1>
                                <p className="text-base text-[var(--text-primary)]/60 mt-2">Your unique creator DNA, continuously trained by AI.</p>
                            </div>
                        </div>

                        {/* Content Area */}
                        {isLoading ? (
                            <div className="flex flex-col items-center justify-center py-24 text-center">
                                <Loader2 className="h-8 w-8 animate-spin text-[var(--text-primary)]/30" />
                                <p className="text-sm text-[var(--text-primary)]/60 mt-4 font-ui">Loading profile...</p>
                            </div>
                        ) : !profile ? (
                            <div className="flex flex-col items-center justify-center py-24 text-center border-2 border-dashed border-[var(--text-primary)]/10 rounded-3xl bg-[var(--bg-panel)]">
                                <div
                                    className="shadow-sm p-4 rounded-full mb-4"
                                    style={{ backgroundColor: 'var(--combo-5-bg)', color: 'var(--combo-5-text)' }}
                                >
                                    <Fingerprint className="h-10 w-10" />
                                </div>
                                <h3 className="text-xl font-semibold tracking-tight text-[var(--text-primary)] mb-2">No voice profile found</h3>
                                <p className="text-base text-[var(--text-primary)]/60 mb-6 max-w-sm mx-auto leading-relaxed">
                                    Upload a video to train your personalized creator DNA. The AI will analyze your speech and generate your profile.
                                </p>
                                <Link href="/upload">
                                    <button className="bg-[var(--text-primary)] text-[var(--bg-primary)] hover:opacity-90 transition-opacity font-medium rounded-full px-5 py-2.5 text-sm inline-flex items-center gap-2">
                                        <Video className="h-4 w-4" /> Upload video
                                    </button>
                                </Link>
                            </div>
                        ) : (
                            <div className="space-y-6 lg:space-y-8">
                                {/* Top Banner summary — Grape accent */}
                                <div className="bg-[var(--bg-panel)] border border-[var(--border-manila)] border-l-[3px] border-l-[var(--combo-5-bg)] rounded-2xl p-6 md:p-8 relative overflow-hidden">
                                    <div className="absolute top-0 right-0 p-8 opacity-[0.05] dark:opacity-15 pointer-events-none">
                                        <Fingerprint className="h-32 w-32 text-[var(--combo-5-bg)] transform rotate-12" />
                                    </div>
                                    <div className="relative z-10 max-w-3xl">
                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--combo-5-bg)] text-[var(--combo-5-text)] text-xs font-medium mb-4">
                                            <Feather className="h-3.5 w-3.5" /> Trained by AI
                                        </span>
                                        <h2 className="text-xl md:text-3xl font-semibold tracking-tight text-[var(--text-primary)] leading-tight mb-4">
                                            {profile.niche_summary || "Generating niche summary..."}
                                        </h2>
                                        <p className="text-xs font-medium text-[var(--text-primary)]/45">
                                            Last updated {new Date(profile.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                                        </p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {/* Tone Descriptors */}
                                    <div className="bg-[var(--bg-panel)] border border-[var(--border-manila)] rounded-2xl p-6 flex flex-col">
                                        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-[var(--border-manila)]">
                                            <div
                                                className="h-9 w-9 rounded-full flex items-center justify-center"
                                                style={{ backgroundColor: 'var(--combo-6-bg)', color: 'var(--combo-6-text)' }}
                                            >
                                                <Hash className="h-4 w-4" />
                                            </div>
                                            <h3 className="text-base font-semibold tracking-tight text-[var(--text-primary)]">Your unique tone</h3>
                                        </div>
                                        <div className="flex flex-wrap gap-2 mt-auto">
                                            {(profile.tone_descriptors || []).map((tone: string, i: number) => (
                                                <span
                                                    key={i}
                                                    className="px-2.5 py-1 rounded-lg text-xs font-medium transition-colors"
                                                    style={{
                                                        backgroundColor: `color-mix(in srgb, var(--combo-${(i % 9) + 1}-bg) 12%, transparent)`,
                                                        color: 'var(--text-primary)',
                                                        border: '1px solid color-mix(in srgb, var(--combo-' + ((i % 9) + 1) + '-bg) 25%, transparent)',
                                                    }}
                                                >
                                                    {tone}
                                                </span>
                                            ))}
                                            {(!profile.tone_descriptors || profile.tone_descriptors.length === 0) && (
                                                <span className="text-[var(--text-primary)]/45 text-sm">No tone descriptors detected yet.</span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Content Style */}
                                    <div className="bg-[var(--bg-panel)] border border-[var(--border-manila)] rounded-2xl p-6 flex flex-col">
                                        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-[var(--border-manila)]">
                                            <div
                                                className="h-9 w-9 rounded-full flex items-center justify-center"
                                                style={{ backgroundColor: 'var(--combo-3-bg)', color: 'var(--combo-3-text)' }}
                                            >
                                                <MessagesSquare className="h-4 w-4" />
                                            </div>
                                            <h3 className="text-base font-semibold tracking-tight text-[var(--text-primary)]">Content archetype</h3>
                                        </div>
                                        <div className="mt-auto">
                                            <div
                                                className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl font-semibold capitalize text-sm"
                                                style={{ backgroundColor: 'var(--combo-3-bg)', color: 'var(--combo-3-text)' }}
                                            >
                                                <CheckCircle2 className="h-4 w-4" />
                                                {profile.content_style || "Analyzing..."}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Recurring Phrases */}
                                    <div className="bg-[var(--bg-panel)] border border-[var(--border-manila)] rounded-2xl p-6 md:p-8 md:col-span-2">
                                        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-[var(--border-manila)]">
                                            <div
                                                className="h-9 w-9 rounded-full flex items-center justify-center"
                                                style={{ backgroundColor: 'var(--combo-9-bg)', color: 'var(--combo-9-text)' }}
                                            >
                                                <Quote className="h-4 w-4" />
                                            </div>
                                            <h3 className="text-base font-semibold tracking-tight text-[var(--text-primary)]">Signature phrases</h3>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                                            {(profile.recurring_phrases || []).map((phrase: string, i: number) => (
                                                <div key={i} className="flex gap-3 items-start p-4 bg-[var(--text-primary)]/[0.03] rounded-xl border border-[var(--border-manila)] hover:bg-[var(--text-primary)]/[0.05] transition-colors">
                                                    <span className="text-[var(--combo-5-bg)] text-3xl leading-none mt-0 opacity-60">&ldquo;</span>
                                                    <p className="text-sm text-[var(--text-primary)]/80 flex-1 leading-relaxed mt-1">
                                                        {phrase}
                                                    </p>
                                                </div>
                                            ))}
                                            {(!profile.recurring_phrases || profile.recurring_phrases.length === 0) && (
                                                <span className="text-[var(--text-primary)]/45 text-sm">Need to analyze more videos&hellip;</span>
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
