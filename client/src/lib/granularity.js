// Granularités possibles selon la période choisie : le mois toujours, le trimestre et l'année
// seulement si la période en contient au moins un complet (et en couvre au moins deux).
const parse = (p) => {
  const [y, m] = String(p).split('-').map(Number);
  return { y, m: m || 1 };
};
const idx = (p) => p.y * 12 + (p.m - 1);

export function periodBounds(from, to, meta) {
  return { from: parse(from || meta.firstPeriod || '2015-01'), to: parse(to || meta.lastPeriod || '2015-12') };
}

export function granularities(from, to, meta) {
  const b = periodBounds(from, to, meta);
  const span = idx(b.to) - idx(b.from) + 1;
  // trimestres complets : premier mois de trimestre ≥ début et dernier mois ≤ fin
  const firstQ = Math.ceil(idx(b.from) / 3) * 3;
  const fullQuarters = Math.max(0, Math.floor((idx(b.to) + 1 - firstQ) / 3));
  const firstY = Math.ceil(idx(b.from) / 12) * 12;
  const fullYears = Math.max(0, Math.floor((idx(b.to) + 1 - firstY) / 12));
  const quartersTouched = Math.floor(idx(b.to) / 3) - Math.floor(idx(b.from) / 3) + 1;
  const yearsTouched = b.to.y - b.from.y + 1;
  const opts = [
    { id: 'month', label: 'Mois', enabled: true, count: span },
    {
      id: 'quarter', label: 'Trimestre', enabled: fullQuarters >= 1 && quartersTouched >= 2, count: quartersTouched,
      reason: 'La période doit couvrir au moins deux trimestres, dont un complet',
    },
    {
      id: 'year', label: 'Année', enabled: fullYears >= 1 && yearsTouched >= 2, count: yearsTouched,
      reason: 'La période doit couvrir au moins deux années, dont une complète',
    },
  ];
  return { span, opts };
}

/** Granularité la plus lisible : mois jusqu'à 2 ans, trimestre jusqu'à 6 ans, année au-delà. */
export function bestGranularity(from, to, meta) {
  const { span, opts } = granularities(from, to, meta);
  const ok = (id) => opts.find((o) => o.id === id).enabled;
  if (span <= 24) return 'month';
  if (span <= 72 && ok('quarter')) return 'quarter';
  if (ok('year')) return 'year';
  return ok('quarter') ? 'quarter' : 'month';
}

export const GRANULARITY_WORD = { month: 'mensuelle', quarter: 'trimestrielle', year: 'annuelle' };
