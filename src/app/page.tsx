import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import HeroHeadline from '@/components/landing/HeroHeadline'
import WorkspaceShelf from '@/components/landing/WorkspaceShelf'
import Bento from '@/components/landing/Bento'
import SpecsStrip from '@/components/landing/SpecsStrip'

export default function Home() {
    return (
        <div className="min-h-screen bg-paper text-ink">
            {/* Nav */}
            <nav className="w-full max-w-6xl mx-auto px-6 md:px-10 py-6 flex items-center justify-between">
                <Link href="/" className="text-xl font-semibold tracking-tight leading-none">
                    doto
                </Link>
                <div className="flex items-center gap-1">
                    <Link
                        href="/login"
                        className="px-4 py-2 text-body-sm text-ink-muted hover:text-ink transition-colors"
                    >
                        log in
                    </Link>
                    <Link
                        href="/signup"
                        className="ml-2 px-5 py-2 rounded-full bg-ink text-paper text-body-sm font-medium hover:bg-ink/90 transition-colors"
                    >
                        get started
                    </Link>
                </div>
            </nav>

            {/* Hero */}
            <section className="max-w-5xl mx-auto px-6 md:px-10 pt-16 pb-20 md:pt-28 md:pb-28">
                <div className="text-caption text-ink-muted mb-8">
                    a creator&rsquo;s content workspace
                </div>
                <HeroHeadline />
                <p className="mt-8 text-body-lg text-ink-muted max-w-2xl text-pretty">
                    upload your videos. we transcribe them, surface your content pillars, and draft new ideas in your exact voice — filed and ready when you need them.
                </p>
                <div className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-3">
                    <Link
                        href="/signup"
                        className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-ink text-paper text-body font-medium hover:bg-ink/90 transition-colors"
                    >
                        open your workspace
                        <ArrowUpRight className="w-4 h-4" strokeWidth={1.75} />
                    </Link>
                    <span className="text-body-sm text-ink-faint">
                        no credit card required.
                    </span>
                </div>
            </section>

            {/* Workspace shelf — animated stagger */}
            <WorkspaceShelf />

            {/* Bento — capabilities */}
            <Bento />

            {/* Specs strip — honest claims */}
            <SpecsStrip />

            {/* Closing CTA */}
            <section className="max-w-6xl mx-auto px-6 md:px-10 pb-24 md:pb-32">
                <div className="border-t border-rule pt-12 md:pt-16 flex flex-col md:flex-row md:items-end md:justify-between gap-8">
                    <div>
                        <h2 className="text-display-2 text-ink">
                            stop starting<br />
                            from scratch.
                        </h2>
                        <p className="mt-5 text-body-lg text-ink-muted max-w-md">
                            your workspace is already full of material. doto files it for you.
                        </p>
                    </div>
                    <Link
                        href="/signup"
                        className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-ink text-paper text-body font-medium hover:bg-ink/90 transition-colors whitespace-nowrap self-start md:self-auto"
                    >
                        start filing
                        <ArrowUpRight className="w-4 h-4" strokeWidth={1.75} />
                    </Link>
                </div>
            </section>

            {/* Footer */}
            <footer className="max-w-6xl mx-auto px-6 md:px-10 pb-10 pt-8 border-t border-rule flex items-center justify-between">
                <span className="text-base font-semibold tracking-tight">doto</span>
                <span className="text-caption text-ink-faint">
                    &copy; {new Date().getFullYear()}
                </span>
            </footer>
        </div>
    )
}
