'use client'

import { motion } from 'framer-motion'

const EASE = [0.25, 1, 0.5, 1] as const

const SPECS = [
    {
        n: '01',
        title: 'private',
        body: 'your video file never leaves your device. we extract the audio, pull the transcript, and delete the rest. only the words stay.',
    },
    {
        n: '02',
        title: 'free',
        body: 'groq whisper for transcription, llama for drafting, miniLM for embeddings. no paid keys, no surprises.',
    },
    {
        n: '03',
        title: 'early days',
        body: 'no credit card. use it, break it, tell us what’s wrong.',
    },
]

export default function SpecsStrip() {
    return (
        <section className="max-w-6xl mx-auto px-6 md:px-10 pb-24 md:pb-32">
            <motion.dl
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-80px' }}
                transition={{ staggerChildren: 0.1 }}
                className="grid grid-cols-1 md:grid-cols-3 gap-x-10 gap-y-10 border-t border-rule pt-12 md:pt-16"
            >
                {SPECS.map(spec => (
                    <motion.div
                        key={spec.n}
                        variants={{
                            hidden: { opacity: 0, y: 16 },
                            visible: { opacity: 1, y: 0 },
                        }}
                        transition={{ duration: 0.5, ease: EASE }}
                        className="flex flex-col gap-2"
                    >
                        <span className="text-3xl font-light tabular-nums text-ink-faint leading-none tracking-tight">
                            {spec.n}
                        </span>
                        <dt className="text-title-3 text-ink mt-3">
                            {spec.title}
                        </dt>
                        <dd className="text-body text-ink-muted text-pretty leading-relaxed">
                            {spec.body}
                        </dd>
                    </motion.div>
                ))}
            </motion.dl>
        </section>
    )
}
