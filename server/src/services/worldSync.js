// Construction du jeu de données mondial (SH6) :
//  1. les données Eurostat (NC8) sont agrégées en SH6 pour les 27 pays de l'UE ;
//  2. les pays qui ne publient pas de données sont reconstitués « en miroir » à partir des
//     déclarations de leurs partenaires (exportations de X vers Y = importations de Y depuis X) ;
//  3. la nomenclature SH6 est harmonisée (changements de version du Système harmonisé).
// Tout est calculé dans la base (agrégations $merge), sans transférer les données.
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

export async function aggregateEuIntoWorld() {
  const stamp = new Date();
  const acc = {};
  for (let i = 0; i < 12; i++) {
    acc[`v${i}`] = { $sum: { $ifNull: [{ $arrayElemAt: ['$months', i] }, 0] } };
    acc[`q${i}`] = { $sum: { $ifNull: [{ $arrayElemAt: ['$monthsKg', i] }, 0] } };
  }
  await TradeFlow.aggregate([
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
    {
      $merge: {
        into: WorldFlow.collection.name,
        on: ['reporter', 'partner', 'product', 'year', 'flow'],
        // Une source nationale de priorité supérieure n'est jamais écrasée
        whenMatched: [{ $replaceWith: { $cond: [{ $gt: ['$priority', 3] }, '$$ROOT', { $mergeObjects: ['$$new', { _id: '$_id' }] }] } }],
        whenNotMatched: 'insert',
      },
    },
  ]).allowDiskUse(true);
  // Lignes Eurostat disparues de la source (révisions) : supprimées
  const stale = await WorldFlow.deleteMany({ source: 'eurostat', $or: [{ syncedAt: { $lt: stamp } }, { syncedAt: { $exists: false } }] });
  return { stale: stale.deletedCount };
}

export async function rebuildMirror() {
  await WorldFlow.deleteMany({ mirror: true });
  const direct = await WorldFlow.distinct('reporter', { mirror: { $ne: true } });
  await WorldFlow.aggregate([
    { $match: { mirror: { $ne: true }, partner: { $nin: direct } } },
    {
      $project: {
        _id: 0, reporter: '$partner', partner: '$reporter', product: 1, hs6: 1, chapter: 1, section: 1, year: 1,
        flow: { $cond: [{ $eq: ['$flow', 'import'] }, 'export', 'import'] },
        valueEur: 1, quantityKg: 1, months: 1, monthsKg: 1, tc: 1, h: 1,
        currency: 'EUR', source: 'mirror', priority: { $literal: 1 }, mirror: { $literal: true },
      },
    },
    { $merge: { into: WorldFlow.collection.name, on: ['reporter', 'partner', 'product', 'year', 'flow'], whenMatched: 'keepExisting', whenNotMatched: 'insert' } },
  ]).allowDiskUse(true);
  const mirrored = await WorldFlow.distinct('reporter', { mirror: true });
  return { directReporters: direct.length, mirroredCountries: mirrored.filter((c) => !direct.includes(c)) };
}

export async function syncWorld() {
  const eu = await aggregateEuIntoWorld();
  const mirror = await rebuildMirror();
  const nc = await syncNomenclature({ level: 6 });
  return { eu, mirror, nc };
}
