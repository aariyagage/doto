'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Loader2, CheckCircle2 } from 'lucide-react'
import Link from 'next/link'
import AppLayout, { PILLAR_COLORS } from '@/components/AppLayout'

interface VoiceProfile {
    niche_summary?: string;
    content_style?: string;
    tone_descriptors?: string[];
    recurring_phrases?: string[];
    updated_at: string;
}

type TabKey = 'voice' | 'tone' | 'archetype' | 'phrases'

const TABS: { key: TabKey; label: string }[] = [
    { key: 'voice',     label: 'voice' },
    { key: 'tone',      label: 'tone' },
    { key: 'archetype', label: 'archetype' },
    { key: 'phrases',   label: 'phrases' },
]

export default function VoiceProfilePage() {
    const supabase = createClient()
    const [profile, setProfile] = useState<VoiceProfile | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [active, setActive] = useState<TabKey>('voice')

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

    const lastUpdated = profile?.updated_at
        ? new Date(profile.updated_at)
        : null

    const lastUpdatedLabel = lastUpdated && !isNaN(lastUpdated.getTime())
        ? lastUpdated.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
        : null

    return (
        <AppLayout>
            <div className="w-full max-w-5xl mx-auto">
                {/* Header */}
                <div className="mb-10">
                    <h1 className="text-title-1 text-ink">voice profile</h1>
                    <p className="text-body-sm text-ink-muted mt-2">
                        your unique creator dna · trained by ai
                    </p>
                </div>

                {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-24 text-center">
                        <Loader2 className="h-8 w-8 animate-spin text-ink-faint" />
                        <p className="text-body-sm text-ink-muted mt-4">loading profile...</p>
                    </div>
                ) : !profile ? (
                    <div className="rounded-3xl border border-rule bg-paper-elevated p-16 text-center">
                        <h3 className="text-title-3 text-ink mb-2">no voice profile yet</h3>
                        <p className="text-body-sm text-ink-muted max-w-md mx-auto mb-6">
                            upload a video to train your creator dna. the ai will analyze your speech and build the profile from there.
                        </p>
                        <Link
                            href="/upload"
                            className="inline-flex items-center gap-2 rounded-full bg-ink text-paper px-5 py-2.5 text-body-sm font-medium hover:bg-ink/90 transition-colors"
                        >
                            upload video
                        </Link>
                    </div>
                ) : (
                    <div>
                        {/* Tabs — folder-style */}
                        <div className="flex items-end pl-4 gap-1 relative">
                            {TABS.map(t => {
                                const isActive = active === t.key
                                return (
                                    <button
                                        key={t.key}
                                        onClick={() => setActive(t.key)}
                                        className={`relative px-5 py-2.5 text-body-sm font-medium transition-all border border-rule rounded-t-xl ${
                                            isActive
                                                ? 'bg-paper-elevated text-ink z-10 border-b-paper-elevated'
                                                : 'bg-paper-sunken text-ink-muted hover:text-ink translate-y-[3px]'
                                        }`}
                                    >
                                        {t.label}
                                    </button>
                                )
                            })}
                        </div>

                        {/* Panel */}
                        <div className="bg-paper-elevated border border-rule rounded-2xl rounded-tl-none p-8 md:p-12 min-h-[420px] -mt-px relative z-0">
                            {active === 'voice' && (
                                <div>
                                    <span className="text-caption text-ink-faint">
                                        trained by ai{lastUpdatedLabel ? ` · last updated ${lastUpdatedLabel}` : ''}
                                    </span>
                                    <p className="text-display-3 text-ink mt-6 leading-snug text-balance">
                                        {profile.niche_summary || 'generating niche summary…'}
                                    </p>
                                </div>
                            )}

                            {active === 'tone' && (
                                <div>
                                    <span className="text-caption text-ink-faint">a few words on how you sound</span>
                                    {profile.tone_descriptors && profile.tone_descriptors.length > 0 ? (
                                        <div className="mt-8 flex flex-wrap gap-2">
                                            {profile.tone_descriptors.map((tone, i) => {
                                                const slot = PILLAR_COLORS[i % PILLAR_COLORS.length]
                                                return (
                                                    <span
                                                        key={i}
                                                        className="px-3.5 py-1.5 rounded-full text-body-sm font-medium"
                                                        style={{ backgroundColor: slot.bg, color: slot.text }}
                                                    >
                                                        {tone}
                                                    </span>
                                                )
                                            })}
                                        </div>
                                    ) : (
                                        <p className="mt-6 text-body-sm text-ink-faint">
                                            no tone descriptors yet — analyze a few more videos.
                                        </p>
                                    )}
                                </div>
                            )}

                            {active === 'archetype' && (
                                <div>
                                    <span className="text-caption text-ink-faint">your style</span>
                                    {profile.content_style ? (
                                        <div className="mt-8">
                                            <span
                                                className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-body font-medium"
                                                style={{ backgroundColor: PILLAR_COLORS[2].bg, color: PILLAR_COLORS[2].text }}
                                            >
                                                <CheckCircle2 className="h-4 w-4" />
                                                {profile.content_style}
                                            </span>
                                        </div>
                                    ) : (
                                        <p className="mt-6 text-body-sm text-ink-faint">analyzing…</p>
                                    )}
                                </div>
                            )}

                            {active === 'phrases' && (
                                <div>
                                    <span className="text-caption text-ink-faint">the things you say a lot</span>
                                    {profile.recurring_phrases && profile.recurring_phrases.length > 0 ? (
                                        <ol className="mt-8 space-y-6 max-w-3xl">
                                            {profile.recurring_phrases.map((phrase, i) => (
                                                <li key={i} className="flex gap-5">
                                                    <span className="text-caption text-ink-faint tabular-nums pt-2 shrink-0">
                                                        {String(i + 1).padStart(2, '0')}
                                                    </span>
                                                    <p className="text-body-lg text-ink italic leading-snug">
                                                        &ldquo;{phrase}&rdquo;
                                                    </p>
                                                </li>
                                            ))}
                                        </ol>
                                    ) : (
                                        <p className="mt-6 text-body-sm text-ink-faint">
                                            need to analyze more videos to surface recurring phrases.
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </AppLayout>
    )
}
