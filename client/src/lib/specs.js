// Fabriques de specs de graphiques à partir des réponses de l'API.
import { MONTHS_SHORT, periodLabel } from '../format.js';

export const mKey = (measure) => ({ quantity: 'Kg', price: 'Price' })[measure] || 'Eur';
export const unitOf = (measure) => ({ quantity: 'kg', price: 'eurkg' })[measure] || 'eur';

/** Libellé d'axe : « mars 2018 » abrégé pour les mois, « 2023 (6 mois) » pour une année partielle. */
export function axisLabel(row) {
  if (row.month) return periodLabel(row.period, true);
  if (row.quarter) return `T${row.quarter} ${row.year}${row.months < 3 ? ` (${row.months} m.)` : ''}`;
  return row.months && row.months < 12 ? `${row.year} (${row.months} m.)` : String(row.year ?? row.period);
}

/**
 * Évolution import / export, avec prévision facultative (pointillés + intervalle à 95 %).
 * @param rows timeseries ; fc réponse /stats/forecast (même granularité et mesure)
 */
export function trendSpec({ rows: allRows, fc, measure = 'value', kind = 'line', flow = '', title, subtitle }) {
  const k = mKey(measure);
  // La prévision annuelle part de la dernière année complète : l'année partielle est retirée.
  const full = { year: 12, quarter: 3 }[fc?.granularity];
  const rows = full ? allRows.filter((r) => !r.months || r.months === full) : allRows;
  // Une prévision n'a de sens que si la série va jusqu'à la dernière donnée disponible.
  if (fc && rows.length && fc.history.length && rows.at(-1).period !== fc.history.at(-1).period) fc = null;
  const n = rows.length;
  const extra = fc?.forecast || [];
  const fcLabel = (p) => (p.length === 4 ? `${p} (prév.)` : p.includes('-T') ? `T${p.slice(-1)} ${p.slice(0, 4)} (prév.)` : periodLabel(p, true));
  const labels = [...rows.map(axisLabel), ...extra.map((f) => fcLabel(f.period))];
  const pad = (arr, len) => [...arr, ...Array(len).fill(null)];
  const series = [];
  for (const f of ['import', 'export']) {
    if (flow && flow !== f) continue;
    const name = f === 'import' ? 'Importations' : 'Exportations';
    series.push({ name, color: f, values: pad(rows.map((r) => r[`${f}${k}`]), extra.length) });
    if (extra.length && kind === 'line') {
      const last = rows.at(-1)?.[`${f}${k}`] ?? null;
      series.push({
        name: `${name} — prévision`, color: f, dashed: true,
        values: [...Array(n - 1).fill(null), last, ...extra.map((x) => x[f])],
        band: { low: [...Array(n - 1).fill(null), last, ...extra.map((x) => x[`${f}Low`])], high: [...Array(n - 1).fill(null), last, ...extra.map((x) => x[`${f}High`])] },
      });
    }
  }
  return {
    kind, title, subtitle, labels, unit: unitOf(measure), series,
    note: extra.length ? `Prévision ${fc.method}, intervalle de confiance à 95 %. Indicative : ne tient pas compte des chocs à venir.` : undefined,
  };
}

/** Profil saisonnier : moyenne par mois calendaire sur les années complètes. */
export function seasonalitySpec({ rows, measure = 'value', title, subtitle }) {
  const k = mKey(measure);
  const acc = { import: Array(12).fill(0), export: Array(12).fill(0), n: Array(12).fill(0) };
  for (const r of rows) {
    if (!r.month) continue;
    acc.import[r.month - 1] += r[`import${k}`];
    acc.export[r.month - 1] += r[`export${k}`];
    acc.n[r.month - 1] += 1;
  }
  const avg = (arr) => arr.map((v, i) => (acc.n[i] ? v / acc.n[i] : 0));
  return {
    kind: 'bar', title, subtitle, labels: MONTHS_SHORT, unit: unitOf(measure),
    series: [
      { name: 'Importations (moyenne)', color: 'import', values: avg(acc.import) },
      { name: 'Exportations (moyenne)', color: 'export', values: avg(acc.export) },
    ],
  };
}

/** Prix moyen au kilo (valeur / quantité). */
export function unitPriceSpec({ rows, title, subtitle }) {
  const p = (v, q) => (q > 0 ? v / q : null);
  return {
    kind: 'line', title, subtitle, labels: rows.map(axisLabel), unit: 'eurkg',
    series: [
      { name: 'Prix import', color: 'import', values: rows.map((r) => p(r.importEur, r.importKg)) },
      { name: 'Prix export', color: 'export', values: rows.map((r) => p(r.exportEur, r.exportKg)) },
    ],
  };
}

/** Barres horizontales import / export par élément (pays, codes NC…). */
export function rankSpec({ rows, measure = 'value', flow = '', title, subtitle, labelFn = (r) => r.label }) {
  const k = mKey(measure);
  const series = [];
  if (!flow || flow === 'import') series.push({ name: 'Importations', color: 'import', values: rows.map((r) => r[`import${k}`]) });
  if (!flow || flow === 'export') series.push({ name: 'Exportations', color: 'export', values: rows.map((r) => r[`export${k}`]) });
  const trunc = (s) => (s.length > 34 ? `${s.slice(0, 33)}…` : s);
  return { kind: 'hbar', title, subtitle, labels: rows.map((r) => trunc(labelFn(r))), keys: rows.map((r) => r.key), unit: unitOf(measure), series };
}

/** Hauteur adaptée à un graphique en barres horizontales. */
export const hbarHeight = (n, series = 2) => Math.max(160, n * (series > 1 ? 34 : 24) + 40);

/** Boîtes à moustaches des prix par pays (réponse de /stats/prices). */
export function priceBoxSpec({ groups, title, subtitle, labelFn = (g) => g.label }) {
  return {
    kind: 'box', title, subtitle, unit: 'eurkg', color: 1,
    labels: groups.map((g) => labelFn(g)),
    keys: groups.map((g) => g.key),
    boxes: groups.map((g) => ({ min: g.min, p25: g.p25, median: g.median, p75: g.p75, max: g.max, mean: g.mean })),
  };
}

/** Nuage volume / prix médian par pays. */
export function priceScatterSpec({ groups, title, subtitle, eu = new Set() }) {
  const maxQ = Math.max(1, ...groups.map((g) => g.quantityKg));
  return {
    kind: 'scatter', title, subtitle, unit: 'eurkg', xUnit: 'kg', xLog: true, yLog: false,
    xLabel: 'Volume échangé', yLabel: 'Prix médian',
    points: groups.map((g) => ({ x: Math.max(1, g.quantityKg), y: g.median, label: g.label, color: eu.has(g.key) ? 1 : 2, r: 4 + 10 * Math.sqrt(g.quantityKg / maxQ) })),
  };
}

/** Évolution du prix médian, de la fourchette P25–P75 et du prix moyen. */
export function priceTrendSpec({ periods, topSeries = {}, labels = {}, title, subtitle }) {
  const lab = periods.map((p) => periodLabel(p.period, true));
  const series = [
    { name: 'Prix médian', color: 1, values: periods.map((p) => p.median), band: { low: periods.map((p) => p.p25), high: periods.map((p) => p.p75) } },
    { name: 'Prix moyen', color: 2, values: periods.map((p) => p.mean), dashed: true },
  ];
  let c = 3;
  for (const [k, vals] of Object.entries(topSeries)) series.push({ name: labels[k] || k, color: c++, values: vals, hidden: true });
  return { kind: 'line', title, subtitle, labels: lab, unit: 'eurkg', series: series.filter((x) => !x.hidden) };
}
