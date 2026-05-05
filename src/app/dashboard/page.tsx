'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Loader2, PlaySquare, Feather, ArrowUpRight, Sparkles } from 'lucide-react'
import Link from 'next/link'
import LogoutButton from './logout-button'
import AppLayout, { displayBg } from '@/components/AppLayout'

interface DashboardStats {
    metrics: {
        totalVideos: number;
        totalIdeas: number;
        totalPillars: number;
        totalSavedIdeas: number;
    }
    chartData: {
        name: string;
        ideas: number;
        videos: number;
        color: string;
    }[]
    recentActivity: {
        type: 'video' | 'idea';
        id: string;
        title: string;
        date: string;
        icon: string;
    }[]
}

export default function DashboardPage() {
    const supabase = createClient()
    const [stats, setStats] = useState<DashboardStats | null>(null)
    const [isLoading, setIsLoading] = useState(true)

    useEffect(() => {
        const loadStats = async () => {
            setIsLoading(true)
            const { data: sessionData } = await supabase.auth.getSession()
            const token = sessionData.session?.access_token

            if (token) {
                try {
                    const res = await fetch('/api/dashboard/stats', {
                        headers: { 'Authorization': `Bearer ${token}` }
                    })
                    const data = await res.json()
                    if (data.metrics) {
                        setStats(data)
                    }
                } catch (e) {
                    console.error('Failed to fetch dashboard stats:', e)
                }
            }
            setIsLoading(false)
        }
        loadStats()
    }, [supabase])

    const pillars = stats?.chartData ?? []
    const activity = stats?.recentActivity ?? []

    return (
        <AppLayout>
            <div className="w-full max-w-6xl mx-auto">
                {/* Header */}
                <div className="flex items-start justify-between mb-3">
                    <div>
                        <h1 className="text-title-1 text-ink">your workshop</h1>
                        <p className="text-body-sm text-ink-muted mt-2">
                            each pillar is a folder. feed it ideas.
                        </p>
                    </div>
                    <LogoutButton />
                </div>

                {/* Inline totals */}
                {stats && (
                    <div className="mb-10 mt-4 flex flex-wrap gap-x-6 gap-y-1 text-body-sm text-ink-faint">
                        <span><span className="text-ink font-medium tabular-nums">{stats.metrics.totalVideos}</span> videos</span>
                        <span><span className="text-ink font-medium tabular-nums">{stats.metrics.totalIdeas}</span> ideas</span>
                        <span><span className="text-ink font-medium tabular-nums">{stats.metrics.totalPillars}</span> pillars</span>
                        <span><span className="text-ink font-medium tabular-nums">{stats.metrics.totalSavedIdeas}</span> saved</span>
                    </div>
                )}

                {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-24 text-center">
                        <Loader2 className="h-8 w-8 animate-spin text-ink-faint" />
                        <p className="text-body-sm text-ink-muted mt-4">loading workshop...</p>
                    </div>
                ) : !stats ? (
                    <div className="rounded-3xl border border-rule bg-paper-elevated p-16 text-center">
                        <h3 className="text-title-3 text-ink mb-2">no data yet</h3>
                        <p className="text-body-sm text-ink-muted max-w-md mx-auto mb-6">
                            upload a video to start filling your workshop.
                        </p>
                        <Link
                            href="/upload"
                            className="inline-flex items-center gap-2 rounded-full bg-ink text-paper px-5 py-2.5 text-body-sm font-medium hover:bg-ink/90 transition-colors"
                        >
                            upload video
                        </Link>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-8 lg:gap-12 animate-in fade-in duration-500">
                        {/* Pillars grid — the workshop */}
                        <section>
                            {pillars.length === 0 ? (
                                <div className="rounded-3xl border border-dashed border-rule bg-paper-elevated p-12 text-center">
                                    <h3 className="text-title-3 text-ink mb-2">no pillars yet</h3>
                                    <p className="text-body-sm text-ink-muted max-w-sm mx-auto mb-6">
                                        upload a few videos, then run discover on the concepts page to surface your pillars.
                                    </p>
                                    <Link
                                        href="/concepts"
                                        className="inline-flex items-center gap-2 text-body-sm font-medium text-ink hover:underline"
                                    >
                                        go to concepts <ArrowUpRight className="h-4 w-4" />
                                    </Link>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {pillars.map((p, i) => {
                                        const accent = displayBg(p.color)
                                        return (
                                            <Link
                                                key={p.name}
                                                href="/concepts"
                                                className="group block rounded-2xl bg-paper-elevated border border-rule overflow-hidden hover:border-ink/20 transition-colors"
                                            >
                                                <div className="h-1.5 w-full" style={{ backgroundColor: accent }} aria-hidden="true" />
                                                <div className="p-5">
                                                    <span className="text-caption text-ink-faint tabular-nums">
                                                        pillar {String(i + 1).padStart(2, '0')}
                                                    </span>
                                                    <h3 className="text-title-3 text-ink mt-1 mb-5">{p.name}</h3>
                                                    <div className="flex items-baseline gap-6 text-body-sm text-ink-muted">
                                                        <span>
                                                            <span className="font-semibold text-ink tabular-nums">{p.ideas}</span> ideas
                                                        </span>
                                                        <span>
                                                            <span className="font-semibold text-ink tabular-nums">{p.videos}</span> videos
                                                        </span>
                                                    </div>
                                                    <div className="mt-6 inline-flex items-center gap-1.5 text-body-sm font-medium text-ink-muted group-hover:text-ink transition-colors">
                                                        <Sparkles className="h-3.5 w-3.5" />
                                                        feed pillar
                                                        <ArrowUpRight className="h-3.5 w-3.5 opacity-60" />
                                                    </div>
                                                </div>
                                            </Link>
                                        )
                                    })}
                                </div>
                            )}
                        </section>

                        {/* Recent activity rail */}
                        <aside>
                            <h3 className="text-caption text-ink-muted mb-5">recent activity</h3>
                            {activity.length > 0 ? (
                                <div className="space-y-4">
                                    {activity.map((a, idx) => (
                                        <div key={idx} className="flex gap-3 pb-4 border-b border-rule-soft last:border-0">
                                            <div className="mt-0.5 shrink-0">
                                                {a.type === 'video' ? (
                                                    <PlaySquare className="h-4 w-4 text-ink-faint" strokeWidth={1.75} />
                                                ) : (
                                                    <Feather className="h-4 w-4 text-ink-faint" strokeWidth={1.75} />
                                                )}
                                            </div>
                                            <div className="overflow-hidden flex-1">
                                                <div className="text-body-sm text-ink truncate">
                                                    {a.title}
                                                </div>
                                                <div className="text-xs text-ink-faint mt-0.5">
                                                    {a.type === 'video' ? 'processed' : 'generated'} · {new Date(a.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-body-sm text-ink-faint">no recent activity yet.</p>
                            )}
                            <Link
                                href="/videos"
                                className="mt-6 inline-flex items-center gap-1.5 text-body-sm font-medium text-ink-muted hover:text-ink transition-colors"
                            >
                                view library <ArrowUpRight className="h-4 w-4" />
                            </Link>
                        </aside>
                    </div>
                )}
            </div>
        </AppLayout>
    )
}
