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
  reporterChapter: { name: 'tradecubes_reporter_chapter', fields: new Set(['year', 'flow', 'reporter', 'chapter', 'section']) },
  partnerChapter: { name: 'tradecubes_partner_chapter', fields: new Set(['year', 'flow', 'partner', 'chapter', 'section']) },
  product: { name: 'tradecubes_product', fields: new Set(['year', 'flow', 'product', 'hs6', 'chapter', 'section', 'tc']) },
  country: { name: 'tradecubes_country', fields: new Set(['year', 'flow', 'reporter', 'partner', 'chapter', 'section']) },
};
// À incrémenter quand la liste ou la structure des tables change : reconstruction automatique
const SCHEMA = 4; // 3 : table des dernières déclarations ; 4 : pays × chapitre, déclarations récentes par pays

/** Ordre d'essai : de la plus petite table à la plus grande. */
export const CUBE_ORDER = ['chapter', 'reporter', 'partner', 'reporterChapter', 'partnerChapter', 'product', 'country'];

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

/** Version des données des tables en place (-1 si aucune table utilisable). */
export const cubeBuiltVersion = () => cubeVersion();

/**
 * Tables utilisables : à jour, ou construites pour une version précédente des données pendant
 * leur reconstruction (chiffres du dernier import affichés à la fin de la préparation, plutôt
 * que des pages lentes pendant tout ce temps). STATS_STALE_CUBES=false : jamais de tables périmées.
 */
export async function cubesUsable() {
  if (process.env.STATS_CUBES === 'false') return false;
  if (await cubesReady()) return true;
  return process.env.STATS_STALE_CUBES !== 'false' && (await cubeVersion()) > 0;
}

/** Vrai si les tables sont à jour pour la version des données en cours. */
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
const sectionOf = (chapter) => SECTIONS.find((sec) => Number(chapter) >= sec.chapters[0] && Number(chapter) <= sec.chapters[1])?.code || 'XXI';
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

// Calculs lancés en parallèle (MongoDB n'utilise qu'un cœur par calcul) : par année et par sens.
const PARALLEL = Math.max(1, Number(process.env.STATS_BUILD_PARALLEL) || 4);

