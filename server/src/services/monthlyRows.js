// Lignes détaillées au mois : une ligne = un flux (déclarant, partenaire, code NC, sens) pour un
// mois donné, la déclaration la plus récente d'abord.
import mongoose from 'mongoose';
import { periodKey } from './filters.js';
import { LATEST, latestInfo, recentKey } from './cubes.js';

// Fenêtre parcourue : avec un produit, tout l'historique ; avec seulement des pays, 3 derniers mois
// par défaut et 12 au plus ; sans filtre, le dernier mois par défaut et 3 au plus.
const WINDOW = { product: { def: Infinity, max: Infinity }, country: { def: 3, max: 12 }, none: { def: 1, max: 3 } };

const SORTS = {
  recent: (dir) => ({ period: dir, valueEur: -1, product: 1, reporter: 1, partner: 1, flow: 1 }),
  value: (dir) => ({ valueEur: dir, period: -1, product: 1, reporter: 1, partner: 1, flow: 1 }),
  quantity: (dir) => ({ quantityKg: dir, period: -1, product: 1, reporter: 1, partner: 1, flow: 1 }),
  price: (dir) => ({ unitPrice: dir, period: -1, product: 1, reporter: 1, partner: 1, flow: 1 }),
};

const monthsBetween = (a, b) => (b.y - a.y) * 12 + b.m - a.m + 1;
const shift = (p, n) => { const t = p.y * 12 + p.m - 1 + n; return { y: Math.floor(t / 12), m: (t % 12) + 1 }; };

/** Fenêtre de mois parcourue (bornée sans filtre pour garder des réponses rapides). */
export function monthWindow(f, range) {
  if (!range.last) return null;
  const kind = f.product ? 'product' : f.reporters || f.partners ? 'country' : 'none';
  const { def, max } = WINDOW[kind];
  const to = f.to && periodKey(f.to) < periodKey(range.last) ? f.to : range.last;
  const first = (p) => (periodKey(p) > periodKey(range.first) ? p : range.first);
  let from = f.from ? first(f.from) : (def === Infinity ? range.first : first(shift(to, -(def - 1))));
  if (periodKey(from) > periodKey(to)) return null;
  let clamped = false;
  if (monthsBetween(from, to) > max) { from = shift(to, -(max - 1)); clamped = true; }
  return { from, to, clamped, narrowed: kind !== 'none', kind };
}

/**
 * @param scope   périmètre (buildScope avec noPeriodSlice)
 * @param window  { from, to } mois inclus
 */
export function monthlyPipeline(scope, window) {
  const fromK = periodKey(window.from);
  const toK = periodKey(window.to);
  const match = { ...scope.match };
  match.year = { ...(typeof match.year === 'object' ? match.year : {}), $gte: window.from.y, $lte: window.to.y };
  // Une seule année : on ne garde que les lignes ayant au moins un mois renseigné dans la fenêtre
  if (window.from.y === window.to.y) {
    const months = [];
    for (let i = window.from.m - 1; i <= window.to.m - 1; i++) months.push({ [`months.${i}`]: { $gt: 0 } }, { [`monthsKg.${i}`]: { $gt: 0 } });
    match.$and = [...(match.$and || []), { $or: months }];
  }
  const at = (field, i) => ({ $ifNull: [{ $arrayElemAt: [field, i] }, 0] });
  return [
    { $match: match },
    ...scope.pre,
    {
      $project: {
        reporter: 1, partner: 1, product: 1, flow: 1, year: 1, tc: 1, share: { $ifNull: ['$_fv', 1] },
        e: {
          $filter: {
            input: { $map: { input: { $range: [0, 12] }, as: 'i', in: { i: '$$i', v: at('$months', '$$i'), q: at('$monthsKg', '$$i'), k: { $add: [{ $multiply: ['$year', 100] }, '$$i', 1] } } } },
            cond: { $and: [{ $gte: ['$$this.k', fromK] }, { $lte: ['$$this.k', toK] }, { $gt: [{ $add: ['$$this.v', '$$this.q'] }, 0] }] },
          },
        },
      },
    },
    { $unwind: '$e' },
    {
      $project: {
        _id: 0, reporter: 1, partner: 1, product: 1, flow: 1, year: 1, tc: 1, share: 1,
        month: { $add: ['$e.i', 1] }, period: '$e.k', valueEur: '$e.v', quantityKg: '$e.q',
        unitPrice: { $cond: [{ $gt: ['$e.q', 0] }, { $divide: ['$e.v', '$e.q'] }, null] },
      },
    },
  ];
}

