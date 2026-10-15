import { TradeFlow } from '../models/TradeFlow.js';
import { getDataVersion } from './dataVersion.js';

// Première et dernière période (mois) disponibles par collection, recalculées à chaque
// nouvelle version des données.
const cache = new Map();

export function invalidateDataRange() {
  cache.clear();
}

export async function getDataRange(Model = TradeFlow) {
  const { version } = await getDataVersion();
  const hit = cache.get(Model.modelName);
  if (hit && hit.version === version) return hit.range;
  const [minDoc] = await Model.find({}, { year: 1 }).sort({ year: 1 }).limit(1).lean();
  const [maxDoc] = await Model.find({}, { year: 1 }).sort({ year: -1 }).limit(1).lean();
  let range = { first: null, last: null };
  if (minDoc) {
    const [lastYear] = await Model.aggregate([
      { $match: { year: maxDoc.year, months: { $type: 'array' } } },
      { $project: { idx: { $range: [0, 12] }, months: 1 } },
      { $unwind: { path: '$idx' } },
      { $match: { $expr: { $gt: [{ $arrayElemAt: ['$months', '$idx'] }, 0] } } },
      { $group: { _id: null, lastIdx: { $max: '$idx' } } },
    ]);
    range = { first: { y: minDoc.year, m: 1 }, last: { y: maxDoc.year, m: lastYear ? lastYear.lastIdx + 1 : 12 } };
  }
  cache.set(Model.modelName, { version, range });
  return range;
}
