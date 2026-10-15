// Pays présents dans les données (déclarants UE, partenaires, pays du jeu mondial et leurs sources).
// Lus dans les index (jamais en parcourant les millions de lignes) et gardés en mémoire jusqu'à
// la prochaine version des données.
import { TradeFlow } from '../models/TradeFlow.js';
import { WorldFlow } from '../models/WorldFlow.js';
import { getDataVersion } from './dataVersion.js';

let cache = { version: -1, data: null, pending: null };

async function compute() {
  const [reporters, partners, sources] = await Promise.all([
    TradeFlow.distinct('reporter'),
    TradeFlow.distinct('partner'),
    WorldFlow.distinct('source'),
  ]);
  const world = new Map();
  for (const source of sources) {
    for (const code of await WorldFlow.distinct('reporter', { source })) {
      if (!world.has(code)) world.set(code, { code, sources: [], mirrorOnly: true });
      const w = world.get(code);
      w.sources.push(source);
      if (source !== 'mirror') w.mirrorOnly = false;
    }
  }
  return { reporters, partners, world: [...world.values()] };
}

export async function countriesIndex() {
  const { version } = await getDataVersion();
  if (cache.version === version && cache.data) return cache.data;
  if (cache.pending && cache.pendingVersion === version) return cache.pending;
  const pending = compute().then((data) => { cache = { version, data, pending: null }; return data; });
  cache = { ...cache, pending, pendingVersion: version };
  return pending;
}
