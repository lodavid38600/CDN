const compact = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const pct = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero' });

export const eur = (v) => `${compact.format(v || 0)} €`;
export const eurFull = (v) => `${full.format(v || 0)} €`;
export const tonnes = (kg) => `${compact.format((kg || 0) / 1000)} t`;
export const kg = (v) => `${full.format(v || 0)} kg`;
export const percent = (v) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : pct.format(v));
export const ncCode = (c) => (c && c.length === 8 ? `${c.slice(0, 4)} ${c.slice(4, 6)} ${c.slice(6)}` : c);
const sig = new Intl.NumberFormat('fr-FR', { maximumSignificantDigits: 3 });
export const perKg = (v) => (v ? `${sig.format(v)} €/kg` : '—');
