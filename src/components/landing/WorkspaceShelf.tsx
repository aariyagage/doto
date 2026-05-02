'use client'

import { motion } from 'framer-motion'
import Folder from '@/components/Folder'

const EASE = [0.25, 1, 0.5, 1] as const

// Cycle through the 4-color palette so the landing showcases the combos.
const WORKSPACE_FOLDERS: { label: string; caption: string; index: string; color: string }[] = [
    { label: 'Videos',      caption: 'raw material',         index: '01', color: '#B49C84' }, // dessert cup
    { label: 'Transcripts', caption: 'what you said',        index: '02', color: '#D97066' }, // rose petals
    { label: 'Pillars',     caption: 'recurring themes',     index: '03', color: '#CBD0AF' }, // shop window
    { label: 'Ideas',       caption: 'next, automatically',  index: '04', color: '#481F1F' }, // cowboy boots
    { label: 'Voice',       caption: 'your signature DNA',   index: '05', color: '#B49C84' }, // dessert cup
    { label: 'Library',     caption: 'everything, sorted',   index: '06', color: '#D97066' }, // rose petals
]

export default function WorkspaceShelf() {
    return (
        <section className="max-w-6xl mx-auto px-6 md:px-10 pb-24 md:pb-32">
            <header className="flex items-baseline justify-between pb-6 mb-12 md:mb-16 border-b border-rule">
                <h2 className="text-display-3 text-ink">
                    the workspace
                </h2>
                <span className="text-caption text-ink-muted">
                    six folders · one filing system
                </span>
            </header>

            <motion.div
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-80px' }}
                transition={{ staggerChildren: 0.07, delayChildren: 0.1 }}
                className="grid grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-12 md:gap-x-12 md:gap-y-16 justify-items-start"
            >
                {WORKSPACE_FOLDERS.map(f => (
                    <motion.div
                        key={f.label}
                        variants={{
                            hidden: { opacity: 0, y: 20 },
                            visible: { opacity: 1, y: 0 },
                        }}
                        transition={{ duration: 0.55, ease: EASE }}
                    >
                        <Folder
                            label={f.label}
                            caption={f.caption}
                            index={f.index}
                            color={f.color}
                            size="md"
                        />
                    </motion.div>
                ))}
            </motion.div>
        </section>
    )
}
