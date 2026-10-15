// Tables de synthèse (« cubes ») pré-calculées à partir des lignes détaillées NC8, pour que les
// vues générales (vue d'ensemble, carte, grille des chapitres, classements de codes) ne parcourent
// plus des millions de lignes à chaque affichage :
//   - par pays : déclarant × partenaire × chapitre × flux × année (sans le détail des codes) ;
//   - par produit : code NC actuel × flux × année (sans le détail des pays).
// Les deux sont exprimées dans la nomenclature actuelle (anciens codes déjà convertis) et gardent
// le détail mensuel. Une table n'est utilisée que si elle correspond à la version des données en
// cours : après un import, tant qu'elle n'est pas reconstruite, on lit les lignes détaillées.
import mongoose from 'mongoose';
import { TradeFlow } from '../models/TradeFlow.js';
import { Meta } from '../models/System.js';
import { SECTIONS } from '../data/nomenclature.js';
import { getDataVersion } from './dataVersion.js';
import { withLock } from './lock.js';

export const CUBES = {
  chapter: { name: 'tradecubes_chapter', fields: new Set(['year', 'flow', 'chapter', 'section']) },
  reporter: { name: 'tradecubes_reporter', fields: new Set(['year', 'flow', 'reporter']) },
  partner: { name: 'tradecubes_partner', fields: new Set(['year', 'flow', 'partner']) },
  product: { name: 'tradecubes_product', fields: new Set(['year', 'flow', 'product', 'hs6', 'chapter', 'section', 'tc']) },
  country: { name: 'tradecubes_country', fields: new Set(['year', 'flow', 'reporter', 'partner', 'chapter', 'section']) },
};
// À incrémenter quand la liste ou la structure des tables change : reconstruction automatique
const SCHEMA = 3; // 3 : table des dernières déclarations

/** Ordre d'essai : de la plus petite table à la plus grande. */
export const CUBE_ORDER = ['chapter', 'reporter', 'partner', 'product', 'country'];

const coll = (cube) => mongoose.connection.collection(CUBES[cube].name);

// Modèles minimaux (lecture seule). strictQuery: false : sans schéma déclaré, Mongoose retirerait
// sinon silencieusement les champs des filtres (ex. « months.11 »).
const models = {};
export function cubeModel(cube) {
  models[cube] ??= mongoose.models[CUBES[cube].name]
    || mongoose.model(CUBES[cube].name, new mongoose.Schema({}, { strict: false, strictQuery: false, collection: CUBES[cube].name, versionKey: false }));
  return models[cube];
}

let state = { version: -1 };
let readAt = 0;

/** Version des données pour laquelle les tables ont été construites (lue au plus toutes les 5 s). */
async function cubeVersion() {
  if (Date.now() - readAt > 5000) {
    const doc = await Meta.findOne({ key: 'cubes' }).lean();
    state = { version: doc?.info?.schema === SCHEMA ? doc.version : -1 };
    readAt = Date.now();
  }
  return state.version;
}

/** Vrai si les tables sont à jour : sinon les requêtes lisent les lignes détaillées. */
export async function cubesReady() {
  if (process.env.STATS_CUBES === 'false') return false; // désactivation (diagnostic)
  const [{ version }, built] = await Promise.all([getDataVersion(), cubeVersion()]);
  return version > 0 && built === version;
}

const ZEROS = Array(12).fill(0);
// Une ligne sans détail mensuel (donnée annuelle) est répartie à parts égales sur les 12 mois,
// comme le fait déjà le calcul des périodes partielles.
const monthsOf = (arr, total) => ({ $cond: [{ $isArray: arr }, arr, { $map: { input: ZEROS, in: { $divide: [{ $ifNull: [total, 0] }, 12] } } }] });
const sums = (prefix, arr, factor) => Object.fromEntries(Array.from({ length: 12 }, (_, i) => [
  `${prefix}${i}`, { $sum: { $multiply: [{ $arrayElemAt: [arr, i] }, factor] } },
]));
const toArray = (prefix) => Array.from({ length: 12 }, (_, i) => `$${prefix}${i}`);
const section = (chapter) => ({
  $switch: {
    branches: SECTIONS.map((s) => ({ case: { $and: [{ $gte: [{ $toInt: chapter }, s.chapters[0]] }, { $lte: [{ $toInt: chapter }, s.chapters[1]] }] }, then: s.code })),
    default: 'XXI',
  },
});

