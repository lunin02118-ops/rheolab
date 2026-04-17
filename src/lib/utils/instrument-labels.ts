/**
 * Returns a short display label for a rheometer instrument name.
 * Maps long names (e.g. "Chandler Engineering Model 5550 Rheometer")
 * to concise labels (e.g. "Chandler 5550").
 */
export function shortInstrumentLabel(name?: string | null): string {
    if (!name) return '—';
    const lower = name.toLowerCase();
    if (lower.includes('chandler')) return 'Chandler 5550';
    if (lower.includes('grace') || lower.includes('m5600')) return 'Grace M5600';
    if (lower.includes('brookfield') || lower.includes('pvs')) return 'Brookfield PVS';
    if (lower.includes('fann')) return 'Fann 50';
    if (lower.includes('ofite')) return 'Ofite 1100';
    if (lower.includes('bsl')) return 'BSL R1';
    // unknown — truncate to 16 chars
    return name.length > 16 ? name.slice(0, 14) + '…' : name;
}
