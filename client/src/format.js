const full = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const pct = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero' });
const share = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 });
const sig = new Intl.NumberFormat('fr-FR', { maximumSignificantDigits: 3 });


export const eur = (v) => `${tidy(v, 'Md €', 'M €', 'k €', '€')}`;
export const eurFull = (v) => `${full.format(Math.round(v || 0))} €`;
export const tonnes = (kg) => `${tidy((kg || 0) / 1000, 'Mt', 'Mt', 'kt', 't', true)}`;
export const kg = (v) => `${full.format(Math.round(v || 0))} kg`;
export const percent = (v) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : pct.format(v));
export const sharePct = (v) => (Number.isFinite(v) ? share.format(v) : '—');
export const perKg = (v) => (v && Number.isFinite(v) ? `${sig.format(v)} €/kg` : '—');
export const ncCode = (c) => {
  if (!c) return '';
  if (c.length === 8) return `${c.slice(0, 4)} ${c.slice(4, 6)} ${c.slice(6)}`;
  if (c.length === 6) return `${c.slice(0, 4)} ${c.slice(4)}`;
  return c;
};
export const integer = (v) => full.format(v || 0);

/** Format compact homogène : 1,2 Md € · 345 M € · 12 k € · 950 € */
function tidy(v, bn, mn, k, unit, tonnesMode = false) {
  const a = Math.abs(v || 0);
  const sign = v < 0 ? '−' : '';
  if (tonnesMode) {
    if (a >= 1e6) return `${sign}${sig.format(a / 1e6)} Mt`;
    if (a >= 1e3) return `${sign}${sig.format(a / 1e3)} kt`;
    return `${sign}${sig.format(a)} t`;
  }
  if (a >= 1e9) return `${sign}${sig.format(a / 1e9)} ${bn}`;
  if (a >= 1e6) return `${sign}${sig.format(a / 1e6)} ${mn}`;
  if (a >= 1e3) return `${sign}${sig.format(a / 1e3)} ${k}`;
  return `${sign}${full.format(a)} ${unit}`;
}

export const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** "2018-03" -> "mars 2018" ; "2018" -> "2018" */
export function periodLabel(p, short = false) {
  if (!p) return '';
  if (String(p).includes('-T')) return `${short ? 'T' : `${['1er', '2e', '3e', '4e'][Number(p.slice(-1)) - 1]} trimestre `}${short ? p.slice(-1) : ''} ${p.slice(0, 4)}`.replace(/\s+/g, ' ').trim();
  const [y, m] = String(p).split('-');
  if (!m) return y;
  return `${(short ? MONTHS_SHORT : MONTHS)[Number(m) - 1]} ${y}`;
}

/** Plage lisible : « mars 2018 → janvier 2019 », « 2023 », « 2019 → 2024 » */
export function rangeLabel(from, to) {
  if (!from && !to) return 'toute la période';
  if (from && to) {
    const [fy, fm] = from.split('-');
    const [ty, tm] = to.split('-');
    if (fy === ty && (fm ?? '01') === '01' && (tm ?? '12') === '12') return fy;
    if ((fm ?? '01') === '01' && (tm ?? '12') === '12') return `${fy} → ${ty}`;
    return `${periodLabel(from)} → ${periodLabel(to)}`;
  }
  return from ? `depuis ${periodLabel(from)}` : `jusqu'à ${periodLabel(to)}`;
}

/** Valeur selon la mesure : 'value' (€) ou 'quantity' (kg). */
export const fmtMeasure = (measure) => (measure === 'quantity' ? tonnes : eur);

/** Bornes AAAA-MM d'une période « 2023 », « 2023-T2 » ou « 2023-04 ». */
export function periodToBounds(p) {
  if (!p) return null;
  if (p.length === 4) return { periodFrom: `${p}-01`, periodTo: `${p}-12` };
  if (p.includes('-T')) {
    const q = Number(p.slice(-1));
    const pad = (m) => String(m).padStart(2, '0');
    return { periodFrom: `${p.slice(0, 4)}-${pad(q * 3 - 2)}`, periodTo: `${p.slice(0, 4)}-${pad(q * 3)}` };
  }
  return { periodFrom: p, periodTo: p };
}
