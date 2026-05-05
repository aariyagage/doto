'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'

const EASE = [0.25, 1, 0.5, 1] as const

const HIGHLIGHT_BG = 'rgba(200, 181, 138, 0.42)'

const VARIANTS = ['voice memos', 'half-ideas', 'rough notes', 'thoughts'] as const
const WORD_HOLD_MS = 1100

export default function HeroHeadline() {
    const reduce = useReducedMotion()
    const [idx, setIdx] = useState(0)
    const isFinal = idx === VARIANTS.length - 1

    useEffect(() => {
        if (reduce) {
            setIdx(VARIANTS.length - 1)
            return
        }
        if (isFinal) return
        const t = setTimeout(() => setIdx(i => i + 1), WORD_HOLD_MS)
        return () => clearTimeout(t)
    }, [idx, reduce, isFinal])

    const lineInitial = reduce ? { opacity: 0 } : { opacity: 0, y: 12 }
    const lineAnimate = reduce ? { opacity: 1 } : { opacity: 1, y: 0 }

    return (
        <h1 className="text-display-1 text-ink text-pretty">
            <motion.span
                initial={lineInitial}
                animate={lineAnimate}
                transition={{ duration: 0.6, ease: EASE, delay: 0.05 }}
                className="block"
            >
                turn your{' '}
                <motion.span
                    layout
                    transition={{ layout: { duration: 0.45, ease: EASE } }}
                    className="relative inline-block align-baseline px-2 -mx-1 rounded-md"
                    style={{ backgroundColor: HIGHLIGHT_BG }}
                >
                    <AnimatePresence mode="popLayout" initial={false}>
                        <motion.span
                            key={VARIANTS[idx]}
                            initial={{ y: '0.45em', opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            exit={{ y: '-0.45em', opacity: 0 }}
                            transition={{ duration: 0.4, ease: EASE }}
                            className="inline-block whitespace-nowrap"
                        >
                            {VARIANTS[idx]}
                        </motion.span>
                    </AnimatePresence>
                </motion.span>
                {' '}into content.
            </motion.span>
        </h1>
    )
}
