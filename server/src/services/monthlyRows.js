// Lignes détaillées au mois : une ligne = un flux (déclarant, partenaire, code NC, sens) pour un
// mois donné, la déclaration la plus récente d'abord.
import mongoose from 'mongoose';
import { periodKey } from './filters.js';
import { LATEST, LATEST_ROWS, latestInfo } from './cubes.js';

const MAX_WINDOW_UNFILTERED = 3; // mois parcourus au plus sans filtre de produit ou de pays

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
  const narrowed = Boolean(f.product || f.reporters || f.partners);
  const to = f.to && periodKey(f.to) < periodKey(range.last) ? f.to : range.last;
  // Sans début demandé : tout l'historique si la recherche est ciblée, sinon le dernier mois
  let from = f.from ? (periodKey(f.from) > periodKey(range.first) ? f.from : range.first) : (narrowed ? range.first : to);
  if (periodKey(from) > periodKey(to)) return null;
  let clamped = false;
  if (!narrowed && monthsBetween(from, to) > MAX_WINDOW_UNFILTERED) { from = shift(to, -(MAX_WINDOW_UNFILTERED - 1)); clamped = true; }
  return { from, to, clamped, narrowed };
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

/** Page de lignes mensuelles. */
export async function monthlyPage({ f, scope, window, sort = 'recent', order = 'desc', skip = 0, limit = 50, cap = 100000 }) {
  const dir = order === 'asc' ? 1 : -1;
  const sortSpec = (SORTS[sort] || SORTS.recent)(dir);
  // Dernier mois sans filtre : table préparée à l'avance (instantané)
  const latest = await latestInfo();
  const onlyLatest = latest && !window.narrowed && !f.sections && !f.chapters && periodKey(window.from) === periodKey(window.to)
    && `${window.to.y}-${String(window.to.m).padStart(2, '0')}` === latest.period && ['recent', 'value'].includes(sort) && dir === -1 && skip + limit <= LATEST_ROWS;
  if (onlyLatest) {
    const q = f.flow ? { flow: f.flow } : {};
    const rows = await mongoose.connection.collection(LATEST).aggregate([
      { $match: q }, { $sort: { valueEur: -1, product: 1, reporter: 1, partner: 1, flow: 1 } }, { $skip: skip }, { $limit: limit },
      { $set: { unitPrice: { $cond: [{ $gt: ['$quantityKg', 0] }, { $divide: ['$valueEur', '$quantityKg'] }, null] }, share: 1 } }, ...labels, { $project: { _id: 0 } },
    ]).toArray();
    const total = f.flow ? latest.byFlow?.[f.flow] || 0 : latest.count;
    return { rows, total: Math.min(total, cap), capped: total > cap, source: 'latest' };
  }
  const base = monthlyPipeline(scope, window);
  const [count, rows] = await Promise.all([
    scope.Model.aggregate([...base, { $limit: cap + 1 }, { $count: 'n' }]).allowDiskUse(true).then((r) => r[0]?.n ?? 0),
    scope.Model.aggregate([...base, { $sort: sortSpec }, { $skip: skip }, { $limit: limit }, ...labels]).allowDiskUse(true),
  ]);
  return { rows, total: Math.min(count, cap), capped: count > cap, source: 'detail' };
}
