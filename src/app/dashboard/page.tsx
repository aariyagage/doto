'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Home, Loader2, PlaySquare, Feather, ArrowUpRight } from 'lucide-react'
import Link from 'next/link'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend } from 'recharts'
import LogoutButton from './logout-button'
import AppLayout from '@/components/AppLayout'

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
                                <h1 className="text-2xl md:text-4xl font-heading uppercase tracking-tight text-[var(--text-primary)]">Your Voice</h1>
                                <p className="font-caslon italic text-lg text-[var(--text-primary)]/70 mt-1">Here is your content engine overview.</p>
                            </div>
                            <LogoutButton />
                        </div>

                        {isLoading ? (
                            <div className="flex flex-col items-center justify-center py-24 text-center">
                                <Loader2 className="h-8 w-8 animate-spin text-[var(--text-primary)]/30" />
                                <p className="text-sm text-[var(--text-primary)]/60 mt-4">Loading insights...</p>
                            </div>
                        ) : !stats ? (
                            <div className="flex flex-col items-center justify-center py-24 text-center border-2 border-dashed border-[var(--text-primary)]/10 rounded-3xl bg-[var(--bg-panel)]">
                                <Home className="h-10 w-10 text-[var(--text-primary)]/30 mb-4" />
                                <h3 className="text-xl font-heading tracking-tight uppercase text-[var(--text-primary)] mb-2">No data yet</h3>
                                <p className="font-caslon italic text-lg text-[var(--text-primary)]/70 mb-6 max-w-sm mx-auto">Upload your first video to start generating insights and pillars.</p>
                            </div>
                        ) : (
                            <div className="space-y-8 animate-in fade-in duration-500">

                                {/* Editorial stat row — newspaper-style numerals in accent
                                    colors, separated by thin manila rules, on parchment. */}
                                <div className="border-y-2 border-double border-[var(--border-manila)] py-6">
                                    <div className="grid grid-cols-2 md:grid-cols-4 divide-[var(--border-manila)] md:divide-x">
                                        {[
                                            { label: 'Videos', sub: 'Processed', value: stats.metrics.totalVideos, color: 'var(--combo-9-bg)' },
                                            { label: 'Ideas', sub: 'Generated', value: stats.metrics.totalIdeas, color: 'var(--combo-5-bg)' },
                                            { label: 'Pillars', sub: 'Identified', value: stats.metrics.totalPillars, color: 'var(--combo-3-bg)' },
                                            { label: 'Saved', sub: 'Bookmarked', value: stats.metrics.totalSavedIdeas, color: 'var(--combo-1-bg)' },
                                        ].map((m, i) => (
                                            <div key={m.label} className={`px-6 py-2 flex flex-col ${i > 1 ? 'border-t-2 border-double border-[var(--border-manila)] md:border-t-0 pt-6 md:pt-2' : ''}`}>
                                                <div className="flex items-baseline gap-3">
                                                    <span className="font-heading text-5xl md:text-6xl leading-none tabular-nums" style={{ color: m.color }}>
                                                        {m.value}
                                                    </span>
                                                </div>
                                                <div className="mt-3 flex flex-col">
                                                    <span className="font-heading uppercase tracking-[0.18em] text-xs text-[var(--text-primary)]">{m.label}</span>
                                                    <span className="font-caslon italic text-sm text-[var(--text-primary)]/55">{m.sub}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Main Chart Area */}
                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                    <div className="lg:col-span-2 bg-[var(--bg-panel)] border border-[var(--text-primary)]/10 rounded-3xl p-6 shadow-sm">
                                        <h3 className="text-lg font-heading tracking-tight text-[var(--text-primary)] mb-6 flex items-center gap-2">
                                            Content Pipeline Distribution
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
                                                        <Bar dataKey="ideas" name="Ideas Generated" radius={[4, 4, 0, 0]} maxBarSize={40}>
                                                            {stats.chartData.map((entry, index) => (
                                                                <Cell key={`cell-ideas-${index}`} fill={entry.color} />
                                                            ))}
                                                        </Bar>
                                                        <Bar dataKey="videos" name="Videos Uploaded" fill={videosBarColor} radius={[4, 4, 0, 0]} maxBarSize={40} />
                                                    </BarChart>
                                                </ResponsiveContainer>
                                            ) : (
                                                <div className="h-full w-full flex items-center justify-center text-gray-400 text-sm italic">
                                                    Not enough data to generate chart.
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Recent Activity */}
                                    <div className="bg-[var(--bg-panel)] border border-[var(--text-primary)]/10 rounded-3xl p-6 shadow-sm flex flex-col">
                                        <h3 className="text-lg font-heading tracking-tight text-[var(--text-primary)] mb-6">Recent Activity</h3>
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
                                                        <div className="overflow-hidden flex-1 border-b border-[var(--text-primary)]/5 pb-4">
                                                            <div className="font-semibold text-[var(--text-primary)] text-sm truncate">
                                                                {activity.title}
                                                            </div>
                                                            <div className="text-[var(--text-primary)]/50 text-xs mt-0.5 font-medium">
                                                                {activity.type === 'video' ? 'Processed' : 'Generated'} · {new Date(activity.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))
                                            ) : (
                                                <div className="text-center text-[var(--text-primary)]/40 text-sm py-10 italic font-caslon">
                                                    No recent activity found.
                                                </div>
                                            )}
                                        </div>
                                        <Link href="/videos" className="mt-4 flex items-center justify-center gap-1.5 w-full py-2.5 text-sm font-semibold text-[var(--text-primary)] bg-[var(--text-primary)]/5 hover:bg-[var(--text-primary)]/10 rounded-xl transition-colors">
                                            View Library <ArrowUpRight className="h-4 w-4 opacity-50" />
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
