'use client'

import { motion } from 'framer-motion'

const EASE = [0.25, 1, 0.5, 1] as const

export default function ProblemSection() {
    return (
        <section className="max-w-3xl mx-auto px-6 md:px-10 pb-24 md:pb-32">
            <header className="pb-6 mb-10 md:mb-14 border-b border-rule">
                <span className="text-caption text-ink-muted">
                    the problem
                </span>
            </header>

            <motion.h2
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.55, ease: EASE }}
                className="text-display-3 text-ink text-pretty"
            >
                you probably have more ideas than you think.
            </motion.h2>

            <motion.p
                initial={{ opacity: 0, y: 8 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.55, ease: EASE, delay: 0.12 }}
                className="mt-8 text-body-lg text-ink-muted text-pretty"
            >
                they&rsquo;re just scattered. a voice memo here, a note there, something you meant to film three weeks ago. and every time you sit down to post, it feels like starting over.
            </motion.p>
        </section>
    )
}
