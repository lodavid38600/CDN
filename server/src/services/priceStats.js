// Statistiques de prix unitaires (€/kg) à partir d'observations { v: valeur €, q: quantité kg }.
// Les quantiles sont pondérés par les volumes : le prix médian est celui auquel s'échange
// la moitié des tonnes. Les valeurs aberrantes (hors [Q1 − 3·EI ; Q3 + 3·EI] en échelle
// logarithmique) sont écartées des minimums / maximums et des quantiles, mais comptées.

/** Quantile pondéré d'une liste triée de { p, w }. */
export function weightedQuantile(sorted, q) {
  const total = sorted.reduce((s, o) => s + o.w, 0);
  if (!total) return null;
  const target = q * total;
  let acc = 0;
  for (let i = 0; i < sorted.length; i++) {
    acc += sorted[i].w;
    if (acc >= target - 1e-9) {
      // Interpolation au milieu d'un palier exact (médiane de deux valeurs de poids égal)
      if (Math.abs(acc - target) < 1e-9 && i + 1 < sorted.length) return (sorted[i].p + sorted[i + 1].p) / 2;
      return sorted[i].p;
    }
  }
  return sorted.at(-1).p;
}

function plainQuantile(values, q) {
  if (!values.length) return null;
  const pos = (values.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return values[lo] + (values[hi] - values[lo]) * (pos - lo);
}

/**
 * @param {{ v: number, q: number }[]} obs
 * @returns statistiques ou null s'il n'y a aucune observation exploitable
 */
export function describePrices(obs) {
  const usable = obs.filter((o) => Number.isFinite(o.v) && Number.isFinite(o.q) && o.v > 0 && o.q > 0);
  if (!usable.length) return null;
  const pts = usable.map((o) => ({ p: o.v / o.q, w: o.q, v: o.v })).sort((a, b) => a.p - b.p);

  // Bornes en échelle logarithmique (les prix sont asymétriques)
  const logs = pts.map((x) => Math.log(x.p));
  const l1 = plainQuantile(logs, 0.25);
  const l3 = plainQuantile(logs, 0.75);
  const iqr = l3 - l1;
  const lo = pts.length >= 8 ? Math.exp(l1 - 3 * iqr) : 0;
  const hi = pts.length >= 8 ? Math.exp(l3 + 3 * iqr) : Infinity;
  const kept = pts.filter((x) => x.p >= lo && x.p <= hi);

  const sumV = pts.reduce((s, x) => s + x.v, 0);
  const sumQ = pts.reduce((s, x) => s + x.w, 0);
  const round = (x) => (x === null ? null : Math.round(x * 10000) / 10000);
  const median = weightedQuantile(kept, 0.5);
  const p25 = weightedQuantile(kept, 0.25);
  const p75 = weightedQuantile(kept, 0.75);
  return {
    mean: round(sumV / sumQ), // prix moyen = valeur totale / quantité totale
    median: round(median),
    p10: round(weightedQuantile(kept, 0.1)),
    p25: round(p25),
    p75: round(p75),
    p90: round(weightedQuantile(kept, 0.9)),
    min: round(kept[0].p),
    max: round(kept.at(-1).p),
    spread: median ? round((p75 - p25) / median) : null, // dispersion relative
    valueEur: Math.round(sumV),
    quantityKg: Math.round(sumQ),
    observations: pts.length,
    outliers: pts.length - kept.length,
  };
}
