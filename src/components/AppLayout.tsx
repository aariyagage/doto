"use client"

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
    Moon,
    Sun,
    LayoutGrid,
    UploadCloud,
    FolderOpen,
    Lightbulb,
    Sparkles,
    Inbox,
    Layers,
    Mic,
    Menu,
    X,
} from 'lucide-react'
import { featureFlags } from '@/lib/env'

// Re-export for backwards compatibility with existing imports
export { PILLAR_COLORS, getPairedTextColor, displayBg } from '@/lib/colors'

interface NavItem {
    label: string
    path: string
    Icon: typeof LayoutGrid
    flag?: 'conceptPipeline' | 'brainstormInbox' | 'workspaceV1'
}

// Order: dashboard, INBOX (new — gated), upload, library, ideas (legacy),
// CONCEPTS (new — gated), WORKSPACE (new — gated), voice. Inbox sits
// early because the daily capture flow is meant to be a quick first stop.
// Concepts + Workspace cluster next to ideas during the transition so
// dogfooders can hop between surfaces.
const NAV_ITEMS: NavItem[] = [
    { label: 'dashboard', path: '/dashboard', Icon: LayoutGrid },
    { label: 'inbox', path: '/inbox', Icon: Inbox, flag: 'brainstormInbox' },
    { label: 'upload', path: '/upload', Icon: UploadCloud },
    { label: 'library', path: '/videos', Icon: FolderOpen },
    { label: 'ideas', path: '/ideas', Icon: Lightbulb },
    { label: 'concepts', path: '/concepts', Icon: Sparkles, flag: 'conceptPipeline' },
    { label: 'workspace', path: '/workspace', Icon: Layers, flag: 'workspaceV1' },
    { label: 'voice', path: '/voice-profile', Icon: Mic },
]

export default function AppLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname()
    const [isDarkMode, setIsDarkMode] = useState(false)
    const [isMobileNavOpen, setIsMobileNavOpen] = useState(false)

    useEffect(() => {
        const savedTheme = localStorage.getItem('theme')
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches

        if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
            setIsDarkMode(true)
            document.documentElement.classList.add('dark')
        }
    }, [])

    useEffect(() => {
        setIsMobileNavOpen(false)
    }, [pathname])

    const toggleTheme = () => {
        if (isDarkMode) {
            document.documentElement.classList.remove('dark')
            localStorage.setItem('theme', 'light')
            setIsDarkMode(false)
        } else {
            document.documentElement.classList.add('dark')
            localStorage.setItem('theme', 'dark')
            setIsDarkMode(true)
        }
    }

    const NavList = ({ onNavigate }: { onNavigate?: () => void }) => (
        <nav className="flex flex-col gap-1 px-3">
            {NAV_ITEMS.map(({ label, path, Icon, flag }) => {
                if (flag && !featureFlags[flag]()) return null
                const isActive = pathname === path || pathname.startsWith(path + '/')
                return (
                    <Link
                        key={path}
                        href={path}
                        onClick={onNavigate}
                        className={`
                            group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors
                            ${isActive
                                ? 'bg-ink/[0.06] text-ink'
                                : 'text-ink-muted hover:bg-ink/[0.04] hover:text-ink'
                            }
                        `}
                    >
                        <Icon
                            className={`h-[18px] w-[18px] transition-colors ${isActive ? 'text-ink' : 'text-ink-faint group-hover:text-ink-muted'}`}
                            strokeWidth={1.75}
                        />
                        <span>{label}</span>
                    </Link>
                )
            })}
        </nav>
    )

    return (
        <div className="min-h-screen bg-paper text-ink transition-colors duration-200">

            {/* Mobile top bar */}
            <header className="md:hidden sticky top-0 z-30 flex items-center justify-between px-4 h-14 bg-paper/80 backdrop-blur-md border-b border-rule">
                <Link href="/dashboard" className="text-[17px] font-semibold tracking-tight">
                    doto
                </Link>
                <div className="flex items-center gap-1">
                    <button
                        onClick={toggleTheme}
                        className="p-2 rounded-lg text-ink-muted hover:text-ink hover:bg-ink/[0.05] transition-colors"
                        aria-label="toggle dark mode"
                    >
                        {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                    </button>
                    <button
                        onClick={() => setIsMobileNavOpen(v => !v)}
                        className="p-2 rounded-lg text-ink-muted hover:text-ink hover:bg-ink/[0.05] transition-colors"
                        aria-label={isMobileNavOpen ? 'close menu' : 'open menu'}
                        aria-expanded={isMobileNavOpen}
                    >
                        {isMobileNavOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
                    </button>
                </div>
            </header>

            {/* Mobile drawer */}
            {isMobileNavOpen && (
                <div className="md:hidden fixed inset-0 z-20 pt-14 bg-paper/95 backdrop-blur-sm">
                    <div className="py-4">
                        <NavList onNavigate={() => setIsMobileNavOpen(false)} />
                    </div>
                </div>
            )}

            <div className="flex">
                {/* Sidebar (desktop) */}
                <aside className="hidden md:flex sticky top-0 h-screen w-60 shrink-0 flex-col border-r border-rule bg-paper">
                    <div className="flex items-center justify-between px-5 h-16">
                        <Link href="/dashboard" className="text-[19px] font-semibold tracking-tight">
                            doto
                        </Link>
                    </div>
                    <div className="mt-2 flex-1">
                        <NavList />
                    </div>
                    <div className="px-3 pb-4 pt-3 border-t border-rule">
                        <button
                            onClick={toggleTheme}
                            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-ink-muted hover:text-ink hover:bg-ink/[0.04] transition-colors"
                            aria-label="toggle dark mode"
                        >
                            {isDarkMode ? (
                                <>
                                    <Sun className="h-[18px] w-[18px]" strokeWidth={1.75} />
                                    <span>light mode</span>
                                </>
                            ) : (
                                <>
                                    <Moon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                                    <span>dark mode</span>
                                </>
                            )}
                        </button>
                    </div>
                </aside>

                {/* Main content */}
                <main className="flex-1 min-w-0">
                    <div className="mx-auto w-full max-w-[1200px] px-5 md:px-10 py-8 md:py-10">
                        {children}
                    </div>
                </main>
            </div>
        </div>
    )
}
