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
    { label: 'videos',      caption: 'raw material',        monogram: 'V', colorIdx: 0, tilt: -2 },
    { label: 'transcripts', caption: 'what you said',       monogram: 'T', colorIdx: 2, tilt: 1.5 },
    { label: 'pillars',     caption: 'recurring themes',    monogram: 'P', colorIdx: 3, tilt: -1 },
    { label: 'ideas',       caption: 'next, automatically', monogram: 'I', colorIdx: 6, tilt: 2 },
    { label: 'voice',       caption: 'your signature DNA',  monogram: 'V', colorIdx: 8, tilt: -1.5 },
    { label: 'library',     caption: 'everything, sorted',  monogram: 'L', colorIdx: 5, tilt: 1 },
]

export default function Home() {
    return (
        <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] selection:bg-[var(--combo-7-bg)] selection:text-[var(--combo-7-text)]">
            {/* Nav */}
            <nav className="w-full px-6 md:px-12 py-6 flex justify-between items-center relative z-10 max-w-7xl mx-auto">
                <Link href="/" className="font-caslon italic font-bold text-4xl tracking-tighter leading-none">
                    doto
                </Link>
                <div className="flex gap-3 items-center">
                    <Link
                        href="/login"
                        className="px-5 py-2 rounded-full border border-black/10 font-ui text-sm font-medium hover:bg-black/5 transition-colors"
                    >
                        Log in
                    </Link>
                    <Link
                        href="/signup"
                        className="px-5 py-2 rounded-full bg-[var(--text-primary)] text-[var(--bg-primary)] font-ui text-sm font-medium hover:scale-[1.03] transition-transform shadow-sm"
                    >
                        Get started
                    </Link>
                </div>
            </nav>

            {/* Hero */}
            <section className="max-w-7xl mx-auto px-6 md:px-12 pt-8 pb-16 md:pt-16 md:pb-24">
                <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-end">
                    <div className="md:col-span-7">
                        <div className="font-ui text-[11px] uppercase tracking-[0.24em] text-[var(--muted-foreground)] mb-6">
                            A creator&rsquo;s content workspace
                        </div>
                        <h1 className="font-heading text-5xl md:text-7xl lg:text-[88px] leading-[0.92] tracking-tight uppercase">
                            Your brain,
                            <br />
                            <span className="font-caslon italic normal-case tracking-tight text-[var(--combo-3-bg)]">organized</span>
                            <br />
                            into content.
                        </h1>
                    </div>
                    <div className="md:col-span-5">
                        <p className="font-caslon italic text-xl md:text-2xl leading-snug text-[var(--text-primary)]/80 max-w-md">
                            Upload your videos. We transcribe them, surface your content pillars, and draft new ideas in your exact voice &mdash; filed and ready to pull when you need them.
                        </p>
                        <div className="mt-8 flex items-center gap-4">
                            <Link
                                href="/signup"
                                className="inline-flex items-center gap-2 px-6 py-3.5 rounded-full bg-[var(--text-primary)] text-[var(--bg-primary)] font-ui font-medium text-base hover:scale-[1.03] transition-transform shadow-md"
                            >
                                Open your workspace
                                <ArrowUpRight className="w-4 h-4" />
                            </Link>
                            <span className="font-ui text-xs text-[var(--muted-foreground)]">
                                No credit card.
                            </span>
                        </div>
                    </div>
                </div>
            </section>

            {/* Workspace shelf */}
            <section className="max-w-7xl mx-auto px-6 md:px-12 pb-20 md:pb-32">
                <div className="flex items-baseline justify-between mb-8 md:mb-12 border-b border-black/10 pb-4">
                    <h2 className="font-heading text-2xl md:text-3xl tracking-tight uppercase">
                        The workspace
                    </h2>
                    <span className="font-ui text-[11px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
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

            {/* How it works — numbered, editorial */}
            <section className="max-w-7xl mx-auto px-6 md:px-12 pb-24 md:pb-32">
                <div className="flex items-baseline justify-between mb-8 md:mb-12 border-b border-black/10 pb-4">
                    <h2 className="font-heading text-2xl md:text-3xl tracking-tight uppercase">
                        How it files itself
                    </h2>
                    <span className="font-ui text-[11px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
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
                            body: 'As your library grows, recurring themes get promoted to named pillars &mdash; the subjects you actually talk about.',
                        },
                        {
                            n: '03',
                            title: 'Ideas, in your voice',
                            body: 'Pull fresh ideas tuned to your pillars, hooks you would actually open with, structures you would actually use.',
                        },
                    ].map((step) => (
                        <li key={step.n} className="flex flex-col gap-3">
                            <span className="font-heading text-[11px] uppercase tracking-[0.24em] text-[var(--muted-foreground)]">
                                Step {step.n}
                            </span>
                            <h3 className="font-heading text-xl md:text-2xl tracking-tight leading-snug">
                                {step.title}
                            </h3>
                            <p
                                className="font-caslon italic text-base md:text-lg leading-relaxed text-[var(--text-primary)]/75"
                                dangerouslySetInnerHTML={{ __html: step.body }}
                            />
                        </li>
                    ))}
                </ol>
            </section>

            {/* Closing CTA band */}
            <section className="max-w-7xl mx-auto px-6 md:px-12 pb-20 md:pb-28">
                <div className="border-t border-black/10 pt-10 md:pt-14 flex flex-col md:flex-row items-start md:items-end justify-between gap-6">
                    <div>
                        <h2 className="font-heading text-3xl md:text-5xl tracking-tight uppercase leading-[0.95]">
                            Stop starting<br />
                            from scratch.
                        </h2>
                        <p className="mt-4 font-caslon italic text-lg text-[var(--text-primary)]/70 max-w-md">
                            Your workspace is already full of material. doto files it for you.
                        </p>
                    </div>
                    <Link
                        href="/signup"
                        className="inline-flex items-center gap-2 px-7 py-4 rounded-full bg-[var(--text-primary)] text-[var(--bg-primary)] font-ui font-medium text-base hover:scale-[1.03] transition-transform shadow-md whitespace-nowrap"
                    >
                        Start filing
                        <ArrowUpRight className="w-4 h-4" />
                    </Link>
                </div>
            </section>

            {/* Footer */}
            <footer className="max-w-7xl mx-auto px-6 md:px-12 pb-10 border-t border-black/5 pt-6 flex items-center justify-between">
                <span className="font-caslon italic text-xl tracking-tighter">doto</span>
                <span className="font-ui text-[11px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                    &copy; {new Date().getFullYear()}
                </span>
            </footer>
        </div>
    )
}
