'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Home, Loader2, PlaySquare, Feather, ArrowUpRight } from 'lucide-react'
import Link from 'next/link'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend } from 'recharts'
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

function useIsDark() {
    const [isDark, setIsDark] = useState(false)
    useEffect(() => {
        const el = document.documentElement
        const update = () => setIsDark(el.classList.contains('dark'))
        update()
        const observer = new MutationObserver(update)
        observer.observe(el, { attributes: true, attributeFilter: ['class'] })
        return () => observer.disconnect()
    }, [])
    return isDark
}

export default function DashboardPage() {
    const supabase = createClient()
    const [stats, setStats] = useState<DashboardStats | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const isDark = useIsDark()
    const tickColor = isDark ? '#9ca3af' : '#6b7280'
    const gridColor = isDark ? '#262626' : '#f3f4f6'
    const videosBarColor = isDark ? '#f5f0e8' : '#111827'
    const tooltipBg = isDark ? '#1a1a1a' : '#ffffff'
    const tooltipText = isDark ? '#f5f0e8' : '#111111'

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

    return (
        <AppLayout>
            <div className="flex-1 flex flex-col overflow-hidden w-full relative">
                <main className="flex-1 w-full">
                    <div className="w-full max-w-5xl mx-auto space-y-8">

                        {/* Header */}
                        <div className="flex items-center justify-between mb-8">
                            <div>
                                <h1 className="text-title-1 text-ink">your voice</h1>
                                <p className="text-body-sm text-ink-muted mt-2">here&rsquo;s your content engine overview.</p>
                            </div>
                            <LogoutButton />
                        </div>

                        {isLoading ? (
                            <div className="flex flex-col items-center justify-center py-24 text-center">
                                <Loader2 className="h-8 w-8 animate-spin text-ink-faint" />
                                <p className="text-body-sm text-ink-muted mt-4">loading insights...</p>
                            </div>
                        ) : !stats ? (
                            <div className="flex flex-col items-center justify-center py-24 text-center border-2 border-dashed border-rule rounded-3xl bg-paper-elevated">
                                <Home className="h-10 w-10 text-ink-faint mb-4" />
                                <h3 className="text-title-3 text-ink mb-2">no data yet</h3>
                                <p className="text-body-sm text-ink-muted mb-6 max-w-sm mx-auto">upload your first video to start generating insights and pillars.</p>
                            </div>
                        ) : (
                            <div className="space-y-8 animate-in fade-in duration-500">

                                {/* Stat cards */}
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                    {[
                                        { label: 'videos', sub: 'processed', value: stats.metrics.totalVideos, color: 'var(--combo-1-bg)' },
                                        { label: 'ideas', sub: 'generated', value: stats.metrics.totalIdeas, color: 'var(--combo-2-bg)' },
                                        { label: 'pillars', sub: 'identified', value: stats.metrics.totalPillars, color: 'var(--combo-3-bg)' },
                                        { label: 'saved', sub: 'bookmarked', value: stats.metrics.totalSavedIdeas, color: 'var(--combo-4-bg)' },
                                    ].map((m) => (
                                        <div key={m.label} className="rounded-2xl border border-rule bg-paper-elevated p-5">
                                            <div className="flex items-baseline gap-2">
                                                <span className="text-3xl md:text-4xl font-semibold tracking-tight tabular-nums text-ink">
                                                    {m.value}
                                                </span>
                                                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: m.color }} aria-hidden="true" />
                                            </div>
                                            <div className="mt-3 flex flex-col">
                                                <span className="text-sm font-medium text-ink">{m.label}</span>
                                                <span className="text-xs text-ink-faint mt-0.5">{m.sub}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* Main Chart Area */}
                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                    <div className="lg:col-span-2 bg-paper-elevated border border-rule rounded-2xl p-6">
                                        <h3 className="text-title-3 text-ink mb-6 flex items-center gap-2">
                                            content pipeline distribution
                                        </h3>
                                        <div className="h-80 w-full">
                                            {stats.chartData.length > 0 ? (
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <BarChart data={stats.chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
                                                        <XAxis
                                                            dataKey="name"
                                                            axisLine={false}
                                                            tickLine={false}
                                                            tick={{ fontSize: 12, fill: tickColor }}
                                                            dy={10}
                                                        />
                                                        <YAxis
                                                            axisLine={false}
                                                            tickLine={false}
                                                            tick={{ fontSize: 12, fill: tickColor }}
                                                        />
                                                        <Tooltip
                                                            cursor={{ fill: 'transparent' }}
                                                            contentStyle={{ borderRadius: '12px', border: 'none', backgroundColor: tooltipBg, color: tooltipText, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)' }}
                                                            labelStyle={{ color: tooltipText }}
                                                            itemStyle={{ color: tooltipText }}
                                                        />
                                                        <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px', fontSize: '12px', color: tickColor }} />
                                                        <Bar dataKey="ideas" name="ideas generated" radius={[4, 4, 0, 0]} maxBarSize={40}>
                                                            {stats.chartData.map((entry, index) => (
                                                                <Cell key={`cell-ideas-${index}`} fill={displayBg(entry.color)} />
                                                            ))}
                                                        </Bar>
                                                        <Bar dataKey="videos" name="videos uploaded" fill={videosBarColor} radius={[4, 4, 0, 0]} maxBarSize={40} />
                                                    </BarChart>
                                                </ResponsiveContainer>
                                            ) : (
                                                <div className="h-full w-full flex items-center justify-center text-ink-faint text-sm">
                                                    not enough data to generate chart.
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Recent Activity */}
                                    <div className="bg-paper-elevated border border-rule rounded-2xl p-6 flex flex-col">
                                        <h3 className="text-title-3 text-ink mb-6">recent activity</h3>
                                        <div className="flex-1 space-y-4">
                                            {stats.recentActivity.length > 0 ? (
                                                stats.recentActivity.map((activity, idx) => (
                                                    <div key={idx} className="flex gap-3 text-sm group">
                                                        <div className="mt-1">
                                                            {activity.type === 'video' ? (
                                                                <div
                                                                    className="h-8 w-8 rounded-full flex items-center justify-center transition-colors"
                                                                    style={{ backgroundColor: 'var(--combo-9-bg)', color: 'var(--combo-9-text)' }}
                                                                >
                                                                    <PlaySquare className="h-4 w-4" />
                                                                </div>
                                                            ) : (
                                                                <div
                                                                    className="h-8 w-8 rounded-full flex items-center justify-center transition-colors"
                                                                    style={{ backgroundColor: 'var(--combo-4-bg)', color: 'var(--combo-4-text)' }}
                                                                >
                                                                    <Feather className="h-4 w-4" />
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className="overflow-hidden flex-1 border-b border-rule-soft pb-4">
                                                            <div className="font-semibold text-ink text-sm truncate">
                                                                {activity.title}
                                                            </div>
                                                            <div className="text-ink-faint text-xs mt-0.5 font-medium">
                                                                {activity.type === 'video' ? 'processed' : 'generated'} · {new Date(activity.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))
                                            ) : (
                                                <div className="text-center text-ink-faint text-sm py-10">
                                                    no recent activity found.
                                                </div>
                                            )}
                                        </div>
                                        <Link href="/videos" className="mt-4 flex items-center justify-center gap-1.5 w-full py-2.5 text-sm font-semibold text-ink bg-ink/5 hover:bg-ink/10 rounded-xl transition-colors">
                                            view library <ArrowUpRight className="h-4 w-4 opacity-50" />
                                        </Link>
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
