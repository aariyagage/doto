import { getPairedTextColor } from '@/lib/colors'

interface FolderProps {
    color: string
    label?: string
    caption?: string
    monogram?: string
    size?: 'sm' | 'md' | 'lg'
    tilt?: number
    className?: string
}

const SIZE_PX = {
    sm: { w: 140, h: 108 },
    md: { w: 220, h: 170 },
    lg: { w: 280, h: 216 },
} as const

export default function Folder({
    color,
    label,
    caption,
    monogram,
    size = 'md',
    tilt = 0,
    className = '',
}: FolderProps) {
    const { w, h } = SIZE_PX[size]
    const textColor = getPairedTextColor(color)

    return (
        <div className={`inline-flex flex-col items-start gap-3 ${className}`} style={{ transform: tilt ? `rotate(${tilt}deg)` : undefined }}>
            <div className="relative" style={{ width: w, height: h }}>
                <svg
                    viewBox="0 0 220 170"
                    width={w}
                    height={h}
                    preserveAspectRatio="none"
                    className="drop-shadow-[0_6px_14px_rgba(0,0,0,0.12)]"
                    aria-hidden="true"
                >
                    <defs>
                        <linearGradient id={`sheen-${color}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.18" />
                            <stop offset="60%" stopColor="#ffffff" stopOpacity="0" />
                        </linearGradient>
                    </defs>

                    {/* Back tab — sticks up behind the body */}
                    <path
                        d="M 10 14 Q 10 6 18 6 L 82 6 Q 88 6 91 11 L 96 20 L 10 20 Z"
                        fill={color}
                        opacity="0.85"
                    />

                    {/* Body — main folder rectangle with rounded corners */}
                    <rect
                        x="6"
                        y="18"
                        width="208"
                        height="146"
                        rx="10"
                        ry="10"
                        fill={color}
                    />

                    {/* Subtle top-edge highlight */}
                    <rect
                        x="6"
                        y="18"
                        width="208"
                        height="146"
                        rx="10"
                        ry="10"
                        fill={`url(#sheen-${color})`}
                    />

                    {/* Monogram */}
                    {monogram && (
                        <text
                            x="50%"
                            y="58%"
                            textAnchor="middle"
                            dominantBaseline="middle"
                            fontFamily="'Cormorant Garamond', 'Adobe Caslon Pro', Georgia, serif"
                            fontStyle="italic"
                            fontWeight="500"
                            fontSize={size === 'sm' ? 44 : size === 'lg' ? 96 : 72}
                            fill={textColor}
                            opacity="0.9"
                        >
                            {monogram}
                        </text>
                    )}
                </svg>
            </div>

            {(label || caption) && (
                <div className="flex flex-col items-start gap-0.5 pl-1">
                    {label && (
                        <span
                            className="font-caslon italic text-sm md:text-base leading-tight"
                            style={{ color: 'var(--text-primary)' }}
                        >
                            {label}
                        </span>
                    )}
                    {caption && (
                        <span className="font-ui text-[9px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                            {caption}
                        </span>
                    )}
                </div>
            )}
        </div>
    )
}