// Lignes détaillées → parts converties vers les codes actuels (h), mois toujours présents
const EXPAND = [
  {
    $project: {
      reporter: 1, partner: 1, flow: 1, year: 1,
      months: monthsOf('$months', '$valueEur'), monthsKg: monthsOf('$monthsKg', '$quantityKg'),
      h: { $ifNull: ['$h', [{ t: { $ifNull: [{ $arrayElemAt: ['$tc', 0] }, '$product'] }, fv: 1, fq: 1 }]] },
    },
  },
  { $unwind: '$h' },
];

async function build(cube, groupId, project, indexes, from = null) {
  const target = CUBES[cube].name;
  const tmp = `${target}_construction`;
  await mongoose.connection.collection(tmp).drop().catch(() => {});
  // Depuis les lignes détaillées (avec conversion des anciens codes) ou depuis une table déjà construite
  const source = from ? cubeModel(from) : TradeFlow;
  const head = from
    ? [{ $group: { _id: groupId, ...sums('m', '$months', 1), ...sums('k', '$monthsKg', 1) } }]
    : [...EXPAND, { $group: { _id: groupId, ...sums('m', '$months', '$h.fv'), ...sums('k', '$monthsKg', '$h.fq') } }];
  await source.aggregate([
    ...head,
    {
      $project: {
        _id: 0, ...project,
        months: toArray('m'), monthsKg: toArray('k'),
      },
    },
    { $addFields: { valueEur: { $sum: '$months' }, quantityKg: { $sum: '$monthsKg' } } },
    { $match: { $or: [{ valueEur: { $ne: 0 } }, { quantityKg: { $ne: 0 } }] } },
    { $out: tmp },
  ]).allowDiskUse(true);
  const c = mongoose.connection.collection(tmp);
  for (const key of indexes) await c.createIndex(key);
  // Remplacement atomique : les lecteurs voient l'ancienne table ou la nouvelle, jamais un état partiel
  await c.rename(target, { dropTarget: true });
  return mongoose.connection.collection(target).estimatedDocumentCount();
}

export const LATEST = 'tradecubes_latest';
export const LATEST_ROWS = 5000;

/**
 * Déclarations du dernier mois disponible, les plus importantes d'abord : première page des
 * lignes détaillées (vue mensuelle, sans filtre) servie instantanément.
 */
async function buildLatest() {
  const chap = mongoose.connection.collection(CUBES.chapter.name);
  const [top] = await chap.find({}, { projection: { year: 1 } }).sort({ year: -1 }).limit(1).toArray();
  if (!top) return null;
  let m = 11;
  while (m > 0 && !(await chap.findOne({ year: top.year, [`months.${m}`]: { $gt: 0 } }))) m -= 1;
  const y = top.year;
  const tmp = `${LATEST}_construction`;
  await mongoose.connection.collection(tmp).drop().catch(() => {});
  const monthFilter = { year: y, $or: [{ [`months.${m}`]: { $gt: 0 } }, { [`monthsKg.${m}`]: { $gt: 0 } }] };
  const counts = await TradeFlow.collection.aggregate([{ $match: monthFilter }, { $group: { _id: '$flow', n: { $sum: 1 } } }]).toArray();
  for (const flow of ['import', 'export']) {
    await TradeFlow.collection.aggregate([
      { $match: { ...monthFilter, flow } },
      { $project: { _id: 0, reporter: 1, partner: 1, product: 1, flow: 1, year: 1, tc: 1, valueEur: { $arrayElemAt: ['$months', m] }, quantityKg: { $arrayElemAt: ['$monthsKg', m] } } },
      { $sort: { valueEur: -1, product: 1, reporter: 1, partner: 1 } },
      { $limit: LATEST_ROWS },
      { $set: { month: m + 1, period: y * 100 + m + 1 } },
      { $merge: { into: tmp, whenMatched: 'keepExisting', whenNotMatched: 'insert' } },
    ], { allowDiskUse: true }).toArray();
  }
  const c = mongoose.connection.collection(tmp);
  if (!(await c.estimatedDocumentCount())) return null;
  await c.createIndex({ flow: 1, valueEur: -1 });
  await c.createIndex({ valueEur: -1 });
  await c.rename(LATEST, { dropTarget: true });
  const byFlow = Object.fromEntries(counts.map((r) => [r._id, r.n]));
  return { period: `${y}-${String(m + 1).padStart(2, '0')}`, count: (byFlow.import || 0) + (byFlow.export || 0), byFlow };
}