async function inParallel(items, n, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

async function build(cube, groupId, project, indexes, from = null) {
  const target = CUBES[cube].name;
  const tmp = `${target}_construction`;
  await mongoose.connection.collection(tmp).drop().catch(() => {});
  // Depuis les lignes détaillées (avec conversion des anciens codes) ou depuis une table déjà construite
  const source = from ? cubeModel(from) : TradeFlow;
  const head = from
    ? [{ $group: { _id: groupId, ...sums('m', '$months', 1), ...sums('k', '$monthsKg', 1) } }]
    : [...EXPAND, { $group: { _id: groupId, ...sums('m', '$months', '$h.fv'), ...sums('k', '$monthsKg', '$h.fq') } }];
  const tail = [
    {
      $project: {
        _id: 0, ...project,
        months: toArray('m'), monthsKg: toArray('k'),
      },
    },
    { $addFields: { valueEur: { $sum: '$months' }, quantityKg: { $sum: '$monthsKg' } } },
    { $match: { $or: [{ valueEur: { $ne: 0 } }, { quantityKg: { $ne: 0 } }] } },
  ];
  if (from) {
    await source.aggregate([...head, ...tail, { $out: tmp }]).allowDiskUse(true);
  } else {
    // L'année et le sens font partie de chaque regroupement : les parts sont disjointes
    await mongoose.connection.createCollection(tmp);
    const years = (await TradeFlow.distinct('year')).sort();
    const parts = years.flatMap((year) => ['import', 'export'].map((flow) => ({ year, flow })));
    await inParallel(parts, PARALLEL, (part) => TradeFlow.aggregate([
      { $match: part }, ...head, ...tail,
      { $merge: { into: tmp, whenMatched: 'fail', whenNotMatched: 'insert' } },
    ]).allowDiskUse(true));
  }
  const c = mongoose.connection.collection(tmp);
  for (const key of indexes) await c.createIndex(key);
  // Remplacement atomique : les lecteurs voient l'ancienne table ou la nouvelle, jamais un état partiel
  await c.rename(target, { dropTarget: true });
  return mongoose.connection.collection(target).estimatedDocumentCount();
}

export const LATEST = 'tradecubes_latest';
// Déclarations récentes préparées : les 3 derniers mois ; pour chaque mois et chaque sens, les plus
// importantes au global, par pays de l'UE et par pays partenaire (le reste se lit dans le détail).
export const RECENT_MONTHS = 3;
export const RECENT_TOP = { all: 5000, reporter: 1500, partner: 500 };
export const LATEST_ROWS = RECENT_TOP.all;

/** Les n plus grandes valeurs vues (tas binaire : la moins bonne en tête, rejet immédiat sinon). */
class TopN {
  constructor(n) { this.n = n; this.h = []; this.count = 0; }
  // a est « moins bon » que b : valeur plus faible, puis ordre inverse du tri d'affichage
  static worse(a, b) {
    if (a.valueEur !== b.valueEur) return a.valueEur < b.valueEur;
    if (a.product !== b.product) return a.product > b.product;
    if (a.reporter !== b.reporter) return a.reporter > b.reporter;
    return a.partner > b.partner;
  }
  push(x) {
    this.count += 1;
    const { h } = this;
    if (h.length < this.n) {
      h.push(x);
      for (let i = h.length - 1; i > 0;) { const p = (i - 1) >> 1; if (!TopN.worse(h[i], h[p])) break; [h[i], h[p]] = [h[p], h[i]]; i = p; }
    } else if (TopN.worse(h[0], x)) {
      h[0] = x;
      for (let i = 0; ;) {
        const l = 2 * i + 1; const r = l + 1; let m = i;
        if (l < h.length && TopN.worse(h[l], h[m])) m = l;
        if (r < h.length && TopN.worse(h[r], h[m])) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m], h[i]]; i = m;
      }
    }
  }
}

