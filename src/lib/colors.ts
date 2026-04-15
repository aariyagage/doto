export const PILLAR_COLORS = [
    { bg: '#630700', text: '#FF97D0' }, // 1: Blood Red
    { bg: '#FF97D0', text: '#125603' }, // 2: Pastel Magenta
    { bg: '#125603', text: '#FF97D0' }, // 3: Lincoln Green
    { bg: '#C3F380', text: '#7523B4' }, // 4: Light Lime
    { bg: '#7523B4', text: '#FAE170' }, // 5: Grape
    { bg: '#D13F13', text: '#FCC5C6' }, // 6: Sinopia
    { bg: '#F058AB', text: '#F1FFBA' }, // 7: Baby Pink
    { bg: '#906713', text: '#FFDB58' }, // 8: Golden Brown
    { bg: '#0D5072', text: '#7FEEFF' }, // 9: Dark Cerulean
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
