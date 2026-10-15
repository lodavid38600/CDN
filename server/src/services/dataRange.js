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
    // Premier et dernier mois réellement renseignés (une base qui commence en juin ne commence pas
    // en janvier). Recherches qui s'arrêtent à la première ligne trouvée : rapides sur des millions de lignes.
    const hasMonth = (year, i) => Model.exists({ year, [`months.${i}`]: { $gt: 0 } });
    let firstM = 1;
    for (let i = 0; i < 12; i++) if (await hasMonth(minDoc.year, i)) { firstM = i + 1; break; }
    let lastM = 12;
    for (let i = 11; i >= 0; i--) if (await hasMonth(maxDoc.year, i)) { lastM = i + 1; break; }
    range = { first: { y: minDoc.year, m: firstM }, last: { y: maxDoc.year, m: lastM } };
  }
  cache.set(Model.modelName, { version, range });
  return range;
}
