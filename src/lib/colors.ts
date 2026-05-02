export const PILLAR_COLORS = [
    { bg: '#B49C84', text: '#FAF8F3' }, // 1: dessert cup
    { bg: '#D97066', text: '#FAF8F3' }, // 2: rose petals
    { bg: '#CBD0AF', text: '#1A1816' }, // 3: shop window (sage)
    { bg: '#481F1F', text: '#FAF8F3' }, // 4: cowboy boots
] as const

export function getCombo(index: number) {
    return PILLAR_COLORS[index % PILLAR_COLORS.length]
}

const normalizeHex = (c: string) => c.trim().toLowerCase()

// Returns the paired text color for a given pillar background. Falls back to
// luminance-based black/white if the bg isn't one of the predefined combos —
// pillar colors are stored per-row in the DB and may have drifted from the palette.
export function getPairedTextColor(bg: string): string {
    if (!bg) return '#111111'
    const target = normalizeHex(bg)
    const match = PILLAR_COLORS.find(c => normalizeHex(c.bg) === target)
    if (match) return match.text

    const hex = target.replace('#', '')
    if (hex.length !== 6) return '#111111'
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    return luminance > 0.6 ? '#111111' : '#ffffff'
}