const labels = [
  { $lookup: { from: 'products', localField: 'product', foreignField: 'code', as: 'p', pipeline: [{ $project: { _id: 0, description: 1 } }] } },
  { $set: { description: { $ifNull: [{ $first: '$p.description' }, ''] }, valueEur: { $round: ['$valueEur', 0] }, quantityKg: { $round: ['$quantityKg', 0] }, unitPrice: { $round: ['$unitPrice', 4] } } },
  { $project: { p: 0 } },
];

const ym = (p) => p.y * 100 + p.m;

/**
 * La page demandée peut-elle être lue dans la table des déclarations récentes ? Celle-ci garde,
 * pour chaque mois et chaque sens, les N déclarations les plus importantes (au global, par pays
 * de l'UE, par partenaire) et leur nombre exact : on vérifie que la page tombe dans cette partie.
 */
function recentPlan(info, f, window, sort, dir, skip, limit) {
  if (!info?.counts || dir !== -1 || !['recent', 'value'].includes(sort)) return null;
  if (f.product || f.chapters || f.sections || f.hs6 || f.sources) return null;
  const r = f.reporters || [];
  const p = f.partners || [];
  let g = 'all';
  let c = null;
  if (r.length === 1 && !p.length) { g = 'reporter'; [c] = r; } else if (p.length === 1 && !r.length) { g = 'partner'; [c] = p; } else if (r.length || p.length) return null;
  const periods = [];
  for (let k = window.to; ym(k) >= ym(window.from); k = shift(k, -1)) periods.push(ym(k));
  const covered = new Set(info.periods.map((x) => Number(x.replace('-', ''))));
  if (!periods.every((k) => covered.has(k))) return null;
  const n = info.top?.[g];
  if (!n) return null; // groupe absent de la table (format précédent)
  const flows = f.flow ? [f.flow] : ['import', 'export'];
  let total = 0;
  let available = 0; // nombre de premières lignes exactes dans l'ordre demandé
  let open = true;
  for (const k of periods) {
    const counts = flows.map((fl) => info.counts[recentKey(k, fl, g, c)] || 0);
    const sum = counts.reduce((a, b) => a + b, 0);
    total += sum;
    if (sort === 'recent' && open) {
      if (counts.every((x) => x <= n)) available += sum;
      else { available += n; open = false; }
    }
  }
  if (sort === 'value') available = periods.every((k) => flows.every((fl) => (info.counts[recentKey(k, fl, g, c)] || 0) <= n)) ? total : n;
  if (available < total && skip + limit > available) return null;
  const match = { period: { $gte: ym(window.from), $lte: ym(window.to) } };
  if (f.flow) match.flow = f.flow;
  if (g !== 'all') match[g] = c;
  return { match, total };
}

/** Page de lignes mensuelles. */
export async function monthlyPage({ f, scope, window, sort = 'recent', order = 'desc', skip = 0, limit = 50, cap = 100000 }) {
  const dir = order === 'asc' ? 1 : -1;
  const sortSpec = (SORTS[sort] || SORTS.recent)(dir);
  // Mois récents : table préparée à l'avance (instantané)
  const plan = recentPlan(await latestInfo(), f, window, sort, dir, skip, limit);
  if (plan) {
    const rows = await mongoose.connection.collection(LATEST).aggregate([
      { $match: plan.match }, { $sort: sortSpec }, { $skip: skip }, { $limit: limit },
      { $set: { unitPrice: { $cond: [{ $gt: ['$quantityKg', 0] }, { $divide: ['$valueEur', '$quantityKg'] }, null] }, share: 1 } }, ...labels, { $project: { _id: 0 } },
    ]).toArray();
    return { rows, total: cap ? Math.min(plan.total, cap) : plan.total, capped: Boolean(cap) && plan.total > cap, source: 'latest' };
  }
  const base = monthlyPipeline(scope, window);
  const [count, rows] = await Promise.all([
    cap ? scope.Model.aggregate([...base, { $limit: cap + 1 }, { $count: 'n' }]).allowDiskUse(true).then((r) => r[0]?.n ?? 0) : 0,
    scope.Model.aggregate([...base, { $sort: sortSpec }, { $skip: skip }, { $limit: limit }, ...labels]).allowDiskUse(true),
  ]);
  return { rows, total: Math.min(count, cap || Infinity), capped: Boolean(cap) && count > cap, source: 'detail' };
}
