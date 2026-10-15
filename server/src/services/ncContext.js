import { NcLink } from '../models/NcLink.js';
import { Product } from '../models/Product.js';
import { NcGraph } from './ncGraph.js';
import { getDataVersion } from './dataVersion.js';

// Graphe de la nomenclature en mémoire, rechargé quand la version des données change.
const cache = new Map(); // level -> { version, graph, obsolete }

export async function getNcGraph(level = 8) {
  const { version } = await getDataVersion();
  const hit = cache.get(level);
  if (hit && hit.version === version) return hit.graph;
  const links = await NcLink.find({ level }).lean();
  let current;
  if (level === 8) {
    const notCurrent = await Product.find({ status: { $in: ['obsolete', 'discontinued'] } }, { code: 1 }).lean();
    const set = new Set(notCurrent.map((p) => p.code));
    current = (c) => !set.has(c);
  } else {
    // SH6 : un code est remplacé s'il n'apparaît plus comme destination finale
    const froms = new Set(links.filter((l) => l.from !== l.to).map((l) => l.from));
    const tos = new Set(links.map((l) => l.to));
    current = (c) => !froms.has(c) || tos.has(c);
  }
  const graph = new NcGraph(links, { isCurrent: current });
  cache.set(level, { version, graph });
  return graph;
}

export function clearNcCache() {
  cache.clear();
}
