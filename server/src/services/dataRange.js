import { TradeFlow } from '../models/TradeFlow.js';

// Première et dernière période (mois) disponibles en base, mises en cache 60 s.
let cache = null;
let cachedAt = 0;

export function invalidateDataRange() {
  cache = null;
}

export async function getDataRange() {
  if (cache && Date.now() - cachedAt < 60_000) return cache;
  const [minDoc] = await TradeFlow.find({}, { year: 1 }).sort({ year: 1 }).limit(1).lean();
  const [maxDoc] = await TradeFlow.find({}, { year: 1 }).sort({ year: -1 }).limit(1).lean();
  if (!minDoc) return { first: null, last: null };

  const [lastYear] = await TradeFlow.aggregate([
    { $match: { year: maxDoc.year, months: { $type: 'array' } } },
    { $project: { idx: { $range: [0, 12] }, months: 1 } },
    { $unwind: { path: '$idx' } },
    { $match: { $expr: { $gt: [{ $arrayElemAt: ['$months', '$idx'] }, 0] } } },
    { $group: { _id: null, lastIdx: { $max: '$idx' } } },
  ]);
  const lastMonth = lastYear ? lastYear.lastIdx + 1 : 12;
  cache = { first: { y: minDoc.year, m: 1 }, last: { y: maxDoc.year, m: lastMonth } };
  cachedAt = Date.now();
  return cache;
}
