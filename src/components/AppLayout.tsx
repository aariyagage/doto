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
    Mic,
    Menu,
    X,
} from 'lucide-react'

// Re-export for backwards compatibility with existing imports
export { PILLAR_COLORS, getPairedTextColor } from '@/lib/colors'

const NAV_ITEMS = [
    { label: 'Dashboard', path: '/dashboard', Icon: LayoutGrid },
    { label: 'Upload', path: '/upload', Icon: UploadCloud },
    { label: 'Library', path: '/videos', Icon: FolderOpen },
    { label: 'Ideas', path: '/ideas', Icon: Lightbulb },
    { label: 'Voice', path: '/voice-profile', Icon: Mic },
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
            {NAV_ITEMS.map(({ label, path, Icon }) => {
                const isActive = pathname === path || pathname.startsWith(path + '/')
                return (
                    <Link
                        key={path}
                        href={path}
                        onClick={onNavigate}
                        className={`
                            group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors
                            ${isActive
                                ? 'bg-[var(--text-primary)]/[0.06] text-[var(--text-primary)]'
                                : 'text-[var(--text-primary)]/60 hover:bg-[var(--text-primary)]/[0.04] hover:text-[var(--text-primary)]'
                            }
                        `}
                    >
                        <Icon
                            className={`h-[18px] w-[18px] transition-colors ${isActive ? 'text-[var(--text-primary)]' : 'text-[var(--text-primary)]/50 group-hover:text-[var(--text-primary)]/80'}`}
                            strokeWidth={1.75}
                        />
                        <span>{label}</span>
                    </Link>
                )
            })}
        </nav>
    )

    return (
        <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] transition-colors duration-200">

            {/* Mobile top bar */}
            <header className="md:hidden sticky top-0 z-30 flex items-center justify-between px-4 h-14 bg-[var(--bg-primary)]/80 backdrop-blur-md border-b border-[var(--border-manila)]">
                <Link href="/dashboard" className="text-[17px] font-semibold tracking-tight">
                    doto
                </Link>
                <div className="flex items-center gap-1">
                    <button
                        onClick={toggleTheme}
                        className="p-2 rounded-lg text-[var(--text-primary)]/60 hover:text-[var(--text-primary)] hover:bg-[var(--text-primary)]/[0.05] transition-colors"
                        aria-label="Toggle dark mode"
                    >
                        {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                    </button>
                    <button
                        onClick={() => setIsMobileNavOpen(v => !v)}
                        className="p-2 rounded-lg text-[var(--text-primary)]/60 hover:text-[var(--text-primary)] hover:bg-[var(--text-primary)]/[0.05] transition-colors"
                        aria-label={isMobileNavOpen ? 'Close menu' : 'Open menu'}
                        aria-expanded={isMobileNavOpen}
                    >
                        {isMobileNavOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
                    </button>
                </div>
            </header>

            {/* Mobile drawer */}
            {isMobileNavOpen && (
                <div className="md:hidden fixed inset-0 z-20 pt-14 bg-[var(--bg-primary)]/95 backdrop-blur-sm">
                    <div className="py-4">
                        <NavList onNavigate={() => setIsMobileNavOpen(false)} />
                    </div>
                </div>
            )}

            <div className="flex">
                {/* Sidebar (desktop) */}
                <aside className="hidden md:flex sticky top-0 h-screen w-60 shrink-0 flex-col border-r border-[var(--border-manila)] bg-[var(--bg-primary)]">
                    <div className="flex items-center justify-between px-5 h-16">
                        <Link href="/dashboard" className="text-[19px] font-semibold tracking-tight">
                            doto
                        </Link>
                    </div>
                    <div className="mt-2 flex-1">
                        <NavList />
                    </div>
                    <div className="px-3 pb-4 pt-3 border-t border-[var(--border-manila)]">
                        <button
                            onClick={toggleTheme}
                            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-[var(--text-primary)]/60 hover:text-[var(--text-primary)] hover:bg-[var(--text-primary)]/[0.04] transition-colors"
                            aria-label="Toggle dark mode"
                        >
                            {isDarkMode ? (
                                <>
                                    <Sun className="h-[18px] w-[18px]" strokeWidth={1.75} />
                                    <span>Light mode</span>
                                </>
                            ) : (
                                <>
                                    <Moon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                                    <span>Dark mode</span>
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
