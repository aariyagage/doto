'use client'

import { motion, type MotionProps } from 'framer-motion'
import { type ReactNode } from 'react'

const EASE = [0.25, 1, 0.5, 1] as const

interface BentoTileProps extends Omit<MotionProps, 'children'> {
    children: ReactNode
    caption?: string
    headline?: string
    className?: string
    /**
     * Manila tab horizontal position. Defaults to 'left' (28px from left).
     * Pass 'right' to mirror or 'none' to suppress the tab on a tile.
     */
    tab?: 'left' | 'right' | 'none'
}

/**
 * Reusable bento card. A subtle manila tab pokes out the top of the card so
 * each tile reads as something filed inside a folder — the brand throughline.
 *
 * Animations:
 *   • Fade + 24px translate-up on scroll into view (once)
 *   • -2px hover lift, 200ms ease-out-quart
 */
export default function BentoTile({
    children,
    caption,
    headline,
    className = '',
    tab = 'left',
    ...rest
}: BentoTileProps) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            whileHover={{ y: -2, transition: { duration: 0.2, ease: EASE } }}
            viewport={{ once: true, margin: '-50px' }}
            transition={{ duration: 0.6, ease: EASE }}
            className={`relative pt-3 ${className}`}
            {...rest}
        >
            {tab !== 'none' && (
                <div
                    aria-hidden
                    className={`absolute top-0 h-3 w-20 bg-manila rounded-t-md ${
                        tab === 'right' ? 'right-8' : 'left-8'
                    }`}
                    style={{ boxShadow: '0 1px 0 rgba(0,0,0,0.04)' }}
                />
            )}

            <div className="relative h-full bg-paper-elevated border border-rule rounded-xl p-6 md:p-8 flex flex-col">
                {caption && (
                    <span className="text-caption text-ink-faint">
                        {caption}
                    </span>
                )}
                {headline && (
                    <h3 className="text-title-2 text-ink mt-2 mb-5">
                        {headline}
                    </h3>
                )}
                <div className="flex-1 flex flex-col">
                    {children}
                </div>
            </div>
        </motion.div>
    )
}
