'use client'

import { motion } from 'framer-motion'
import BentoTile from './BentoTile'

const EASE = [0.25, 1, 0.5, 1] as const

const PILLAR_CHIPS: { label: string; bg: string; text: string }[] = [
    { label: 'Productivity',           bg: '#B49C84', text: '#1A1816' },
    { label: 'Mindset',                bg: '#D97066', text: '#1A1816' },
    { label: 'Founder Diaries',        bg: '#CBD0AF', text: '#1A1816' },
    { label: 'Solopreneur Saturdays',  bg: '#481F1F', text: '#FFFFFF' },
    { label: 'Voice',                  bg: '#B49C84', text: '#1A1816' },
]

const REFINED_IDEAS = [
    "5 things I'd tell a creator with 1k followers",
    'Why my morning routine takes 8 minutes',
    "The 'consistency' lie",
]

/**
 * Lead tile — rough thought becoming a structured idea.
 * The thought types in, two phrases get a manila wipe, and a hook + angle
 * tag pair flips in below.
 */
function ThoughtToIdea() {
    const TOKENS: { text: string; highlight?: 'hook' | 'angle' }[] = [
        { text: 'i' }, { text: 'wanna' }, { text: 'make' }, { text: 'a' }, { text: 'video' },
        { text: 'about' }, { text: 'how' },
        { text: 'the 5am rule is broken', highlight: 'hook' },
        { text: 'and' },
        { text: 'most creators are doing it wrong', highlight: 'angle' },
    ]

    const HIGHLIGHT_BG = {
        hook:  'rgba(180, 156, 132, 0.45)',
        angle: 'rgba(217, 112, 102, 0.32)',
    } as const

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
                                ? { backgroundColor: HIGHLIGHT_BG[tok.highlight] }
                                : undefined
                        }
                    >
                        {tok.text}{' '}
                    </motion.span>
                ))}
            </motion.p>

            <motion.div
                initial={{ opacity: 0, y: 8 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-80px' }}
                transition={{ duration: 0.5, ease: EASE, delay: 1.2 }}
                className="mt-6 flex flex-wrap gap-2"
            >
                {[
                    { label: 'hook',  n: '01', bg: '#B49C84', text: '#1A1816' },
                    { label: 'angle', n: '02', bg: '#D97066', text: '#1A1816' },
                ].map(p => (
                    <span
                        key={p.label}
                        className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-body-sm font-medium"
                        style={{ backgroundColor: p.bg, color: p.text }}
                    >
                        <span className="tabular-nums font-light opacity-70">
                            {p.n}
                        </span>
                        {p.label}
                    </span>
                ))}
            </motion.div>
        </div>
    )
}

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
                    key={p.label}
                    variants={{
                        hidden: { opacity: 0, y: 8 },
                        visible: { opacity: 1, y: 0 },
                    }}
                    transition={{ duration: 0.4, ease: EASE }}
                    className="inline-flex items-center px-3 py-1.5 rounded-full text-body-sm font-medium"
                    style={{ backgroundColor: p.bg, color: p.text }}
                >
                    {p.label}
                </motion.span>
            ))}
        </motion.div>
    )
}

/**
 * Upload tile — a filename and a small waveform fade in, then a snippet of
 * the resulting transcript appears below. Conveys "drop in a video, it
 * understands what you said."
 */
function UploadReveal() {
    return (
        <div className="flex-1 flex flex-col justify-between">
            <motion.div
                initial={{ opacity: 0, y: 8 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-50px' }}
                transition={{ duration: 0.5, ease: EASE }}
                className="flex flex-col gap-3"
            >
                <div className="flex items-center gap-3 px-3 py-2 rounded-md bg-paper border border-rule">
                    <div className="w-2 h-2 rounded-full bg-ink/40" aria-hidden />
                    <span className="text-body-sm text-ink-muted truncate">
                        morning_routine_take2.mp4
                    </span>
                </div>

                <div className="flex items-end gap-[3px] h-7 px-1" aria-hidden>
                    {Array.from({ length: 28 }).map((_, i) => {
                        const heights = [40, 70, 55, 85, 35, 90, 60, 50, 75, 45, 65, 80, 30, 70, 55, 85, 50, 75, 40, 60, 90, 55, 35, 70, 80, 45, 65, 50]
                        return (
                            <motion.span
                                key={i}
                                initial={{ scaleY: 0.2, opacity: 0 }}
                                whileInView={{ scaleY: heights[i] / 100, opacity: 0.7 }}
                                viewport={{ once: true, margin: '-50px' }}
                                transition={{ duration: 0.4, ease: EASE, delay: 0.2 + i * 0.015 }}
                                className="w-[3px] flex-1 bg-ink origin-bottom rounded-sm"
                            />
                        )
                    })}
                </div>
            </motion.div>

            <motion.p
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true, margin: '-50px' }}
                transition={{ duration: 0.5, ease: EASE, delay: 0.9 }}
                className="text-body-sm text-ink-muted leading-relaxed mt-5 text-pretty"
            >
                &ldquo;most creators think you need to wake up at 5am. i&rsquo;m gonna tell you why that&rsquo;s broken&hellip;&rdquo;
            </motion.p>
        </div>
    )
}