async function buildLatest() {
  const chap = mongoose.connection.collection(CUBES.chapter.name);
  const [top] = await chap.find({}, { projection: { year: 1 } }).sort({ year: -1 }).limit(1).toArray();
  if (!top) return null;
  let m = 11;
  while (m > 0 && !(await chap.findOne({ year: top.year, [`months.${m}`]: { $gt: 0 } }))) m -= 1;
  // Derniers mois, du plus récent au plus ancien
  const periods = [];
  for (let i = 0; i < RECENT_MONTHS; i++) {
    const t = top.year * 12 + m - i;
    periods.push({ y: Math.floor(t / 12), m: (t % 12) + 1, k: Math.floor(t / 12) * 100 + (t % 12) + 1 });
  }
  // Une seule lecture des lignes des années concernées (index sur l'année), en tableaux compacts ;
  // les classements par groupe se font en mémoire, chacun borné à ses n meilleures déclarations.
  const groups = new Map();
  const groupOf = (key, n) => { let g = groups.get(key); if (!g) { g = new TopN(n); groups.set(key, g); } return g; };
  const at = (f, i) => ({ $ifNull: [{ $arrayElemAt: [f, i] }, 0] });
  const years = [...new Set(periods.map((p) => p.y))];
  const N = periods.length;
  // Deux lectures en parallèle (une par sens) : MongoDB prépare les lots sur deux cœurs
  const scan = async (flowPart) => {
    const probe = { valueEur: 0, product: '', reporter: '', partner: '' };
    const cursor = TradeFlow.collection.aggregate([
      { $match: { year: { $in: years }, flow: flowPart } },
      {
        $project: {
          _id: 0,
          a: [
            '$reporter', '$partner', '$product', '$flow', '$year',
            // codes actuels seulement s'ils diffèrent du code déclaré (rare)
            { $cond: [{ $and: [{ $isArray: '$tc' }, { $ne: ['$tc', ['$product']] }] }, '$tc', null] },
            ...periods.flatMap((p) => [at('$months', p.m - 1), at('$monthsKg', p.m - 1)]),
          ],
        },
      },
    ], { allowDiskUse: true, batchSize: 20000 });
    for await (const { a } of cursor) {
      const [reporter, partner, product, flow, year, tc] = a;
      for (let i = 0; i < N; i++) {
        const p = periods[i];
        if (p.y !== year) continue;
        const v = a[6 + 2 * i];
        const q = a[7 + 2 * i];
        if (!(v > 0 || q > 0)) continue;
        const keys = [recentKey(p.k, flow, 'all'), recentKey(p.k, flow, 'reporter', reporter), recentKey(p.k, flow, 'partner', partner)];
        const ns = [RECENT_TOP.all, RECENT_TOP.reporter, RECENT_TOP.partner];
        probe.valueEur = v; probe.product = product; probe.reporter = reporter; probe.partner = partner;
        let row = null;
        for (let j = 0; j < 3; j++) {
          const g = groupOf(keys[j], ns[j]);
          // Ligne trop petite pour ce classement : seulement comptée
          if (g.h.length >= g.n && !TopN.worse(g.h[0], probe)) { g.count += 1; continue; }
          row ??= {
            reporter, partner, product, flow, ...(tc ? { tc } : {}), chapter: product.slice(0, 2), section: sectionOf(product.slice(0, 2)),
            year: p.y, month: p.m, period: p.k, valueEur: v, quantityKg: q,
          };
          g.push(row);
        }
      }
    }
  };
  await Promise.all(['import', 'export'].map(scan));
  // Réunion des classements (une déclaration peut figurer dans plusieurs)
  const counts = {};
  const rows = new Map();
  for (const [key, g] of groups) {
    counts[key] = g.count;
    for (const r of g.h) rows.set(`${r.period}|${r.reporter}|${r.partner}|${r.product}|${r.flow}`, r);
  }
  groups.clear();
  if (!rows.size) return null;
  const tmp = `${LATEST}_construction`;
  await mongoose.connection.collection(tmp).drop().catch(() => {});
  const target = mongoose.connection.collection(tmp);
  const all = [...rows.values()];
  rows.clear();
  for (let i = 0; i < all.length; i += 10000) await target.insertMany(all.slice(i, i + 10000), { ordered: false });
  await target.createIndex({ period: -1, valueEur: -1 });
  await target.createIndex({ flow: 1, period: -1, valueEur: -1 });
  await target.createIndex({ reporter: 1, period: -1 });
  await target.createIndex({ partner: 1, period: -1 });
  await target.rename(LATEST, { dropTarget: true });
  const last = periods[0];
  const label = (p) => `${p.y}-${String(p.m).padStart(2, '0')}`;
  const byFlow = { import: counts[recentKey(last.k, 'import', 'all')] || 0, export: counts[recentKey(last.k, 'export', 'all')] || 0 };
  return { period: label(last), periods: periods.map(label), count: byFlow.import + byFlow.export, byFlow, top: RECENT_TOP, counts, rows: all.length };
}

/** Construction seule de la table des déclarations récentes (mesures, diagnostic). */
export const buildRecentTable = buildLatest;

/** Clé du nombre de déclarations d'un mois (AAAAMM), d'un sens et d'un groupe (all, reporter:FR…). */
export const recentKey = (k, flow, g, c) => `${k}|${flow}|${g === 'all' ? 'all' : `${g}:${c}`}`;

