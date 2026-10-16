import { TradeFlow } from '../models/TradeFlow.js';
import { getDataVersion } from './dataVersion.js';
import { Meta } from '../models/System.js';
import { cubeModel, cubesUsable, cubeBuiltVersion } from './cubes.js';

// Première et dernière période (mois) disponibles par collection, recalculées à chaque
// nouvelle version des données.
const cache = new Map();

export function invalidateDataRange() {
  cache.clear();
}

const key = (p) => p.y * 100 + p.m;

/** Premier et dernier mois renseignés parmi les lignes de `Model` qui vérifient `filter`. */
async function scanRange(Model, filter = {}) {
  let bounds;
  if (!Object.keys(filter).length) {
    // Sans filtre : premières / dernières années lues dans l'index des années
    const [lo] = await Model.find({}, { year: 1 }).sort({ year: 1 }).limit(1).lean();
    const [hi] = await Model.find({}, { year: 1 }).sort({ year: -1 }).limit(1).lean();
    bounds = lo && { min: lo.year, max: hi.year };
  } else {
    [bounds] = await Model.aggregate([{ $match: filter }, { $group: { _id: null, min: { $min: '$year' }, max: { $max: '$year' } } }]);
  }
  if (!bounds) return { first: null, last: null };
  // Recherches qui s'arrêtent à la première ligne trouvée. Un mois vide oblige à relire toute
  // l'année : on avance depuis janvier et on s'arrête au premier mois vide (une seule relecture).
  const hasMonth = (year, i) => Model.exists({ ...filter, year, [`months.${i}`]: { $gt: 0 } });
  let firstM = 1;
  for (let i = 0; i < 12; i++) if (await hasMonth(bounds.min, i)) { firstM = i + 1; break; }
  let lastM = bounds.max === bounds.min ? firstM : 1;
  for (let i = lastM; i < 12; i++) { if (!(await hasMonth(bounds.max, i))) break; lastM = i + 1; }
  return { first: { y: bounds.min, m: firstM }, last: { y: bounds.max, m: lastM } };
}

const pending = new Map();

export async function getDataRange(Model = TradeFlow) {
  const { version } = await getDataVersion();
  const pk = `${Model.modelName}:${version}`;
  // Plusieurs pages ouvertes en même temps : un seul calcul
  if (pending.has(pk)) return pending.get(pk);
  const p = computeRange(Model, version).finally(() => pending.delete(pk));
  pending.set(pk, p);
  return p;
}

async function computeRange(Model, version) {
  const world = Model.modelName === 'WorldFlow';
  // Lignes UE : la table de synthèse par chapitre (quelques centaines de lignes) suffit
  const useCube = !world && (await cubesUsable());
  const k = `${Model.modelName}${useCube ? `:cube${await cubeBuiltVersion()}` : ''}`;
  const hit = cache.get(k);
  if (hit && hit.version === version) return hit.range;
  let range;
  if (world) {
    // Jeu mondial : la partie UE a la période des données UE ; les miroirs en dérivent ;
    // seules les autres sources (nationales, ONU) sont à examiner — jamais les millions de lignes.
    const [eu, others] = await Promise.all([getDataRange(TradeFlow), scanRange(Model, { source: { $nin: ['eurostat', 'mirror'] } })]);
    const firsts = [eu.first, others.first].filter(Boolean);
    const lasts = [eu.last, others.last].filter(Boolean);
    range = {
      first: firsts.length ? firsts.reduce((a, b) => (key(a) <= key(b) ? a : b)) : null,
      last: lasts.length ? lasts.reduce((a, b) => (key(a) >= key(b) ? a : b)) : null,
    };
  } else if (useCube) {
    range = await scanRange(cubeModel('chapter'));
  } else {
    // Sans tables (première installation) : résultat gardé en base, pas recalculé à chaque démarrage
    const saved = await Meta.findOne({ key: `periode:${Model.modelName}` }).lean();
    if (saved?.version === version && saved.info?.range) range = saved.info.range;
    else {
      range = await scanRange(Model);
      await Meta.updateOne({ key: `periode:${Model.modelName}` }, { $set: { version, info: { range } } }, { upsert: true });
    }
  }
  cache.set(k, { version, range });
  return range;
}

/** Valeur en mémoire si elle est à jour ; sinon lance le calcul en arrière-plan et renvoie null. */
export async function peekDataRange(Model) {
  const { version } = await getDataVersion();
  const hit = cache.get(Model.modelName);
  if (hit && hit.version === version) return hit.range;
  getDataRange(Model).catch(() => {});
  return null;
}
