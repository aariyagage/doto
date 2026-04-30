import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import Folder from '@/components/Folder'
import { PILLAR_COLORS } from '@/lib/colors'

const WORKSPACE_FOLDERS: {
    label: string
    caption: string
    monogram: string
    colorIdx: number
    tilt: number
}[] = [
    { label: 'Videos',      caption: 'Raw material',         monogram: 'V', colorIdx: 0, tilt: -2 },
    { label: 'Transcripts', caption: 'What you said',        monogram: 'T', colorIdx: 2, tilt: 1.5 },
    { label: 'Pillars',     caption: 'Recurring themes',     monogram: 'P', colorIdx: 3, tilt: -1 },
    { label: 'Ideas',       caption: 'Next, automatically',  monogram: 'I', colorIdx: 6, tilt: 2 },
    { label: 'Voice',       caption: 'Your signature DNA',   monogram: 'V', colorIdx: 8, tilt: -1.5 },
    { label: 'Library',     caption: 'Everything, sorted',   monogram: 'L', colorIdx: 5, tilt: 1 },
]

export default function Home() {
    return (
        <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
            {/* Nav */}
            <nav className="w-full px-6 md:px-12 py-5 flex justify-between items-center max-w-7xl mx-auto">
                <Link href="/" className="text-2xl font-semibold tracking-tight leading-none">
                    doto
                </Link>
                <div className="flex gap-2 items-center">
                    <Link
                        href="/login"
                        className="px-4 py-2 rounded-full text-sm font-medium text-[var(--text-primary)]/70 hover:text-[var(--text-primary)] hover:bg-[var(--text-primary)]/[0.04] transition-colors"
                    >
                        Log in
                    </Link>
                    <Link
                        href="/signup"
                        className="px-4 py-2 rounded-full bg-[var(--text-primary)] text-[var(--bg-primary)] text-sm font-medium hover:opacity-90 transition-opacity"
                    >
                        Get started
                    </Link>
                </div>
            </nav>

            {/* Hero */}
            <section className="max-w-6xl mx-auto px-6 md:px-12 pt-12 pb-16 md:pt-24 md:pb-24 text-center">
                <div className="text-xs uppercase tracking-[0.16em] text-[var(--muted-foreground)] mb-6 font-medium">
                    A creator&rsquo;s content workspace
                </div>
                <h1 className="text-5xl md:text-7xl lg:text-[80px] font-semibold leading-[1.02] tracking-[-0.035em] max-w-4xl mx-auto">
                    Your brain,{' '}
                    <span className="text-[var(--combo-3-bg)]">organized</span>
                    <br />
                    into content.
                </h1>
                <p className="mt-7 text-lg md:text-xl leading-relaxed text-[var(--text-primary)]/65 max-w-2xl mx-auto">
                    Upload your videos. We transcribe them, surface your content pillars, and draft new ideas in your exact voice — filed and ready when you need them.
                </p>
                <div className="mt-9 flex items-center justify-center gap-4">
                    <Link
                        href="/signup"
                        className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[var(--text-primary)] text-[var(--bg-primary)] font-medium text-base hover:opacity-90 transition-opacity"
                    >
                        Open your workspace
                        <ArrowUpRight className="w-4 h-4" />
                    </Link>
                    <span className="text-sm text-[var(--muted-foreground)]">
                        No credit card.
                    </span>
                </div>
            </section>

            {/* Workspace shelf */}
            <section className="max-w-7xl mx-auto px-6 md:px-12 pb-20 md:pb-32">
                <div className="flex items-baseline justify-between mb-10 md:mb-14 pb-4 border-b border-[var(--border-manila)]">
                    <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">
                        The workspace
                    </h2>
                    <span className="text-sm text-[var(--muted-foreground)]">
                        Six folders. One filing system.
                    </span>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-10 md:gap-x-10 md:gap-y-14 justify-items-start">
                    {WORKSPACE_FOLDERS.map((f) => {
                        const combo = PILLAR_COLORS[f.colorIdx]
                        return (
                            <Folder
                                key={f.label}
                                color={combo.bg}
                                label={f.label}
                                caption={f.caption}
                                monogram={f.monogram}
                                tilt={f.tilt}
                                size="md"
                            />
                        )
                    })}
                </div>
            </section>

            {/* How it works */}
            <section className="max-w-7xl mx-auto px-6 md:px-12 pb-24 md:pb-32">
                <div className="flex items-baseline justify-between mb-10 md:mb-14 pb-4 border-b border-[var(--border-manila)]">
                    <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">
                        How it files itself
                    </h2>
                    <span className="text-sm text-[var(--muted-foreground)]">
                        Three steps
                    </span>
                </div>

                <ol className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12">
                    {[
                        {
                            n: '01',
                            title: 'Upload raw footage',
                            body: 'Drop in a video or a batch. We run transcription, chunk it, and save it to your transcripts folder.',
                        },
                        {
                            n: '02',
                            title: 'Pillars surface',
                            body: 'As your library grows, recurring themes get promoted to named pillars — the subjects you actually talk about.',
                        },
                        {
                            n: '03',
                            title: 'Ideas, in your voice',
                            body: 'Pull fresh ideas tuned to your pillars, hooks you would actually open with, structures you would actually use.',
                        },
                    ].map((step) => (
                        <li key={step.n} className="flex flex-col gap-3">
                            <span className="text-xs uppercase tracking-[0.16em] text-[var(--muted-foreground)] font-medium">
                                Step {step.n}
                            </span>
                            <h3 className="text-xl md:text-2xl font-semibold tracking-tight leading-snug">
                                {step.title}
                            </h3>
                            <p className="text-base leading-relaxed text-[var(--text-primary)]/70">
                                {step.body}
                            </p>
                        </li>
                    ))}
                </ol>
            </section>

            {/* Closing CTA band */}
            <section className="max-w-7xl mx-auto px-6 md:px-12 pb-20 md:pb-28">
                <div className="border-t border-[var(--border-manila)] pt-10 md:pt-14 flex flex-col md:flex-row items-start md:items-end justify-between gap-6">
                    <div>
                        <h2 className="text-3xl md:text-5xl font-semibold tracking-[-0.03em] leading-[1.05]">
                            Stop starting<br />
                            from scratch.
                        </h2>
                        <p className="mt-4 text-lg text-[var(--text-primary)]/65 max-w-md">
                            Your workspace is already full of material. doto files it for you.
                        </p>
                    </div>
                    <Link
                        href="/signup"
                        className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[var(--text-primary)] text-[var(--bg-primary)] font-medium text-base hover:opacity-90 transition-opacity whitespace-nowrap"
                    >
                        Start filing
                        <ArrowUpRight className="w-4 h-4" />
                    </Link>
                </div>
            </section>

            {/* Footer */}
            <footer className="max-w-7xl mx-auto px-6 md:px-12 pb-10 border-t border-[var(--border-manila)] pt-6 flex items-center justify-between">
                <span className="text-base font-semibold tracking-tight">doto</span>
                <span className="text-xs text-[var(--muted-foreground)]">
                    &copy; {new Date().getFullYear()}
                </span>
            </footer>
        </div>
    )
}