/** Refine tile — stack of editable idea cards. Hover fans them out. */
function IdeaStack() {
    return (
        <motion.div
            initial="rest"
            whileHover="fan"
            animate="rest"
            className="flex-1 flex items-center justify-center pt-4"
        >
            <div className="relative w-full h-32">
                {REFINED_IDEAS.map((idea, i) => {
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

/**
 * Learn tile — text-led. A simple sequence of three increasingly-specific
 * suggestion lines fade in to convey "the more you use it, the more it fits
 * what you actually make."
 */
function LearnOverTime() {
    const LINES = [
        { text: 'a video about morning routines', tone: 'faint' },
        { text: 'a video about why early-rising backfires for solo creators', tone: 'muted' },
        { text: 'a video about the 8-minute morning that fits a maker schedule', tone: 'ink' },
    ] as const

    const COLOR = {
        faint: 'text-ink-faint',
        muted: 'text-ink-muted',
        ink:   'text-ink',
    } as const

    return (
        <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: '-50px' }}
            transition={{ staggerChildren: 0.18, delayChildren: 0.15 }}
            className="flex-1 flex flex-col justify-end gap-3"
        >
            {LINES.map((line, i) => (
                <motion.div
                    key={i}
                    variants={{
                        hidden: { opacity: 0, x: -6 },
                        visible: { opacity: 1, x: 0 },
                    }}
                    transition={{ duration: 0.5, ease: EASE }}
                    className="flex items-baseline gap-3"
                >
                    <span className="text-caption text-ink-faint tabular-nums">
                        0{i + 1}
                    </span>
                    <span className={`text-body leading-snug ${COLOR[line.tone]}`}>
                        {line.text}
                    </span>
                </motion.div>
            ))}
        </motion.div>
    )
}

export default function Bento() {
    return (
        <section className="max-w-6xl mx-auto px-6 md:px-10 pb-24 md:pb-32">
            <header className="flex items-baseline justify-between pb-6 mb-12 md:mb-16 border-b border-rule">
                <h2 className="text-display-3 text-ink">
                    what you can do with it
                </h2>
                <span className="text-caption text-ink-muted">
                    five things, one workspace
                </span>
            </header>

            {/* Row 1: lead "shape" tile (4) + organize (2)
                Row 2: upload (2) + refine (2) + learn (2) */}
            <div className="grid grid-cols-1 md:grid-cols-6 gap-4 md:gap-5">
                <BentoTile
                    caption="01 · shape"
                    headline="a rough thought becomes a real idea."
                    className="md:col-span-4 md:row-span-1 min-h-[320px]"
                >
                    <ThoughtToIdea />
                </BentoTile>

                <BentoTile
                    caption="02 · organize"
                    headline="pillars, your way."
                    tab="right"
                    className="md:col-span-2 min-h-[320px]"
                >
                    <PillarChips />
                </BentoTile>

                <BentoTile
                    caption="03 · upload"
                    headline="upload a video. keep the words."
                    className="md:col-span-2 min-h-[260px]"
                >
                    <UploadReveal />
                </BentoTile>

                <BentoTile
                    caption="04 · refine"
                    headline="edit any idea until it’s right."
                    tab="right"
                    className="md:col-span-2 min-h-[260px]"
                >
                    <IdeaStack />
                </BentoTile>

                <BentoTile
                    caption="05 · learn"
                    headline="gets more useful the more you use it."
                    className="md:col-span-2 min-h-[260px]"
                >
                    <LearnOverTime />
                </BentoTile>
            </div>
        </section>
    )
}
