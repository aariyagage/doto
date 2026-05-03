'use client';

import { X } from 'lucide-react';
import { displayBg, getPairedTextColor } from '@/lib/colors';

// Folder-shaped pillar filter chip used on /ideas.
//
// Visually mirrors the <Folder> SVG shape from the library — back tab + body
// with the same path geometry — but sized to fit a single text label and
// behave as a clickable filter button. Width adapts to the label.

type Props = {
    name: string;
    color: string | null | undefined;
    isSelected: boolean;
    isSeries?: boolean;
    onClick: () => void;
    onDelete: (e: React.MouseEvent) => void;
    onRename: (e: React.MouseEvent) => void;
    /** When true, the body fills with `color` and ink switches to the paired light/dark.
     *  When false, only a thin colored outline + faded tab is shown. */
};

export default function PillarFolderChip({
    name,
    color,
    isSelected,
    isSeries,
    onClick,
    onDelete,
    onRename,
}: Props) {
    const fill = displayBg(color || undefined);
    const ink = isSelected ? getPairedTextColor(color || '') : 'var(--ink-muted, #4a4a4a)';

    return (
        <button
            onClick={onClick}
            type="button"
            className="group relative inline-flex items-stretch h-12 transition-transform hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/30 rounded-md"
            aria-pressed={isSelected}
            aria-label={`${isSelected ? 'Selected pillar' : 'Pillar'} ${name}${isSeries ? ', series' : ''}`}
        >
            {/* Folder SVG shape — back tab + body. Stretches with the button width via
                preserveAspectRatio="none". Tab proportions match <Folder> at sm size. */}
            <svg
                className="absolute inset-0 w-full h-full pointer-events-none"
                viewBox="0 0 220 60"
                preserveAspectRatio="none"
                aria-hidden="true"
            >
                {/* Back tab — same curve geometry as <Folder> just scaled to 60h */}
                <path
                    d="M 10 10 Q 10 2 18 2 L 78 2 Q 84 2 87 7 L 92 16 L 10 16 Z"
                    fill={fill}
                    opacity={isSelected ? 0.92 : 0.45}
                />
                {/* Body */}
                <rect
                    x="6"
                    y="14"
                    width="208"
                    height="44"
                    rx="6"
                    ry="6"
                    fill={isSelected ? fill : 'var(--paper-elevated, #ffffff)'}
                    stroke={isSelected ? 'rgba(0,0,0,0.08)' : fill}
                    strokeWidth={isSelected ? 1 : 2}
                />
            </svg>

            {/* Label + actions sit above the SVG. Top padding aligns text below the tab. */}
            <span className="relative z-10 inline-flex items-center gap-2 pl-5 pr-3 pt-3 pb-1">
                <span
                    onClick={onRename}
                    className={`text-[11px] ${isSelected ? 'font-semibold' : 'font-medium'} hover:underline decoration-current/30 underline-offset-2 whitespace-nowrap`}
                    style={{ color: ink }}
                    title="Click to rename"
                >
                    {name}
                </span>
                {isSeries && (
                    <span
                        className="text-[10px] font-semibold rounded-sm px-1 py-0.5"
                        style={{
                            backgroundColor: isSelected ? 'rgba(0,0,0,0.10)' : 'var(--paper-sunken, #f0ede8)',
                            color: ink,
                        }}
                        title="series pillar"
                    >
                        series
                    </span>
                )}
                <button
                    onClick={onDelete}
                    type="button"
                    className="rounded-md p-0.5 transition-all opacity-0 group-hover:opacity-100 hover:bg-black/10"
                    style={{ color: ink }}
                    title="Delete pillar"
                    aria-label={`Delete ${name}`}
                >
                    <X className="h-3 w-3 stroke-[3]" />
                </button>
            </span>
        </button>
    );
}

// Sister component for the "all ideas" tab — same folder shape, no pillar
// metadata, always rendered with the ink palette so it reads as the default.
export function AllIdeasFolderChip({
    isSelected,
    onClick,
}: {
    isSelected: boolean;
    onClick: () => void;
}) {
    return (
        <button
            onClick={onClick}
            type="button"
            className="group relative inline-flex items-stretch h-12 transition-transform hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/30 rounded-md"
            aria-pressed={isSelected}
            aria-label="Show all ideas"
        >
            <svg
                className="absolute inset-0 w-full h-full pointer-events-none"
                viewBox="0 0 220 60"
                preserveAspectRatio="none"
                aria-hidden="true"
            >
                <path
                    d="M 10 10 Q 10 2 18 2 L 78 2 Q 84 2 87 7 L 92 16 L 10 16 Z"
                    fill={isSelected ? 'var(--ink, #1a1816)' : 'var(--ink, #1a1816)'}
                    opacity={isSelected ? 0.92 : 0.45}
                />
                <rect
                    x="6"
                    y="14"
                    width="208"
                    height="44"
                    rx="6"
                    ry="6"
                    fill={isSelected ? 'var(--ink, #1a1816)' : 'var(--paper-elevated, #ffffff)'}
                    stroke={isSelected ? 'rgba(0,0,0,0.08)' : 'var(--ink, #1a1816)'}
                    strokeWidth={isSelected ? 1 : 2}
                />
            </svg>
            <span className="relative z-10 inline-flex items-center pl-5 pr-5 pt-3 pb-1">
                <span
                    className={`text-[11px] ${isSelected ? 'font-semibold text-paper' : 'font-medium text-ink-muted'} whitespace-nowrap`}
                >
                    all ideas
                </span>
            </span>
        </button>
    );
}
