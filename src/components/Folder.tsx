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
                    className="drop-shadow-[0_4px_12px_rgba(15,15,15,0.08)]"
                    aria-hidden="true"
                >
                    {/* Back tab — sticks up behind the body */}
                    <path
                        d="M 10 14 Q 10 6 18 6 L 82 6 Q 88 6 91 11 L 96 20 L 10 20 Z"
                        fill={color}
                        opacity="0.92"
                    />

                    {/* Body — main folder rectangle with rounded corners */}
                    <rect
                        x="6"
                        y="18"
                        width="208"
                        height="146"
                        rx="12"
                        ry="12"
                        fill={color}
                    />

                    {/* Monogram */}
                    {monogram && (
                        <text
                            x="50%"
                            y="60%"
                            textAnchor="middle"
                            dominantBaseline="middle"
                            fontFamily="-apple-system, BlinkMacSystemFont, 'SF Pro Display', Inter, sans-serif"
                            fontWeight="600"
                            fontSize={size === 'sm' ? 38 : size === 'lg' ? 80 : 60}
                            letterSpacing="-0.02em"
                            fill={textColor}
                            opacity="0.85"
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
                            className="text-sm md:text-base font-semibold tracking-tight leading-tight"
                            style={{ color: 'var(--text-primary)' }}
                        >
                            {label}
                        </span>
                    )}
                    {caption && (
                        <span className="text-xs text-[var(--muted-foreground)]">
                            {caption}
                        </span>
                    )}
                </div>
            )}
        </div>
    )
}
