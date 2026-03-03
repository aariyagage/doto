"use client"

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Moon, Sun } from 'lucide-react'

// Combo definitions for cycling
export const PILLAR_COLORS = [
    { bg: '#630700', text: '#FF97D0' }, // 1: Blood Red
    { bg: '#FF97D0', text: '#125603' }, // 2: Pastel Magenta
    { bg: '#125603', text: '#FF97D0' }, // 3: Lincoln Green
    { bg: '#C3F380', text: '#7523B4' }, // 4: Light Lime
    { bg: '#7523B4', text: '#FAE170' }, // 5: Grape
    { bg: '#D13F13', text: '#FCC5C6' }, // 6: Sinopia
    { bg: '#F058AB', text: '#F1FFBA' }, // 7: Baby Pink
    { bg: '#906713', text: '#FFDB58' }, // 8: Golden Brown
    { bg: '#0D5072', text: '#7FEEFF' }, // 9: Dark Cerulean
]

export function getCombo(index: number) {
    return PILLAR_COLORS[index % PILLAR_COLORS.length]
}

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
                    className="p-2 rounded-full border border-gray-300 dark:border-gray-700 bg-[var(--bg-panel)] shadow-sm hover:scale-105 transition-transform"
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
                  relative px-6 py-3 rounded-t-lg border-t border-l border-r border-[#e5e7eb] dark:border-[#333]
                  font-heading text-sm md:text-base whitespace-nowrap -ml-2 first:ml-0 transition-all
                  ${isActive
                                        ? 'z-20 bg-[var(--bg-panel)] font-bold pb-4 border-b-transparent translate-y-[1px]'
                                        : 'z-10 bg-black/5 dark:bg-white/5 text-gray-500 dark:text-gray-400 hover:bg-[var(--bg-panel)] hover:z-15 hover:text-inherit'
                                    }
                `}
                                style={{
                                    borderTopWidth: isActive ? '3px' : '1px',
                                    borderTopColor: isActive ? combo.bg : undefined,
                                    marginTop: isActive ? '-2px' : '0'
                                }}
                            >
                                {/* Folder corner notch effect */}
                                <div className="absolute top-0 left-0 w-2 h-2 rounded-tl-lg bg-transparent border-t border-l border-[#e5e7eb] dark:border-[#333] -mt-[1px] -ml-[1px] hidden"></div>

                                {tab.label}
                            </Link>
                        )
                    })}
                </nav>

                {/* Content Panel Area */}
                <main className="w-full bg-[var(--bg-panel)] border border-[#e5e7eb] dark:border-[#333] rounded-b-xl rounded-tr-xl shadow-lg relative z-0 min-h-[70vh] p-6 md:p-10 mb-20 overflow-hidden">
                    {children}
                </main>

            </div>

        </div>
    )
}