/** État de la table des dernières déclarations (si les tables sont à jour). */
export async function latestInfo() {
  if (!(await cubesUsable())) return null;
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
  const ms = {};
  let lap = Date.now();
  const step = (name) => { ms[name] = Date.now() - lap; lap = Date.now(); };
  const country = await build(
    'country',
    { r: '$reporter', p: '$partner', c: { $substrBytes: ['$h.t', 0, 2] }, f: '$flow', y: '$year' },
    { reporter: '$_id.r', partner: '$_id.p', chapter: '$_id.c', section: section('$_id.c'), flow: '$_id.f', year: '$_id.y' },
    [{ year: 1, flow: 1 }, { reporter: 1, year: 1 }, { partner: 1, year: 1 }, { chapter: 1, year: 1 }],
  );
  step('pays');
  const product = await build(
    'product',
    { t: '$h.t', f: '$flow', y: '$year' },
    {
      product: '$_id.t', tc: ['$_id.t'], hs6: { $substrBytes: ['$_id.t', 0, 6] }, chapter: { $substrBytes: ['$_id.t', 0, 2] },
      section: section({ $substrBytes: ['$_id.t', 0, 2] }), flow: '$_id.f', year: '$_id.y',
    },
    [{ tc: 1, year: 1 }, { hs6: 1, year: 1 }, { chapter: 1, year: 1 }, { year: 1, flow: 1 }],
  );
  step('produits');
  // Petites tables à une dimension, dérivées de la table par pays (quelques secondes)
  const chapter = await build('chapter', { c: '$chapter', s: '$section', f: '$flow', y: '$year' },
    { chapter: '$_id.c', section: '$_id.s', flow: '$_id.f', year: '$_id.y' }, [{ year: 1 }], 'country');
  const reporter = await build('reporter', { r: '$reporter', f: '$flow', y: '$year' },
    { reporter: '$_id.r', flow: '$_id.f', year: '$_id.y' }, [{ year: 1 }], 'country');
  const partner = await build('partner', { p: '$partner', f: '$flow', y: '$year' },
    { partner: '$_id.p', flow: '$_id.f', year: '$_id.y' }, [{ year: 1 }], 'country');
  // Fiches pays : chapitres d'un pays sans relire la grande table par pays
  const reporterChapter = await build('reporterChapter', { r: '$reporter', c: '$chapter', s: '$section', f: '$flow', y: '$year' },
    { reporter: '$_id.r', chapter: '$_id.c', section: '$_id.s', flow: '$_id.f', year: '$_id.y' }, [{ reporter: 1, year: 1 }, { chapter: 1, year: 1 }], 'country');
  const partnerChapter = await build('partnerChapter', { p: '$partner', c: '$chapter', s: '$section', f: '$flow', y: '$year' },
    { partner: '$_id.p', chapter: '$_id.c', section: '$_id.s', flow: '$_id.f', year: '$_id.y' }, [{ partner: 1, year: 1 }, { chapter: 1, year: 1 }], 'country');
  step('petites tables');
  const latest = await buildLatest();
  step('declarations recentes');
  // Version enregistrée seulement si les données n'ont pas changé pendant la construction
  const { version: now } = await getDataVersion({ maxAgeMs: 0 });
  if (now === version) await Meta.updateOne({ key: 'cubes' }, { $set: { version, info: { schema: SCHEMA, builtAt: new Date(), rows: { country, product, chapter, reporter, partner, reporterChapter, partnerChapter }, latest } } }, { upsert: true });
  readAt = 0;
  return { version, ms: Date.now() - t0, steps: ms, rows: { country, product, chapter, reporter, partner, reporterChapter, partnerChapter }, current: now === version };
}

/** Reconstruction si nécessaire, une seule à la fois même avec plusieurs serveurs. */
export async function ensureCubes() {
  if (process.env.STATS_CUBES === 'false') return { ready: true };
  if (await cubesReady()) return { ready: true };
  return withLock('cubes', 3 * 60 * 60 * 1000, async () => (await cubesReady() ? { skipped: true } : buildAll()));
}
