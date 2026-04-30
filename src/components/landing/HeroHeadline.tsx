'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'

/**
 * Synonyms for "what your brain produces" — all describe the same downstream
 * artifact, so the meaning stays even as the word changes. Order picked for
 * cadence: alternating short/long.
 */
const WORDS = ['content', 'reels', 'ideas', 'hooks', 'drafts'] as const
const INTERVAL_MS = 2400
const EASE = [0.25, 1, 0.5, 1] as const

/** Soft manila pill behind the cycling word — tuned to be readable on the
 *  warm paper background without competing with the ink. */
const HIGHLIGHT_BG = 'rgba(200, 181, 138, 0.42)'

export default function HeroHeadline() {
    const [idx, setIdx] = useState(0)
    const reduce = useReducedMotion()

    useEffect(() => {
        if (reduce) return
        const t = setInterval(() => setIdx(i => (i + 1) % WORDS.length), INTERVAL_MS)
        return () => clearInterval(t)
    }, [reduce])

    return (
        <h1 className="text-display-1 text-ink">
            Your brain, organized into{' '}
            <motion.span
                layout
                transition={{ layout: { duration: 0.45, ease: EASE } }}
                className="relative inline-block align-baseline px-2 -mx-1 rounded-md"
                style={{ backgroundColor: HIGHLIGHT_BG }}
            >
                <AnimatePresence mode="popLayout" initial={false}>
                    <motion.span
                        key={WORDS[idx]}
                        initial={{ y: '0.6em', opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: '-0.6em', opacity: 0 }}
                        transition={{ duration: 0.45, ease: EASE }}
                        className="inline-block"
                    >
                        {WORDS[idx]}
                    </motion.span>
                </AnimatePresence>
            </motion.span>
            .
        </h1>
    )
}
