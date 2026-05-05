'use client'

import { motion } from 'framer-motion'
import Folder from '@/components/Folder'

const EASE = [0.25, 1, 0.5, 1] as const

const STEPS: { label: string; caption: string; index: string; color: string }[] = [
    { label: 'add a thought',    caption: 'anything you’ve been sitting on',                  index: '01', color: '#B49C84' },
    { label: 'shape it',         caption: 'make it clear enough to use',                       index: '02', color: '#D97066' },
    { label: 'sort it',          caption: 'drop it into the right pillar',                     index: '03', color: '#CBD0AF' },
    { label: 'upload a video',   caption: 'optional. doto reads the transcript, deletes the file', index: '04', color: '#481F1F' },
    { label: 'build from there', caption: 'turn it into a post when you’re ready',              index: '05', color: '#B49C84' },
]

export default function WorkspaceShelf() {
    return (
        <section className="max-w-6xl mx-auto px-6 md:px-10 pb-24 md:pb-32">
            <header className="flex items-baseline justify-between pb-6 mb-12 md:mb-16 border-b border-rule">
                <h2 className="text-display-3 text-ink">
                    how it works
                </h2>
                <span className="text-caption text-ink-muted">
                    five steps, one place
                </span>
            </header>

            <motion.div
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-80px' }}
                transition={{ staggerChildren: 0.08, delayChildren: 0.1 }}
                className="flex flex-wrap justify-center gap-x-10 md:gap-x-20 gap-y-14 md:gap-y-20 max-w-4xl mx-auto"
            >
                {STEPS.map(s => (
                    <motion.div
                        key={s.label}
                        variants={{
                            hidden: { opacity: 0, y: 20 },
                            visible: { opacity: 1, y: 0 },
                        }}
                        transition={{ duration: 0.55, ease: EASE }}
                    >
                        <Folder
                            label={s.label}
                            caption={s.caption}
                            index={s.index}
                            color={s.color}
                            size="md"
                        />
                    </motion.div>
                ))}
            </motion.div>
        </section>
    )
}
