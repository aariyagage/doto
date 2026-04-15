"use client"

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Moon, Sun } from 'lucide-react'
import { getCombo } from '@/lib/colors'

// Re-export for backwards compatibility with existing imports
export { PILLAR_COLORS, getPairedTextColor } from '@/lib/colors'

const TABS = [
    { label: 'Dashboard', path: '/dashboard' },
    { label: 'Upload', path: '/upload' },
    { label: 'Video Library', path: '/videos' },
    { label: 'Content Ideas', path: '/ideas' },
    { label: 'Voice Profile', path: '/voice-profile' },
]

export default function AppLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname()
    const [isDarkMode, setIsDarkMode] = useState(false)

    // Initialize theme from local storage or system preference
    useEffect(() => {
        const savedTheme = localStorage.getItem('theme')
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches

        if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
            setIsDarkMode(true)
            document.documentElement.classList.add('dark')
        }
    }, [])

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

    return (
        <div className="min-h-screen bg-[var(--bg-primary)] p-4 md:p-8 pt-12 text-[var(--text-primary)] transition-colors duration-200">

            {/* Theme Toggle Button */}
            <div className="absolute top-4 right-4 md:top-8 md:right-8 z-50">
                <button
                    onClick={toggleTheme}
                    className="p-2 rounded-full border border-[var(--border-manila)] bg-[var(--bg-panel)] shadow-sm hover:scale-105 transition-transform"
                    aria-label="Toggle Dark Mode"
                >
                    {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                </button>
            </div>

            <div className="max-w-7xl mx-auto flex flex-col items-center">

                {/* Manila Tabs Navigation */}
                <nav className="w-full flex pl-4 relative z-10 -mb-[1px] overflow-x-auto hide-scrollbar">
                    {TABS.map((tab, idx) => {
                        const isActive = pathname === tab.path || pathname.startsWith(tab.path + '/')
                        const combo = getCombo(idx)

                        return (
                            <Link
                                key={tab.path}
                                href={tab.path}
                                className={`
                  relative px-6 py-3 rounded-t-lg border-t border-l border-r border-[var(--border-manila)]
                  font-heading uppercase tracking-[0.14em] text-[11px] md:text-xs whitespace-nowrap -ml-2 first:ml-0 transition-all
                  ${isActive
                                        ? 'z-20 bg-[var(--bg-panel)] font-bold pb-4 border-b-transparent translate-y-[1px] text-[var(--text-primary)]'
                                        : 'z-10 bg-[var(--border-manila-soft)] text-[var(--text-primary)]/55 hover:bg-[var(--bg-panel)] hover:z-20 hover:text-[var(--text-primary)]'
                                    }
                `}
                                style={{
                                    borderTopWidth: isActive ? '3px' : '1px',
                                    borderTopColor: isActive ? combo.bg : undefined,
                                    marginTop: isActive ? '-2px' : '0'
                                }}
                            >
                                {tab.label}
                            </Link>
                        )
                    })}
                </nav>

                {/* Content Panel Area */}
                <main className="w-full bg-[var(--bg-panel)] border border-[var(--border-manila)] rounded-b-xl rounded-tr-xl shadow-[0_12px_40px_-12px_rgba(60,45,20,0.18)] relative z-0 min-h-[70vh] p-6 md:p-10 mb-20 overflow-hidden">
                    {children}
                </main>

            </div>

        </div>
    )
}
