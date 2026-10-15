// Graphiques du tableau de bord : période, chargement des données, spec du graphique, description.
import { api } from '../api.js';
import { ncCode, rangeLabel, MEASURE_LABEL } from '../format.js';
import { trendSpec, rankSpec } from './specs.js';

export const WIDGET_TYPES = {
  trend: { label: 'Évolution dans le temps', hint: 'Importations et exportations, mois par mois, par trimestre ou par année' },
  rank: { label: 'Classement', hint: 'Les principaux pays partenaires, pays de l\'UE, produits ou chapitres' },
  kpi: { label: 'Chiffres clés', hint: 'Valeur, volume et prix moyen, avec la variation sur un an' },
};
export const DIMENSION_LABEL = { partner: 'Pays hors UE', reporter: 'Pays de l\'UE', product: 'Produits (NC8)', chapter: 'Chapitres' };
export const WINDOW_LABEL = { 0: 'Tout l\'historique', 3: '3 derniers mois', 6: '6 derniers mois', 12: '12 derniers mois', 24: '24 derniers mois', 36: '3 dernières années', 60: '5 dernières années' };
const GRANULARITY_LABEL = { month: 'par mois', quarter: 'par trimestre', year: 'par année' };

const shift = (p, n) => {
  const [y, m] = p.split('-').map(Number);
  const t = y * 12 + m - 1 + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};

/** Période effective : glissante (se met à jour avec les nouvelles données) ou figée. */
export function widgetPeriod(w, lastPeriod) {
  if (w.mode === 'fixed') return { from: w.from, to: w.to };
  if (!w.months || !lastPeriod) return { from: '', to: '' };
  return { from: shift(lastPeriod, -(w.months - 1)), to: lastPeriod };
}

/** Données d'un graphique (mêmes requêtes que les pages d'analyse). */
export async function fetchWidgetData(w, period) {
  const p = w.params;
  const base = { product: p.product, reporters: p.reporters, partners: p.partners, periodFrom: period.from, periodTo: period.to };
  if (w.type === 'trend') return { rows: await api('/stats/timeseries', { params: { ...base, granularity: p.granularity } }) };
  if (w.type === 'rank') {
    const sort = { quantity: 'quantity', price: 'price' }[p.measure] || 'value';
    return { rows: await api('/stats/top', { params: { ...base, dimension: p.dimension, limit: p.limit, flow: p.flow, sort } }) };
  }
  return { summary: await api('/stats/summary', { params: { ...base, counts: 0 } }) };
}

const countryList = (codes, name) => (codes.length > 3 ? `${codes.slice(0, 3).map(name).join(', ')} +${codes.length - 3}` : codes.map(name).join(', '));

/** Résumé lisible des filtres : « NC 2204 10 11 · France → Chine · exportations · valeur ». */
export function describeFilters(w, countryName = (c) => c) {
  const p = w.params;
  const parts = [p.product ? `NC ${ncCode(p.product)}` : 'Tous produits'];
  if (p.reporters.length) parts.push(countryList(p.reporters, countryName));
  if (p.partners.length) parts.push(`avec ${countryList(p.partners, countryName)}`);
  if (p.flow) parts.push(p.flow === 'export' ? 'Exportations de l\'UE' : 'Importations de l\'UE');
  parts.push(MEASURE_LABEL[p.measure]);
  if (w.type === 'trend') parts.push(GRANULARITY_LABEL[p.granularity]);
  return parts.join(' · ');
}

export function periodText(w, period) {
  if (w.mode === 'fixed') return rangeLabel(w.from, w.to);
  return `${WINDOW_LABEL[w.months] || ''}${period.from ? ` (${rangeLabel(period.from, period.to)})` : ''}`;
}

/** Spec du graphique (évolution ou classement). */
export function widgetSpec(w, data) {
  const p = w.params;
  if (w.type === 'trend') return trendSpec({ rows: data.rows || [], measure: p.measure, flow: p.flow, title: w.title, kind: p.granularity === 'year' ? 'bar' : 'line' });
  if (w.type === 'rank') {
    const labelFn = p.dimension === 'product' ? (r) => `${ncCode(r.key)} ${r.label || ''}` : p.dimension === 'chapter' ? (r) => `${r.key} ${r.label || ''}` : (r) => r.label || r.key;
    return rankSpec({ rows: data.rows || [], measure: p.measure, flow: p.flow, title: w.title, labelFn });
  }
  return null;
}

/** Titre proposé à partir des filtres. */
export function suggestTitle(w, countryName = (c) => c) {
  const p = w.params;
  const what = p.product ? `NC ${ncCode(p.product)}` : p.reporters.length || p.partners.length ? countryList([...p.reporters, ...p.partners], countryName) : 'Commerce extra-UE';
  if (w.type === 'rank') return `${DIMENSION_LABEL[p.dimension]} — ${what}`;
  if (w.type === 'kpi') return `Chiffres clés — ${what}`;
  return `Évolution — ${what}`;
}

export const emptyWidget = () => ({
  type: 'trend', title: '', size: 'half', mode: 'live', months: 24, from: '', to: '',
  params: { product: '', reporters: [], partners: [], flow: '', measure: 'value', granularity: 'month', dimension: 'partner', limit: 10 },
});
