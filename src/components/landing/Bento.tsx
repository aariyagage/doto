'use client'

import { motion } from 'framer-motion'
import BentoTile from './BentoTile'

const EASE = [0.25, 1, 0.5, 1] as const

const PILLAR_CHIPS = [
    'Productivity',
    'Mindset',
    'Founder Diaries',
    'Solopreneur Saturdays',
    'Voice',
]

const IDEA_CARDS = [
    "5 things I'd tell a creator with 1k followers",
    'Why my morning routine takes 8 minutes',
    "The 'consistency' lie",
]

/**
 * Tile 1 — animated transcript reveal. Words fade in word-by-word, then two
 * phrases get a manila highlight wipe and a small pillar tag flips in beside
 * them. Conveys "we read every word and surface the themes."
 */
function TranscriptReveal() {
    const TOKENS: { text: string; highlight?: 'productivity' | 'mindset' }[] = [
        { text: 'Most' }, { text: 'creators' }, { text: 'think' }, { text: 'you' },
        { text: 'need' }, { text: 'to' },
        { text: 'wake up at 5am.', highlight: 'productivity' },
        { text: "I'm" }, { text: 'gonna' }, { text: 'tell' }, { text: 'you' }, { text: 'why' },
        { text: "that's broken", highlight: 'mindset' },
        { text: '— and' }, { text: 'what' }, { text: 'works' }, { text: 'instead.' },
    ]

    return (
        <div className="flex-1 flex flex-col justify-end">
            <motion.p
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-80px' }}
                transition={{ staggerChildren: 0.04, delayChildren: 0.2 }}
                className="text-2xl md:text-3xl leading-snug tracking-tight text-ink"
            >
                {TOKENS.map((tok, i) => (
                    <motion.span
                        key={i}
                        variants={{
                            hidden: { opacity: 0 },
                            visible: { opacity: 1 },
                        }}
                        transition={{ duration: 0.35, ease: EASE }}
                        className={
                            tok.highlight
                                ? 'relative inline-block px-1 -mx-0.5 rounded'
                                : ''
                        }
                        style={
                            tok.highlight
                                ? { backgroundColor: 'rgba(200, 181, 138, 0.32)' }
                                : undefined
                        }
                    >
                        {tok.text}{' '}
                    </motion.span>
                ))}
            </motion.p>

            {/* Pillar tags inferred from the highlighted phrases */}
            <motion.div
                initial={{ opacity: 0, y: 8 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-80px' }}
                transition={{ duration: 0.5, ease: EASE, delay: 1.4 }}
                className="mt-6 flex flex-wrap gap-2"
            >
                {[
                    { label: 'Productivity', n: '01' },
                    { label: 'Mindset', n: '02' },
                ].map(p => (
                    <span
                        key={p.label}
                        className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-paper border border-rule text-body-sm text-ink"
                    >
                        <span className="text-ink-faint tabular-nums font-light">
                            {p.n}
                        </span>
                        {p.label}
                    </span>
                ))}
            </motion.div>
        </div>
    )
}

/** Tile 2 — pillar chips appearing one by one. */
function PillarChips() {
    return (
        <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: '-50px' }}
            transition={{ staggerChildren: 0.07, delayChildren: 0.2 }}
            className="flex-1 flex flex-wrap gap-2 content-start"
        >
            {PILLAR_CHIPS.map(p => (
                <motion.span
                    key={p}
                    variants={{
                        hidden: { opacity: 0, y: 8 },
                        visible: { opacity: 1, y: 0 },
                    }}
                    transition={{ duration: 0.4, ease: EASE }}
                    className="inline-flex items-center px-3 py-1.5 rounded-full bg-paper border border-rule text-body-sm text-ink"
                >
                    {p}
                </motion.span>
            ))}
        </motion.div>
    )
}

/** Tile 3 — voice pull quote. */
function VoiceQuote() {
    return (
        <div className="flex-1 flex flex-col justify-between">
            <p className="text-xl md:text-2xl leading-snug tracking-tight text-ink text-balance">
                &ldquo;I don&rsquo;t believe in productivity hacks. I believe in showing up tired and doing it anyway.&rdquo;
            </p>
            <span className="mt-6 text-caption text-ink-faint">
                Inferred from your transcripts
            </span>
        </div>
    )
}

/** Tile 4 — stack of idea cards. Hover fans them out. */
function IdeaStack() {
    return (
        <motion.div
            initial="rest"
            whileHover="fan"
            animate="rest"
            className="flex-1 flex items-center justify-center pt-4"
        >
            <div className="relative w-full h-32">
                {IDEA_CARDS.map((idea, i) => {
                    const restRotate = (i - 1) * 2
                    const restY = i * 4
                    const fanRotate = (i - 1) * 6
                    const fanX = (i - 1) * 14
                    return (
                        <motion.div
                            key={idea}
                            variants={{
                                rest: { rotate: restRotate, x: 0, y: restY },
                                fan: { rotate: fanRotate, x: fanX, y: 0 },
                            }}
                            transition={{ duration: 0.35, ease: EASE }}
                            className="absolute inset-x-0 top-0 mx-auto w-full max-w-[260px] rounded-lg bg-paper border border-rule px-4 py-3 shadow-sm"
                            style={{ zIndex: i + 1 }}
                        >
                            <span className="text-body-sm text-ink leading-snug">
                                {idea}
                            </span>
                        </motion.div>
                    )
                })}
            </div>
        </motion.div>
    )
}

/** Tile 5 — privacy. */
function PrivacyBlurb() {
    return (
        <div className="flex-1 flex flex-col justify-end">
            <p className="text-body text-ink-muted text-pretty leading-relaxed">
                Once we extract the transcript, the video file is deleted. We never store the original — only the words it contained.
            </p>
        </div>
    )
}

export default function Bento() {
    return (
        <section className="max-w-6xl mx-auto px-6 md:px-10 pb-24 md:pb-32">
            <header className="flex items-baseline justify-between pb-6 mb-12 md:mb-16 border-b border-rule">
                <h2 className="text-display-3 text-ink">
                    What it does for you
                </h2>
                <span className="text-caption text-ink-muted">
                    Five things, one workspace
                </span>
            </header>

            {/* Bento grid — 6-col on desktop, stacks on mobile.
                Row 1: large transcript tile (4) + pillars tile (2)
                Row 2: voice (2) + ideas (2) + privacy (2) */}
            <div className="grid grid-cols-1 md:grid-cols-6 gap-4 md:gap-5">
                <BentoTile
                    caption="01 — Transcribe"
                    headline="Every word, captured."
                    className="md:col-span-4 md:row-span-1 min-h-[320px]"
                >
                    <TranscriptReveal />
                </BentoTile>

                <BentoTile
                    caption="02 — Surface"
                    headline="Themes, found for you."
                    tab="right"
                    className="md:col-span-2 min-h-[320px]"
                >
                    <PillarChips />
                </BentoTile>

                <BentoTile
                    caption="03 — Voice"
                    headline="Your signature, captured."
                    className="md:col-span-2 min-h-[260px]"
                >
                    <VoiceQuote />
                </BentoTile>

                <BentoTile
                    caption="04 — Draft"
                    headline="Ideas, filed."
                    tab="right"
                    className="md:col-span-2 min-h-[260px]"
                >
                    <IdeaStack />
                </BentoTile>

                <BentoTile
                    caption="05 — Private"
                    headline="Videos, deleted."
                    className="md:col-span-2 min-h-[260px]"
                >
                    <PrivacyBlurb />
                </BentoTile>
            </div>
        </section>
    )
}