/** État de la table des dernières déclarations (si les tables sont à jour). */
export async function latestInfo() {
  if (!(await cubesReady())) return null;
  const doc = await Meta.findOne({ key: 'cubes' }, { 'info.latest': 1 }).lean();
  return doc?.info?.latest || null;
}

/**
 * Reconstruit les tables pour la version des données en cours, sous verrou : le serveur et un
 * script de chargement lancés en même temps ne les construisent jamais à deux.
 */
export async function rebuildCubes() {
  const r = await withLock('cubes', 3 * 60 * 60 * 1000, buildAll);
  return r.ran ? r.result : { skipped: 'construction déjà en cours ailleurs' };
}

async function buildAll() {
  const { version } = await getDataVersion({ maxAgeMs: 0 });
  const t0 = Date.now();
  const country = await build(
    'country',
    { r: '$reporter', p: '$partner', c: { $substrBytes: ['$h.t', 0, 2] }, f: '$flow', y: '$year' },
    { reporter: '$_id.r', partner: '$_id.p', chapter: '$_id.c', section: section('$_id.c'), flow: '$_id.f', year: '$_id.y' },
    [{ year: 1, flow: 1 }, { reporter: 1, year: 1 }, { partner: 1, year: 1 }, { chapter: 1, year: 1 }],
  );
  const product = await build(
    'product',
    { t: '$h.t', f: '$flow', y: '$year' },
    {
      product: '$_id.t', tc: ['$_id.t'], hs6: { $substrBytes: ['$_id.t', 0, 6] }, chapter: { $substrBytes: ['$_id.t', 0, 2] },
      section: section({ $substrBytes: ['$_id.t', 0, 2] }), flow: '$_id.f', year: '$_id.y',
    },
    [{ tc: 1, year: 1 }, { hs6: 1, year: 1 }, { chapter: 1, year: 1 }, { year: 1, flow: 1 }],
  );
  // Petites tables à une dimension, dérivées de la table par pays (quelques secondes)
  const chapter = await build('chapter', { c: '$chapter', s: '$section', f: '$flow', y: '$year' },
    { chapter: '$_id.c', section: '$_id.s', flow: '$_id.f', year: '$_id.y' }, [{ year: 1 }], 'country');
  const reporter = await build('reporter', { r: '$reporter', f: '$flow', y: '$year' },
    { reporter: '$_id.r', flow: '$_id.f', year: '$_id.y' }, [{ year: 1 }], 'country');
  const partner = await build('partner', { p: '$partner', f: '$flow', y: '$year' },
    { partner: '$_id.p', flow: '$_id.f', year: '$_id.y' }, [{ year: 1 }], 'country');
  const latest = await buildLatest();
  // Version enregistrée seulement si les données n'ont pas changé pendant la construction
  const { version: now } = await getDataVersion({ maxAgeMs: 0 });
  if (now === version) await Meta.updateOne({ key: 'cubes' }, { $set: { version, info: { schema: SCHEMA, builtAt: new Date(), rows: { country, product, chapter, reporter, partner }, latest } } }, { upsert: true });
  readAt = 0;
  return { version, ms: Date.now() - t0, rows: { country, product, chapter, reporter, partner }, current: now === version };
}

/** Reconstruction si nécessaire, une seule à la fois même avec plusieurs serveurs. */
export async function ensureCubes() {
  if (process.env.STATS_CUBES === 'false') return { ready: true };
  if (await cubesReady()) return { ready: true };
  return withLock('cubes', 3 * 60 * 60 * 1000, async () => (await cubesReady() ? { skipped: true } : buildAll()));
}
