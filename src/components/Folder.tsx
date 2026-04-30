import { getPairedTextColor } from '@/lib/colors'

interface FolderProps {
    label?: string
    caption?: string
    index?: string          // editorial corner mark — numeral or letter
    color?: string          // optional bg override; defaults to manila
    inkColor?: string       // optional ink override; auto-paired if color given
    size?: 'sm' | 'md' | 'lg'
    className?: string
}

const SIZE_PX = {
    sm: { w: 140, h: 108 },
    md: { w: 220, h: 170 },
    lg: { w: 280, h: 216 },
} as const

/**
 * Editorial folder. Single restrained manila by default with a small corner
 * numeral instead of a giant monogram. No tilt, no drop-shadow gimmicks —
 * just a quiet typographic object that fits an editorial layout.
 *
 * Pass `color` to override the default manila (e.g., for pillar tagging UI
 * where each pillar carries its own DB-saved color).
 */
export default function Folder({
    label,
    caption,
    index,
    color,
    inkColor,
    size = 'md',
    className = '',
}: FolderProps) {
    const { w, h } = SIZE_PX[size]
    const fill = color ?? 'var(--manila)'
    const ink = inkColor ?? (color ? getPairedTextColor(color) : 'var(--manila-ink)')

    return (
        <div className={`inline-flex flex-col items-start gap-3 ${className}`}>
            <div className="relative" style={{ width: w, height: h }}>
                <svg
                    viewBox="0 0 220 170"
                    width={w}
                    height={h}
                    preserveAspectRatio="none"
                    aria-hidden="true"
                >
                    {/* Back tab */}
                    <path
                        d="M 10 14 Q 10 6 18 6 L 82 6 Q 88 6 91 11 L 96 20 L 10 20 Z"
                        fill={fill}
                        opacity="0.92"
                    />

                    {/* Body */}
                    <rect
                        x="6"
                        y="18"
                        width="208"
                        height="146"
                        rx="6"
                        ry="6"
                        fill={fill}
                    />

                    {/* Corner numeral — editorial, not a kindergarten letter */}
                    {index && (
                        <text
                            x="22"
                            y="48"
                            textAnchor="start"
                            dominantBaseline="middle"
                            fontFamily="var(--font-instrument-serif), Baskerville, serif"
                            fontWeight="400"
                            fontSize={size === 'sm' ? 16 : size === 'lg' ? 24 : 20}
                            letterSpacing="0"
                            fill={ink}
                            opacity="0.55"
                            fontStyle="italic"
                        >
                            {index}
                        </text>
                    )}
                </svg>
            </div>

            {(label || caption) && (
                <div className="flex flex-col items-start gap-1">
                    {label && (
                        <span className="text-title-3 text-ink leading-none">
                            {label}
                        </span>
                    )}
                    {caption && (
                        <span className="text-body-sm text-ink-muted">
                            {caption}
                        </span>
                    )}
                </div>
            )}
        </div>
    )
}
