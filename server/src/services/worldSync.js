// Construction du jeu de données mondial (SH6) :
//  1. les données Eurostat (NC8) sont agrégées en SH6 pour les 27 pays de l'UE ;
//  2. les pays qui ne publient pas de données sont reconstitués « en miroir » à partir des
//     déclarations de leurs partenaires (exportations de X vers Y = importations de Y depuis X) ;
//  3. la nomenclature SH6 est harmonisée (changements de version du Système harmonisé).
// Tout est calculé dans la base (agrégations $merge), sans transférer les données.
import mongoose from 'mongoose';
import { TradeFlow } from '../models/TradeFlow.js';
import { WorldFlow } from '../models/WorldFlow.js';
import { SECTIONS } from '../data/nomenclature.js';
import { syncNomenclature } from './ncSync.js';

const sectionExpr = {
  $switch: {
    branches: SECTIONS.map((s) => ({
      case: { $and: [{ $gte: [{ $toInt: '$_id.ch' }, s.chapters[0]] }, { $lte: [{ $toInt: '$_id.ch' }, s.chapters[1]] }] },
      then: s.code,
    })),
    default: 'XXI',
  },
};

// Pipeline : lignes UE (NC8) → SH6, au format du jeu mondial.
function euPipeline(stamp) {
  const acc = {};
  for (let i = 0; i < 12; i++) {
    acc[`v${i}`] = { $sum: { $ifNull: [{ $arrayElemAt: ['$months', i] }, 0] } };
    acc[`q${i}`] = { $sum: { $ifNull: [{ $arrayElemAt: ['$monthsKg', i] }, 0] } };
  }
  return [
    { $group: { _id: { r: '$reporter', p: '$partner', h: '$hs6', ch: '$chapter', y: '$year', f: '$flow' }, ...acc } },
    {
      $project: {
        _id: 0, reporter: '$_id.r', partner: '$_id.p', product: '$_id.h', hs6: '$_id.h', chapter: '$_id.ch', section: sectionExpr,
        year: '$_id.y', flow: '$_id.f',
        months: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => `$v${i}`),
        monthsKg: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => `$q${i}`),
        currency: 'EUR', source: 'eurostat', priority: { $literal: 3 }, mirror: { $literal: false }, syncedAt: { $literal: stamp },
      },
    },
    { $addFields: { valueEur: { $sum: '$months' }, quantityKg: { $sum: '$monthsKg' }, tc: ['$product'] } },
  ];
}

const mirrorProjection = {
  _id: 0, reporter: '$partner', partner: '$reporter', product: 1, hs6: 1, chapter: 1, section: 1, year: 1,
  flow: { $cond: [{ $eq: ['$flow', 'import'] }, 'export', 'import'] },
  valueEur: 1, quantityKg: 1, months: 1, monthsKg: 1, tc: 1, h: 1,
  currency: 'EUR', source: 'mirror', priority: { $literal: 1 }, mirror: { $literal: true },
};

/**
 * Reconstruit tout le jeu mondial dans une nouvelle table, en bloc, puis la substitue à
 * l'ancienne d'un coup (les lecteurs voient l'ancienne ou la nouvelle, jamais un état partiel) :
 *   1. lignes UE agrégées en SH6 ;
 *   2. + lignes des autres sources (nationales, ONU) ; pour une même ligne, la source de plus
 *      haute priorité l'emporte ;
 *   3. + pays reconstitués « en miroir » d'après les déclarations de leurs partenaires.
 * Aucune écriture ligne à ligne : quelques minutes au lieu de dizaines sur des millions de lignes.
 */
export async function rebuildWorld({ lap = () => {} } = {}) {
  const db = mongoose.connection;
  const name = WorldFlow.collection.name;
  const T = { eu: `${name}_construction_ue`, direct: `${name}_construction_directes`, next: `${name}_construction` };
  for (const t of Object.values(T)) await db.collection(t).drop().catch(() => {});
  await TradeFlow.aggregate([...euPipeline(new Date()), { $out: T.eu }]).allowDiskUse(true);
  lap('monde : données UE');

  // Autres sources que l'UE et les miroirs : conservées, la plus prioritaire l'emporte
  const others = await WorldFlow.countDocuments({ source: { $nin: ['eurostat', 'mirror'] } });
  if (others) {
    await db.collection(T.eu).aggregate([
      { $unionWith: { coll: name, pipeline: [{ $match: { source: { $nin: ['eurostat', 'mirror'] } } }] } },
      { $group: { _id: { r: '$reporter', p: '$partner', c: '$product', y: '$year', f: '$flow' }, doc: { $top: { sortBy: { priority: -1 }, output: '$$ROOT' } } } },
      { $replaceWith: '$doc' },
      { $project: { _id: 0 } },
      { $out: T.direct },
    ], { allowDiskUse: true }).toArray();
    await db.collection(T.eu).drop();
  } else {
    await db.collection(T.eu).rename(T.direct);
  }
  lap('monde : autres sources');

  // Pays qui ne publient pas : reconstitués d'après les déclarations de leurs partenaires
  const direct = await db.collection(T.direct).distinct('reporter');
  await db.collection(T.direct).aggregate([
    { $project: { _id: 0 } },
    { $unionWith: { coll: T.direct, pipeline: [{ $match: { partner: { $nin: direct } } }, { $project: mirrorProjection }] } },
    { $out: T.next },
  ], { allowDiskUse: true }).toArray();
  lap('monde : pays reconstitués');

  // Mêmes index que la table actuelle, puis substitution
  const next = db.collection(T.next);
  for (const [fields, { background, ...options }] of WorldFlow.schema.indexes()) await next.createIndex(fields, options); // eslint-disable-line no-unused-vars
  await next.rename(name, { dropTarget: true });
  await db.collection(T.direct).drop().catch(() => {});
  lap('monde : index et substitution');
  const mirrored = await WorldFlow.distinct('reporter', { source: 'mirror' });
  return { directReporters: direct.length, mirroredCountries: mirrored.filter((c) => !direct.includes(c)), others };
}

/** Compatibilité : étapes séparées (utilisées par les tests et les mises à jour partielles). */
export async function aggregateEuIntoWorld() {
  return rebuildWorld();
}
export async function rebuildMirror() {
  const r = await rebuildWorld();
  return { directReporters: r.directReporters, mirroredCountries: r.mirroredCountries };
}

export async function syncWorld({ log = () => {} } = {}) {
  let t = Date.now();
  const lap = (m) => { log(`${m} (${Math.round((Date.now() - t) / 1000)} s)`); t = Date.now(); };
  const world = await rebuildWorld({ lap });
  const nc = await syncNomenclature({ level: 6 });
  lap('monde : nomenclature SH6');
  return { mirror: world, nc };
}
