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

// Maps every previous-palette hex onto the current-palette equivalent so existing
// pillars in the DB pick up palette swaps without regeneration. Index N in the old
// palette routes to index ((N-1) mod 4) in PILLAR_COLORS.
const LEGACY_BG_REMAP: Record<string, string> = {
    '#630700': PILLAR_COLORS[0].bg, // old 1: blood red
    '#ff97d0': PILLAR_COLORS[1].bg, // old 2: pastel magenta
    '#125603': PILLAR_COLORS[2].bg, // old 3: lincoln green
    '#c3f380': PILLAR_COLORS[3].bg, // old 4: light lime
    '#7523b4': PILLAR_COLORS[0].bg, // old 5: grape
    '#d13f13': PILLAR_COLORS[1].bg, // old 6: sinopia
    '#f058ab': PILLAR_COLORS[2].bg, // old 7: baby pink
    '#906713': PILLAR_COLORS[3].bg, // old 8: golden brown
    '#0d5072': PILLAR_COLORS[0].bg, // old 9: dark cerulean
}

// Resolves a stored pillar bg to the current palette. Pass-through for hex
// values that are already in the current palette or unknown.
export function displayBg(stored: string | null | undefined): string {
    if (!stored) return PILLAR_COLORS[0].bg
    const key = normalizeHex(stored)
    return LEGACY_BG_REMAP[key] ?? stored
}

// Returns the paired text color for a given pillar background. Routes through
// displayBg so old-palette stored values pick up the new paired text.
export function getPairedTextColor(bg: string): string {
    if (!bg) return '#111111'
    const resolved = displayBg(bg)
    const target = normalizeHex(resolved)
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
