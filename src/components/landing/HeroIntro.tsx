'use client'

import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'

const EASE = [0.25, 1, 0.5, 1] as const

const SUBHEAD = 'drop in a thought. doto helps you work it into something you can actually post. ideas, drafts, videos, all in one place.'

/**
 * Sub-hero block. Subhead types in word-by-word, CTA settles in after the
 * subhead lands, "no credit card" line follows. Choreographed to start
 * just after the headline finishes its initial fade.
 */
export default function HeroIntro() {
    const reduce = useReducedMotion()

    const words = SUBHEAD.split(' ')

    const subheadDelay = reduce ? 0 : 0.7
    const ctaDelay = reduce ? 0 : 1.35
    const fineDelay = reduce ? 0 : 1.55

    return (
        <>
            <motion.p
                initial="hidden"
                animate="visible"
                transition={{
                    staggerChildren: reduce ? 0 : 0.025,
                    delayChildren: subheadDelay,
                }}
                className="mt-10 text-body-lg text-ink-muted max-w-2xl text-pretty"
            >
                {words.map((word, i) => (
                    <motion.span
                        key={i}
                        variants={{
                            hidden: reduce ? { opacity: 0 } : { opacity: 0, y: 6 },
                            visible: { opacity: 1, y: 0 },
                        }}
                        transition={{ duration: 0.45, ease: EASE }}
                        className="inline-block"
                    >
                        {word}
                        {i < words.length - 1 ? ' ' : ''}
                    </motion.span>
                ))}
            </motion.p>

            <motion.div
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, ease: EASE, delay: ctaDelay }}
                className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-3"
            >
                <Link
                    href="/signup"
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-ink text-paper text-body font-medium hover:bg-ink/90 transition-colors"
                >
                    get started
                    <ArrowUpRight className="w-4 h-4" strokeWidth={1.75} />
                </Link>
                <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.4, ease: EASE, delay: fineDelay }}
                    className="text-body-sm text-ink-faint"
                >
                    no credit card required.
                </motion.span>
            </motion.div>
        </>
    )
}
