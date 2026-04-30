import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import Folder from '@/components/Folder'

const WORKSPACE_FOLDERS: { label: string; caption: string; index: string }[] = [
    { label: 'Videos',      caption: 'Raw material',         index: '01' },
    { label: 'Transcripts', caption: 'What you said',        index: '02' },
    { label: 'Pillars',     caption: 'Recurring themes',     index: '03' },
    { label: 'Ideas',       caption: 'Next, automatically',  index: '04' },
    { label: 'Voice',       caption: 'Your signature DNA',   index: '05' },
    { label: 'Library',     caption: 'Everything, sorted',   index: '06' },
]

const STEPS = [
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
]

export default function Home() {
    return (
        <div className="min-h-screen bg-paper text-ink">
            {/* Nav */}
            <nav className="w-full max-w-6xl mx-auto px-6 md:px-10 py-6 flex items-center justify-between">
                <Link href="/" className="font-serif text-2xl leading-none tracking-tight">
                    doto
                </Link>
                <div className="flex items-center gap-1">
                    <Link
                        href="/login"
                        className="px-4 py-2 text-body-sm text-ink-muted hover:text-ink transition-colors"
                    >
                        Log in
                    </Link>
                    <Link
                        href="/signup"
                        className="ml-2 px-5 py-2 rounded-full bg-ink text-paper text-body-sm font-medium hover:bg-ink/90 transition-colors"
                    >
                        Get started
                    </Link>
                </div>
            </nav>

            {/* Hero */}
            <section className="max-w-5xl mx-auto px-6 md:px-10 pt-16 pb-20 md:pt-28 md:pb-28">
                <div className="text-caption text-ink-muted mb-8">
                    A creator&rsquo;s content workspace
                </div>
                <h1 className="font-serif text-display-1 text-ink text-balance">
                    Your brain, organized <em className="italic font-normal">into content.</em>
                </h1>
                <p className="mt-8 text-body-lg text-ink-muted max-w-2xl text-pretty">
                    Upload your videos. We transcribe them, surface your content pillars, and draft new ideas in your exact voice — filed and ready when you need them.
                </p>
                <div className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-3">
                    <Link
                        href="/signup"
                        className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-ink text-paper text-body font-medium hover:bg-ink/90 transition-colors"
                    >
                        Open your workspace
                        <ArrowUpRight className="w-4 h-4" strokeWidth={1.75} />
                    </Link>
                    <span className="text-body-sm text-ink-faint">
                        No credit card required.
                    </span>
                </div>
            </section>

            {/* Workspace shelf */}
            <section className="max-w-6xl mx-auto px-6 md:px-10 pb-24 md:pb-32">
                <header className="flex items-baseline justify-between pb-6 mb-12 md:mb-16 border-b border-rule">
                    <h2 className="font-serif text-display-3 text-ink">
                        The workspace
                    </h2>
                    <span className="text-caption text-ink-muted">
                        Six folders · One filing system
                    </span>
                </header>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-12 md:gap-x-12 md:gap-y-16 justify-items-start">
                    {WORKSPACE_FOLDERS.map(f => (
                        <Folder
                            key={f.label}
                            label={f.label}
                            caption={f.caption}
                            index={f.index}
                            size="md"
                        />
                    ))}
                </div>
            </section>

            {/* How it works */}
            <section className="max-w-6xl mx-auto px-6 md:px-10 pb-24 md:pb-32">
                <header className="flex items-baseline justify-between pb-6 mb-12 md:mb-16 border-b border-rule">
                    <h2 className="font-serif text-display-3 text-ink">
                        How it files itself
                    </h2>
                    <span className="text-caption text-ink-muted">
                        Three steps
                    </span>
                </header>

                <ol className="grid grid-cols-1 md:grid-cols-3 gap-10 md:gap-12">
                    {STEPS.map(step => (
                        <li key={step.n} className="flex flex-col gap-3">
                            <span className="font-serif italic text-ink-faint text-2xl leading-none">
                                {step.n}
                            </span>
                            <h3 className="text-title-2 text-ink mt-2">
                                {step.title}
                            </h3>
                            <p className="text-body text-ink-muted text-pretty">
                                {step.body}
                            </p>
                        </li>
                    ))}
                </ol>
            </section>

            {/* Closing CTA */}
            <section className="max-w-6xl mx-auto px-6 md:px-10 pb-24 md:pb-32">
                <div className="border-t border-rule pt-12 md:pt-16 flex flex-col md:flex-row md:items-end md:justify-between gap-8">
                    <div>
                        <h2 className="font-serif text-display-2 text-ink leading-[1.02]">
                            Stop starting<br />
                            <em className="italic font-normal">from scratch.</em>
                        </h2>
                        <p className="mt-5 text-body-lg text-ink-muted max-w-md">
                            Your workspace is already full of material. doto files it for you.
                        </p>
                    </div>
                    <Link
                        href="/signup"
                        className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-ink text-paper text-body font-medium hover:bg-ink/90 transition-colors whitespace-nowrap self-start md:self-auto"
                    >
                        Start filing
                        <ArrowUpRight className="w-4 h-4" strokeWidth={1.75} />
                    </Link>
                </div>
            </section>

            {/* Footer */}
            <footer className="max-w-6xl mx-auto px-6 md:px-10 pb-10 pt-8 border-t border-rule flex items-center justify-between">
                <span className="font-serif text-lg leading-none">doto</span>
                <span className="text-caption text-ink-faint">
                    &copy; {new Date().getFullYear()}
                </span>
            </footer>
        </div>
    )
}
