'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Home, Video, Lightbulb, Library, Loader2, PlaySquare, Sparkles, ArrowUpRight } from 'lucide-react'
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

    return (
        <AppLayout>
            <div className="flex-1 flex flex-col overflow-hidden w-full relative">
                <main className="flex-1 w-full">
                    <div className="w-full max-w-5xl mx-auto space-y-8">

                        {/* Header */}
                        <div className="flex items-center justify-between mb-8">
                            <div>
                                <h1 className="text-3xl md:text-5xl font-heading tracking-tight text-gray-900 dark:text-white">Your Voice</h1>
                                <p className="text-gray-500 dark:text-gray-400 mt-2 font-ui">Here is your content engine overview.</p>
                            </div>
                            <LogoutButton />
                        </div>

                        {isLoading ? (
                            <div className="flex flex-col items-center justify-center py-24 text-center">
                                <Loader2 className="h-8 w-8 animate-spin text-gray-300" />
                                <p className="text-sm text-gray-500 mt-4">Loading insights...</p>
                            </div>
                        ) : !stats ? (
                            <div className="flex flex-col items-center justify-center py-24 text-center border-2 border-dashed border-gray-100 rounded-3xl bg-gray-50/50">
                                <Home className="h-10 w-10 text-gray-400 mb-4" />
                                <h3 className="text-xl font-bold text-gray-900 mb-2">No data yet</h3>
                                <p className="text-gray-500 mb-6 max-w-sm mx-auto">Upload your first video to start generating insights and pillars.</p>
                            </div>
                        ) : (
                            <div className="space-y-8 animate-in fade-in duration-500">

                                {/* Metric Cards */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 font-ui">
                                    <div className="bg-[var(--combo-6-bg)] text-[var(--combo-6-text)] p-6 rounded-3xl shadow-sm flex flex-col hover:scale-[1.02] transition-transform">
                                        <div className="flex items-center gap-3 mb-3">
                                            <div className="p-2 bg-black/10 rounded-xl"><Video className="h-5 w-5" /></div>
                                            <span className="font-semibold text-sm">Videos</span>
                                        </div>
                                        <div className="text-4xl font-heading">{stats.metrics.totalVideos}</div>
                                        <div className="mt-2 text-xs font-medium opacity-80 uppercase tracking-wider">Processed</div>
                                    </div>

                                    <div className="bg-[var(--combo-4-bg)] text-[var(--combo-4-text)] p-6 rounded-3xl shadow-sm flex flex-col hover:scale-[1.02] transition-transform">
                                        <div className="flex items-center gap-3 mb-3">
                                            <div className="p-2 bg-white/20 rounded-xl"><Sparkles className="h-5 w-5" /></div>
                                            <span className="font-semibold text-sm">Ideas Generated</span>
                                        </div>
                                        <div className="text-4xl font-heading">{stats.metrics.totalIdeas}</div>
                                        <div className="mt-2 text-xs font-medium opacity-80 uppercase tracking-wider">Across branches</div>
                                    </div>

                                    <div className="bg-[var(--combo-7-bg)] text-[var(--combo-7-text)] p-6 rounded-3xl shadow-sm flex flex-col hover:scale-[1.02] transition-transform">
                                        <div className="flex items-center gap-3 mb-3">
                                            <div className="p-2 bg-black/10 rounded-xl"><Library className="h-5 w-5" /></div>
                                            <span className="font-semibold text-sm">Active Pillars</span>
                                        </div>
                                        <div className="text-4xl font-heading">{stats.metrics.totalPillars}</div>
                                        <div className="mt-2 text-xs font-medium opacity-80 uppercase tracking-wider">Identified</div>
                                    </div>

                                    <div className="bg-[var(--combo-9-bg)] text-[var(--combo-9-text)] p-6 rounded-3xl shadow-sm flex flex-col hover:scale-[1.02] transition-transform">
                                        <div className="flex items-center gap-3 mb-3">
                                            <div className="p-2 bg-black/10 rounded-xl"><Lightbulb className="h-5 w-5" /></div>
                                            <span className="font-semibold text-sm">Saved Ideas</span>
                                        </div>
                                        <div className="text-4xl font-heading">{stats.metrics.totalSavedIdeas}</div>
                                        <div className="mt-2 text-xs font-medium opacity-80 uppercase tracking-wider">Bookmarked</div>
                                    </div>
                                </div>

                                {/* Main Chart Area */}
                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                    <div className="lg:col-span-2 bg-white border border-gray-100 rounded-3xl p-6 shadow-sm">
                                        <h3 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-2">
                                            Content Pipeline Distribution
                                        </h3>
                                        <div className="h-80 w-full">
                                            {stats.chartData.length > 0 ? (
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <BarChart data={stats.chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                                                        <XAxis
                                                            dataKey="name"
                                                            axisLine={false}
                                                            tickLine={false}
                                                            tick={{ fontSize: 12, fill: '#6b7280' }}
                                                            dy={10}
                                                        />
                                                        <YAxis
                                                            axisLine={false}
                                                            tickLine={false}
                                                            tick={{ fontSize: 12, fill: '#6b7280' }}
                                                        />
                                                        <Tooltip
                                                            cursor={{ fill: 'transparent' }}
                                                            contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)' }}
                                                        />
                                                        <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px', fontSize: '12px' }} />
                                                        <Bar dataKey="ideas" name="Ideas Generated" radius={[4, 4, 0, 0]} maxBarSize={40}>
                                                            {stats.chartData.map((entry, index) => (
                                                                <Cell key={`cell-ideas-${index}`} fill={entry.color} />
                                                            ))}
                                                        </Bar>
                                                        <Bar dataKey="videos" name="Videos Uploaded" fill="#111827" radius={[4, 4, 0, 0]} maxBarSize={40} />
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
                                    <div className="bg-white border border-gray-100 rounded-3xl p-6 shadow-sm flex flex-col">
                                        <h3 className="text-lg font-bold text-gray-900 mb-6">Recent Activity</h3>
                                        <div className="flex-1 space-y-4">
                                            {stats.recentActivity.length > 0 ? (
                                                stats.recentActivity.map((activity, idx) => (
                                                    <div key={idx} className="flex gap-3 text-sm group">
                                                        <div className="mt-1">
                                                            {activity.type === 'video' ? (
                                                                <div className="h-8 w-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center group-hover:bg-blue-100 transition-colors">
                                                                    <PlaySquare className="h-4 w-4" />
                                                                </div>
                                                            ) : (
                                                                <div className="h-8 w-8 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center group-hover:bg-amber-100 transition-colors">
                                                                    <Sparkles className="h-4 w-4" />
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className="overflow-hidden flex-1 border-b border-gray-50 pb-4">
                                                            <div className="font-semibold text-gray-900 text-base flex items-center gap-1 w-full truncate block whitespace-nowrap overflow-hidden text-ellipsis">
                                                                {activity.title}
                                                            </div>
                                                            <div className="text-gray-400 text-xs mt-0.5 font-medium">
                                                                {activity.type === 'video' ? 'Processed' : 'Generated'} · {new Date(activity.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))
                                            ) : (
                                                <div className="text-center text-gray-400 text-sm py-10 italic">
                                                    No recent activity found.
                                                </div>
                                            )}
                                        </div>
                                        <Link href="/videos" className="mt-4 flex items-center justify-center gap-1.5 w-full py-2.5 text-sm font-semibold text-gray-900 bg-gray-50 hover:bg-gray-100 rounded-xl transition-colors">
                                            View Library <ArrowUpRight className="h-4 w-4 text-gray-400" />
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
