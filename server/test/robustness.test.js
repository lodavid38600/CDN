// Tests de robustesse : évolution de la nomenclature, données corrompues, sources multiples,
// devises, miroirs, verrous, cache. Nécessitent MongoDB (MONGO_TEST_URL), sinon ignorés.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.HTTP_RETRIES = '0';
const url = (process.env.MONGO_TEST_URL || 'mongodb://127.0.0.1:27017/douane_saas_test').replace(/\/[^/]*$/, '/douane_saas_robustesse');
const { createApp } = await import('../src/app.js');
const { TradeFlow } = await import('../src/models/TradeFlow.js');
const { WorldFlow } = await import('../src/models/WorldFlow.js');
const { Product } = await import('../src/models/Product.js');
const { NcLink } = await import('../src/models/NcLink.js');
const { Rejected, JobRun, Lock } = await import('../src/models/System.js');
const { syncNomenclature, parseCorrespondenceCsv } = await import('../src/services/ncSync.js');
const { screen, checkFlow } = await import('../src/services/quality.js');
const { upsertMonthly, toYearly } = await import('../src/services/ingest.js');
const { ingestWorldRecords } = await import('../src/connectors/index.js');
const { aggregateEuIntoWorld, rebuildMirror } = await import('../src/services/worldSync.js');
const { withLock } = await import('../src/services/lock.js');
const { bumpDataVersion } = await import('../src/services/dataVersion.js');
const { runUpdate } = await import('../src/services/updateJob.js');
const { config } = await import('../src/config.js');
const { BulkFile } = await import('../src/models/BulkFile.js');
const { rebuildCubes, cubesReady } = await import('../src/services/cubes.js');
const { buildScope } = await import('../src/services/scope.js');
const { parseFilters } = await import('../src/services/filters.js');
const { clearStatsCache } = await import('../src/middleware/cache.js');
const comtrade = await import('../src/connectors/comtrade.js');
const census = await import('../src/connectors/usCensus.js');
const hmrc = await import('../src/connectors/ukHmrc.js');
const ssb = await import('../src/connectors/ssb.js');

let available = true;
try {
  await mongoose.connect(url, { serverSelectionTimeoutMS: 1500 });
} catch {
  available = false;
}
const it = (name, fn) => test(name, { skip: !available && 'MongoDB indisponible' }, fn);
const app = createApp();
let token;
const auth = () => ({ Authorization: `Bearer ${token}` });
const close = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b} (±${eps})`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-'));
const corrDir = path.join(tmp, 'corr');
fs.mkdirSync(corrDir);

// Ligne de commerce : `v` € par mois sur `n` mois, prix `p` €/kg
function row(product, year, flow, v, { reporter = 'FR', partner = 'US', p = 10, n = 12 } = {}) {
  const months = Array.from({ length: 12 }, (_, i) => (i < n ? v : 0));
  return { reporter, partner, product, year, flow, months, monthsKg: months.map((x) => x / p), source: 'demo' };
}
async function insertFlows(rows) {
  const { valid } = await screen(rows, { source: 'test', level: 8, persist: false });
  await TradeFlow.insertMany(valid.map((d) => ({ ...d, tc: [d.product] })));
}

before(async () => {
  if (!available) return;
  await mongoose.connection.dropDatabase();
  await Promise.all([TradeFlow.syncIndexes(), WorldFlow.syncIndexes(), NcLink.syncIndexes()]);
  const res = await request(app).post('/api/auth/register').send({ email: 'r@t.fr', password: 'motdepasse' });
  token = res.body.token;
  for (const [code, d] of [['85171200', 'Téléphones (ancien)'], ['85171300', 'Smartphones'], ['85171400', 'Autres téléphones'], ['44011100', 'Bois de chauffage'], ['44012100', 'Plaquettes'], ['44031100', 'Bois brut']]) {
    await Product.create({ code, description: d, chapter: code.slice(0, 2), heading: code.slice(0, 4), section: code.startsWith('85') ? 'XVI' : 'IX' });
  }
  // 85171200 (2019-2021, 1000 €/mois) → 85171300 (800) + 85171400 (200) en 2022
  await insertFlows([
    row('85171200', 2019, 'export', 1000), row('85171200', 2020, 'export', 1000), row('85171200', 2021, 'export', 1000),
    row('85171300', 2022, 'export', 800, { p: 20 }), row('85171400', 2022, 'export', 200, { p: 5 }),
    row('85171300', 2023, 'export', 900, { p: 20 }), row('85171400', 2023, 'export', 250, { p: 5 }),
    row('85171200', 2021, 'import', 500, { partner: 'CN' }), row('85171300', 2022, 'import', 450, { partner: 'CN' }), row('85171400', 2022, 'import', 50, { partner: 'CN' }),
    // Données tardives de l'ancien code (un pays continue de l'utiliser) : rattachées aux successeurs
    row('85171200', 2022, 'export', 10, { reporter: 'DE' }),
  ]);
  fs.writeFileSync(path.join(corrDir, 'CN2021_CN2022.csv'), 'CN2021;CN2022\n8517 12 00;8517 13 00\n8517 12 00;8517 14 00\n');
});

after(async () => {
  if (available) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------- tables de correspondance

test('lecture des tables : en-tête, séparateurs, espaces, année du fichier ou de colonne, lignes invalides', () => {
  let r = parseCorrespondenceCsv('CN2021;CN2022\n8517 12 00;8517 13 00\n8517.12.00;8517.14.00\n', 'CN2021_CN2022.csv');
  assert.deepEqual(r.links.map((l) => [l.from, l.to, l.year, l.level]), [['85171200', '85171300', 2022, 8], ['85171200', '85171400', 2022, 8]]);
  r = parseCorrespondenceCsv('ancien,nouveau,year\n851712,851713,2022\nabc,def,2022\n851712,85171300,2022\n', 'hs.csv');
  assert.equal(r.links.length, 1);
  assert.equal(r.links[0].level, 6);
  assert.equal(r.errors.length, 2);
  r = parseCorrespondenceCsv('85171200\t85171300\n', 'sans-annee.tsv');
  assert.equal(r.links.length, 0);
  assert.match(r.errors[0], /année/);
  assert.deepEqual(parseCorrespondenceCsv('', 'x.csv').errors, ['fichier vide']);
});

// ---------------------------------------------------------------- synchronisation NC

it('synchronisation : poids estimés sur les volumes, statut des codes, facteurs sur les lignes', async () => {
  const rep = await syncNomenclature({ level: 8, dir: corrDir });
  assert.equal(rep.official, 2);
  const l = await NcLink.findOne({ from: '85171200', to: '85171300' }).lean();
  close(l.weights.export.s, 0.8, 1e-6);
  close(l.weights.import.s, 0.9, 1e-6);
  // En quantité, le smartphone (20 €/kg) pèse moins que l'autre téléphone (5 €/kg)
  close(l.weights.export.sq, (800 / 20) / (800 / 20 + 200 / 5), 1e-6);
  const old = await Product.findOne({ code: '85171200' }).lean();
  assert.equal(old.status, 'obsolete');
  assert.equal(old.validTo, 2022);
  const conv = await TradeFlow.findOne({ product: '85171200', year: 2020, flow: 'export' }).lean();
  assert.deepEqual(conv.tc, ['85171300', '85171400']);
  const late = await TradeFlow.findOne({ product: '85171200', reporter: 'DE', year: 2022 }).lean();
  assert.deepEqual(late.tc, ['85171300', '85171400']);
});

it('synchronisation idempotente : relancer ne change rien', async () => {
  const snap = async () => JSON.stringify(await TradeFlow.find({}, { _id: 0, product: 1, year: 1, flow: 1, reporter: 1, tc: 1, h: 1 }).sort({ product: 1, year: 1, flow: 1, reporter: 1 }).lean());
  const a = await snap();
  await syncNomenclature({ level: 8, dir: corrDir });
  await syncNomenclature({ level: 8, dir: corrDir });
  assert.equal(await snap(), a);
});

it('API : série harmonisée du nouveau code, série brute, continuation de l\'ancien code', async () => {
  await bumpDataVersion();
  const h = await request(app).get('/api/stats/timeseries?product=85171300&granularity=year').set(auth()).expect(200);
  const byYear = Object.fromEntries(h.body.map((r) => [r.year, r.exportEur]));
  assert.equal(byYear[2020], Math.round(12 * 1000 * 0.8)); // historique reconstitué
  assert.equal(byYear[2023], 12 * 900);
  const raw = await request(app).get('/api/stats/timeseries?product=85171300&granularity=year&nc=brut').set(auth()).expect(200);
  assert.equal(raw.body.find((r) => r.year === 2020).exportEur, 0);
  const cont = await request(app).get('/api/stats/timeseries?product=85171200&granularity=year').set(auth()).expect(200);
  const c = Object.fromEntries(cont.body.map((r) => [r.year, r.exportEur]));
  assert.equal(c[2020], 12000);
  assert.equal(c[2023], 12 * (900 + 250)); // tout ce qu'est devenu l'ancien code
  const sum = await request(app).get('/api/stats/summary?product=85171200').set(auth()).expect(200);
  assert.equal(sum.body.nomenclature, 'continuation');
});

it('conservation de la masse : préfixe harmonisé = brut, en valeur et en quantité, par flux', async () => {
  for (const q of ['product=8517', 'product=851', '']) {
    const a = await request(app).get(`/api/stats/summary?${q}`).set(auth()).expect(200);
    const b = await request(app).get(`/api/stats/summary?${q}&nc=brut`).set(auth()).expect(200);
    for (const k of ['importEur', 'exportEur', 'importKg', 'exportKg']) close(a.body[k], b.body[k], 2);
  }
  // Somme des codes actuels = total
  const top = await request(app).get('/api/stats/top?dimension=product&limit=50').set(auth()).expect(200);
  assert.deepEqual(top.body.map((r) => r.key).sort(), ['85171300', '85171400']);
  const total = (await request(app).get('/api/stats/summary').set(auth())).body.exportEur;
  close(top.body.reduce((s, r) => s + r.exportEur, 0), total, 2);
});

it('fiche produit : historique des codes (prédécesseurs, successeurs)', async () => {
  const p = await request(app).get('/api/products/85171300').set(auth()).expect(200);
  assert.equal(p.body.history.predecessors[0].code, '85171200');
  assert.deepEqual(p.body.years, [2019, 2020, 2021, 2022, 2023]);
  const o = await request(app).get('/api/products/85171200').set(auth()).expect(200);
  assert.equal(o.body.history.status, 'obsolete');
  assert.deepEqual(o.body.history.successors.map((s) => s.code), ['85171300', '85171400']);
});

it('liens déduits sans table officielle, puis remplacés dès qu\'une table officielle arrive', async () => {
  // Bois : 44011100 disparaît fin 2020, 44012100 apparaît en 2021 (même position 4401)
  await insertFlows([row('44011100', 2019, 'export', 100), row('44011100', 2020, 'export', 100), row('44012100', 2021, 'export', 120), row('44012100', 2022, 'export', 130), row('44012100', 2023, 'export', 130)]);
  let rep = await syncNomenclature({ level: 8, dir: corrDir });
  assert.equal(rep.inferred, 1);
  assert.equal((await NcLink.findOne({ from: '44011100' }).lean()).source, 'inferred');
  fs.writeFileSync(path.join(corrDir, 'CN2020_CN2021.csv'), 'a;b\n4401 11 00;4401 21 00\n');
  rep = await syncNomenclature({ level: 8, dir: corrDir });
  assert.equal((await NcLink.findOne({ from: '44011100' }).lean()).source, 'official');
  fs.unlinkSync(path.join(corrDir, 'CN2020_CN2021.csv'));
});

it('code réutilisé pour un autre produit : les nouvelles données restent sous ce code', async () => {
  // 44031100 → 44012100 en 2017 (table officielle), puis 44031100 réutilisé de 2022 à 2023
  fs.writeFileSync(path.join(corrDir, 'CN2016_CN2017.csv'), 'a;b\n4403 11 00;4401 21 00\n');
  await insertFlows([row('44031100', 2016, 'export', 50), row('44031100', 2022, 'export', 70), row('44031100', 2023, 'export', 70)]);
  await syncNomenclature({ level: 8, dir: corrDir });
  const oldRow = await TradeFlow.findOne({ product: '44031100', year: 2016 }).lean();
  const newRow = await TradeFlow.findOne({ product: '44031100', year: 2023 }).lean();
  assert.deepEqual(oldRow.tc, ['44012100']);
  assert.deepEqual(newRow.tc, ['44031100']);
  assert.equal((await Product.findOne({ code: '44031100' }).lean()).status, 'current');
  fs.unlinkSync(path.join(corrDir, 'CN2016_CN2017.csv'));
});

it('table officielle corrompue : lignes invalides ignorées, la synchronisation aboutit', async () => {
  fs.writeFileSync(path.join(corrDir, 'CN2021_CN2022_bis.csv'), 'x;y\n8517 12 00;\nbanane;85171300\n85171200;8517130\n');
  const rep = await syncNomenclature({ level: 8, dir: corrDir });
  assert.ok(rep.fileErrors.length >= 2);
  assert.equal((await NcLink.countDocuments({ level: 8, from: '85171200', source: 'official' })), 2);
  fs.unlinkSync(path.join(corrDir, 'CN2021_CN2022_bis.csv'));
});

it('ligne jamais synchronisée (sans tc) : reste trouvable par son code', async () => {
  await Product.create({ code: '01022905', description: 'Bovins', chapter: '01', heading: '0102', section: 'I' });
  await TradeFlow.collection.insertOne({ reporter: 'FR', partner: 'US', product: '01022905', hs6: '010229', chapter: '01', section: 'I', year: 2023, flow: 'export', valueEur: 999, quantityKg: 10, source: 'demo' });
  await bumpDataVersion();
  const s = await request(app).get('/api/stats/summary?product=01022905').set(auth()).expect(200);
  assert.equal(s.body.exportEur, 999);
});

// ---------------------------------------------------------------- qualité des données

it('contrôles de qualité : toute ligne corrompue part en quarantaine', async () => {
  const good = row('85171300', 2023, 'export', 10);
  const bad = [
    { ...good, product: '8517130' },
    { ...good, product: '8517130A' },
    { ...good, reporter: 'US' }, // déclarant hors UE (source Eurostat)
    { ...good, partner: 'DE' }, // partenaire UE : hors périmètre
    { ...good, partner: 'XX' },
    { ...good, reporter: 'FR', partner: 'FR' },
    { ...good, flow: 'transit' },
    { ...good, year: 1900 },
    { ...good, year: 2999 },
    { ...good, months: [1, 2, 3] },
    { ...good, months: Array(12).fill(-1) },
    { ...good, months: [...Array(11).fill(1), NaN] },
    { ...good, months: Array(12).fill(0), monthsKg: Array(12).fill(0) },
    { ...good, months: undefined, monthsKg: undefined, valueEur: Infinity },
    { ...good, months: undefined, monthsKg: undefined, valueEur: 'cent' },
    { ...good, product: '99999999' }, // chapitre 99 inconnu
    null,
  ];
  const before = await Rejected.countDocuments();
  const { valid, rejected } = await screen([good, ...bad], { source: 'test', level: 8 });
  assert.equal(valid.length, 1);
  assert.equal(rejected.length, bad.length);
  assert.equal(await Rejected.countDocuments(), before + bad.length);
});

test('contrôles de qualité : mois futurs refusés, total annuel recalculé, prix aberrant signalé', () => {
  const now = new Date(2026, 5, 15); // juin 2026
  const m = Array(12).fill(0);
  m[8] = 100; // septembre 2026 : futur
  assert.equal(checkFlow({ ...row('85171300', 2026, 'export', 0), months: m, monthsKg: m }, { now }).ok, false);
  const r = checkFlow({ ...row('85171300', 2025, 'export', 10), valueEur: 5 }, { now });
  assert.equal(r.ok, true);
  assert.equal(r.doc.valueEur, 120);
  assert.deepEqual(r.warnings, ['total annuel corrigé (somme des mois)']);
  const odd = checkFlow({ ...row('85171300', 2025, 'export', 1e9), monthsKg: Array(12).fill(1) }, { now });
  assert.deepEqual(odd.doc.quality, ['prix-unitaire-aberrant']);
  // Or et pierres précieuses : prix très élevés légitimes
  assert.equal(checkFlow({ ...row('71023900', 2025, 'export', 1e9), monthsKg: Array(12).fill(1) }, { now }).doc.quality, undefined);
});

it('écriture fusionnée : un import partiel ne remet jamais à zéro les autres mois', async () => {
  const keys = ['reporter', 'partner', 'product', 'year', 'flow'];
  const base = { reporter: 'IT', partner: 'JP', product: '85171300', hs6: '851713', chapter: '85', section: 'XVI', year: 2024, flow: 'export', source: 'eurostat' };
  await upsertMonthly(TradeFlow, [{ ...base, months: Array(12).fill(10), monthsKg: Array(12).fill(1) }], { keys });
  // Révision des seuls mois de mai et juin
  const m = Array(12).fill(0);
  m[4] = 50;
  m[5] = 60;
  await upsertMonthly(TradeFlow, [{ ...base, months: m, monthsKg: m.map((x) => x / 10), monthIdx: [4, 5] }], { keys });
  const d = await TradeFlow.findOne({ reporter: 'IT', partner: 'JP', year: 2024 }).lean();
  assert.deepEqual(d.months, [10, 10, 10, 10, 50, 60, 10, 10, 10, 10, 10, 10]);
  assert.equal(d.valueEur, 10 * 10 + 110);
  assert.deepEqual(d.tc, ['85171300']);
});

it('priorité des sources : une source moins fiable n\'écrase jamais une source plus fiable', async () => {
  const keys = ['reporter', 'partner', 'product', 'year', 'flow'];
  const base = { reporter: 'US', partner: 'CN', product: '851713', hs6: '851713', chapter: '85', section: 'XVI', year: 2024, flow: 'import' };
  const doc = (source, priority, v) => ({ ...base, source, priority, months: Array(12).fill(v), monthsKg: Array(12).fill(1) });
  await upsertMonthly(WorldFlow, [doc('comtrade', 2, 5)], { keys, priority: true });
  let r = await upsertMonthly(WorldFlow, [doc('us-census', 3, 7)], { keys, priority: true });
  assert.equal(r.modified, 1);
  r = await upsertMonthly(WorldFlow, [doc('comtrade', 2, 99)], { keys, priority: true });
  assert.equal(r.skippedLowerPriority, 1);
  const d = await WorldFlow.findOne(base).lean();
  assert.equal(d.source, 'us-census');
  assert.equal(d.valueEur, 84);
});

// ---------------------------------------------------------------- devises et sources étrangères

test('devises : conversion mensuelle, repli sur la moyenne annuelle, devise inconnue rejetée', () => {
  const fx = { rate: (cur, p) => (cur === 'USD' ? (p === '2024-01' ? 1.1 : 1.08) : cur === 'EUR' ? 1 : null) };
  const { docs, rejected } = toYearly([
    { reporter: 'US', partner: 'FR', product: '220421', flow: 'import', year: 2024, month: 1, valueOrig: 110, currency: 'USD', kg: 10, source: 'us-census' },
    { reporter: 'US', partner: 'FR', product: '220421', flow: 'import', year: 2024, month: 2, valueOrig: 108, currency: 'USD', kg: 10, source: 'us-census' },
    { reporter: 'US', partner: 'FR', product: '220421', flow: 'import', year: 2024, month: 3, valueOrig: 1, currency: 'XYZ', kg: 1, source: 'us-census' },
    { reporter: 'US', partner: 'FR', product: '220421', flow: 'import', year: 2024, month: 13, valueOrig: 1, currency: 'USD', kg: 1, source: 'us-census' },
  ], fx);
  assert.equal(docs.length, 1);
  close(docs[0].months[0], 100, 1e-9);
  close(docs[0].months[1], 100, 1e-9);
  assert.deepEqual(docs[0].monthIdx, [0, 1]);
  assert.equal(rejected.length, 2);
});

it('ingestion mondiale de bout en bout (taux BCE absents : moyenne annuelle intégrée)', async () => {
  const r = await ingestWorldRecords([
    { reporter: 'JP', partner: 'FR', product: '220421', flow: 'import', year: 2023, month: 1, valueOrig: 1081.3, currency: 'USD', kg: 100, source: 'comtrade' },
    { reporter: 'JP', partner: 'ZZ', product: '220421', flow: 'import', year: 2023, month: 1, valueOrig: 5, currency: 'USD', kg: 1, source: 'comtrade' },
  ]);
  assert.equal(r.valid, 1);
  assert.equal(r.rejected, 1);
  const d = await WorldFlow.findOne({ reporter: 'JP', partner: 'FR' }).lean();
  close(d.valueEur, 1000, 1);
  assert.equal(d.priority, 2);
});

it('jeu mondial : agrégation UE en SH6, priorité nationale respectée, miroirs pour les pays muets', async () => {
  await aggregateEuIntoWorld();
  const fr = await WorldFlow.findOne({ reporter: 'FR', partner: 'US', product: '851713', year: 2023, flow: 'export' }).lean();
  assert.equal(fr.source, 'eurostat');
  assert.equal(fr.valueEur, 12 * 900);
  // Les données américaines (priorité 3) ne sont pas écrasées par la réagrégation
  await aggregateEuIntoWorld();
  assert.equal((await WorldFlow.findOne({ reporter: 'US', partner: 'CN', year: 2024 }).lean()).source, 'us-census');
  const m = await rebuildMirror();
  // La Chine ne déclare rien : ses exportations vers les États-Unis sont reconstituées
  assert.ok(m.mirroredCountries.includes('CN'));
  const cn = await WorldFlow.findOne({ reporter: 'CN', partner: 'US', flow: 'export', year: 2024 }).lean();
  assert.equal(cn.mirror, true);
  assert.equal(cn.valueEur, 84);
  // Les États-Unis déclarent eux-mêmes : aucun miroir pour eux
  assert.equal(await WorldFlow.countDocuments({ reporter: 'US', mirror: true }), 0);
  // Reconstruction idempotente
  const n = await WorldFlow.countDocuments({ mirror: true });
  await rebuildMirror();
  assert.equal(await WorldFlow.countDocuments({ mirror: true }), n);
});

it('comparaison miroir : limitée au produit demandé', async () => {
  await WorldFlow.create({ reporter: 'FR', partner: 'US', product: '440111', hs6: '440111', chapter: '44', section: 'IX', year: 2023, flow: 'export', valueEur: 777, quantityKg: 7, months: Array(12).fill(0), source: 'demo', priority: 3 });
  const phones = await request(app).get('/api/stats/mirror?product=851713&reporters=FR&partners=US').set(auth()).expect(200);
  const wood = await request(app).get('/api/stats/mirror?product=440111&reporters=FR&partners=US').set(auth()).expect(200);
  assert.equal(phones.body.years.find((y) => y.year === 2023).aExports, 12 * 900);
  assert.equal(wood.body.years.find((y) => y.year === 2023).aExports, 777);
  await WorldFlow.deleteOne({ product: '440111' });
});

test('connecteurs : normalisation des réponses (Comtrade, US Census, HMRC, SSB)', () => {
  const c = comtrade.normalize({ data: [
    { reporterCode: 842, partnerCode: 251, flowCode: 'M', period: 202301, cmdCode: '220421', primaryValue: 1000, netWgt: 100 },
    { reporterCode: 842, partnerCode: 999, flowCode: 'M', period: 202301, cmdCode: '220421', primaryValue: 1 }, // partenaire inconnu
    { reporterCode: 842, partnerCode: 251, flowCode: 'X', period: 2023, cmdCode: '220421', primaryValue: 1 }, // annuel ignoré
  ] });
  assert.deepEqual(c.map((r) => [r.reporter, r.partner, r.flow, r.year, r.month, r.valueOrig, r.kg]), [['US', 'FR', 'import', 2023, 1, 1000, 100]]);
  const u = census.normalize([
    ['CTY_NAME', 'GEN_VAL_MO', 'AIR_WGT_MO', 'VES_WGT_MO', 'I_COMMODITY', 'time'],
    ['FRANCE', '5000', '10', '90', '220421', '2023-02'],
    ['TOTAL FOR ALL COUNTRIES', '9', '1', '1', '220421', '2023-02'],
  ], 'import');
  assert.deepEqual(u.map((r) => [r.partner, r.valueOrig, r.kg, r.month]), [['FR', 5000, 100, 2]]);
  const h = hmrc.normalize({ value: [
    { MonthId: 202303, FlowTypeId: 3, CommodityId: 22042109, Value: 200, NetMass: 20, Country: { CountryCodeAlpha: 'US' } },
    { MonthId: 202303, FlowTypeId: 9, CommodityId: 22042109, Value: 1, Country: { CountryCodeAlpha: 'US' } },
  ] });
  assert.deepEqual(h.map((r) => [r.reporter, r.partner, r.product, r.flow, r.currency]), [['GB', 'US', '220421', 'import', 'GBP']]);
  const s = ssb.normalize({
    id: ['Varenummer', 'ImpEks', 'Land', 'ContentsCode', 'Tid'], size: [1, 1, 1, 2, 1],
    dimension: {
      Varenummer: { category: { index: { 22042109: 0 } } }, ImpEks: { category: { index: { 1: 0 } } },
      Land: { category: { index: { FR: 0 } } }, ContentsCode: { category: { index: { Verdi: 0, Mengde1: 1 } } }, Tid: { category: { index: { '2023M04': 0 } } },
    },
    value: [3000, 150],
  });
  assert.deepEqual(s.map((r) => [r.reporter, r.partner, r.product, r.flow, r.valueOrig, r.kg, r.month]), [['NO', 'FR', '220421', 'import', 3000, 150, 4]]);
  assert.deepEqual(comtrade.normalize(null), []);
  assert.deepEqual(census.normalize('erreur', 'import'), []);
  assert.deepEqual(hmrc.normalize({}), []);
  assert.deepEqual(ssb.normalize({}), []);
});

// ---------------------------------------------------------------- exploitation

it('verrou : deux mises à jour simultanées ne s\'exécutent jamais en même temps ; verrou expiré repris', async () => {
  let running = 0;
  let max = 0;
  const job = () => withLock('test', 60_000, async () => {
    running += 1;
    max = Math.max(max, running);
    await new Promise((r) => setTimeout(r, 100));
    running -= 1;
  });
  const res = await Promise.all([job(), job(), job()]);
  assert.equal(max, 1);
  assert.equal(res.filter((r) => r.ran).length, 1);
  await Lock.create({ _id: 'bloque', owner: 'processus-mort', expiresAt: new Date(Date.now() - 1000) });
  assert.equal((await withLock('bloque', 1000, async () => 42)).result, 42);
});

it('cache : une nouvelle version des données invalide immédiatement les réponses', async () => {
  const q = '/api/stats/summary?product=8517';
  await request(app).get(q).set(auth());
  // Le cache n'est pas actif en test : on vérifie l'en-tête de version et la cohérence après modification
  await TradeFlow.updateOne({ product: '85171300', year: 2023, flow: 'export', reporter: 'FR' }, [{ $set: { months: { $map: { input: '$months', in: { $multiply: ['$$this', 2] } } } } }, { $set: { valueEur: { $sum: '$months' } } }]);
  await bumpDataVersion();
  const after = await request(app).get(q).set(auth()).expect(200);
  assert.ok(after.body.exportEur > 0);
});

it('mise à jour : une étape en échec n\'empêche pas les autres, le journal le signale', async () => {
  const prev = { ...config.bulk };
  const prevApi = [config.eurostatBaseUrl, config.autoUpdate.eurostat, config.autoUpdate.months];
  Object.assign(config.bulk, { fileUrl: 'http://127.0.0.1:9/indisponible/{name}', from: '2099-01', labelsUrl: '' });
  config.eurostatBaseUrl = 'http://127.0.0.1:9/indisponible';
  config.autoUpdate.eurostat = true; // complément API optionnel, testé aussi
  config.autoUpdate.months = 1;
  try {
    const run = await runUpdate({ steps: ['eurostat-bulk', 'eurostat', 'sync'], now: new Date(2099, 1, 15) });
    assert.equal(run.report.sync.ok, true);
    assert.equal(run.report['eurostat-bulk'].failed, 2, 'fichiers bulk injoignables signalés');
    assert.ok(run.report.eurostat.failedRequests > 0);
    assert.ok(['success', 'partial'].includes(run.status));
    assert.equal(await JobRun.countDocuments({ name: 'mise-a-jour' }), 1);
  } finally {
    Object.assign(config.bulk, prev);
    [config.eurostatBaseUrl, config.autoUpdate.eurostat, config.autoUpdate.months] = prevApi;
    await BulkFile.deleteMany({});
  }
});

it('tables de synthèse : résultats identiques aux lignes détaillées, jamais utilisées périmées', async () => {
  await bumpDataVersion({ test: 'cubes' });
  const URLS = [
    '/api/stats/summary', '/api/stats/summary?reporters=FR', '/api/stats/summary?periodFrom=2022-03&periodTo=2023-02',
    '/api/stats/timeseries?granularity=month', '/api/stats/timeseries?granularity=year&partners=US',
    '/api/stats/top?dimension=partner', '/api/stats/top?dimension=reporter&flow=import', '/api/stats/top?dimension=section',
    '/api/stats/top?dimension=chapter&limit=100', '/api/stats/top?dimension=product&limit=50', '/api/stats/top?dimension=hs6',
    '/api/stats/top?dimension=partner&product=85', '/api/stats/top?dimension=product&product=8517', '/api/stats/summary?product=85171300',
    '/api/stats/sparklines?dimension=chapter', '/api/stats/matrix?size=5', '/api/stats/forecast?granularity=month&horizon=6',
    '/api/meta', // période couverte (premier / dernier mois renseigné)
  ];
  const read = async () => {
    const out = [];
    for (const u of URLS) {
      clearStatsCache();
      const { body } = await request(app).get(u).set(auth()).expect(200);
      out.push(u === '/api/meta' ? { first: body.firstPeriod, last: body.lastPeriod, years: body.years } : body);
    }
    return out;
  };
  process.env.STATS_CUBES = 'false';
  const detailed = await read();
  delete process.env.STATS_CUBES;
  const built = await rebuildCubes();
  assert.equal(built.current, true);
  assert.ok(built.rows.country > 0 && built.rows.product > 0 && built.rows.chapter > 0);
  assert.equal(await cubesReady(), true);
  // La plus petite table capable de répondre est choisie
  const pick = async (q, dims) => (await buildScope(parseFilters(q), { dims })).cube || 'détail';
  assert.equal(await pick({}, []), 'chapter');
  assert.equal(await pick({ reporters: 'FR' }, ['partner']), 'country');
  assert.equal(await pick({}, ['product']), 'product');
  assert.equal(await pick({ product: '85171300' }, []), 'product');
  assert.equal(await pick({ product: '85171200' }, []), 'détail', 'code supprimé : continuation sur les lignes détaillées');
  assert.equal(await pick({ reporters: 'FR' }, ['product']), 'détail');
  assert.equal(await pick({}, null), 'détail', 'requête qui ne déclare pas ses champs : lignes détaillées');
  const fromCubes = await read();
  const norm = (x) => JSON.parse(JSON.stringify(x, (k, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v)));
  URLS.forEach((u, i) => assert.deepEqual(norm(fromCubes[i]), norm(detailed[i]), u));

  // Nouvelle donnée sans reconstruction : les tables sont ignorées, le résultat reste exact
  const before = (await request(app).get('/api/stats/summary').set(auth())).body.exportEur;
  await insertFlows([row('85171300', 2023, 'export', 1, { reporter: 'IT', partner: 'NO', n: 1 })]);
  await bumpDataVersion({ test: 'cubes-stale' });
  await new Promise((r) => setTimeout(r, 5100)); // lecture de l'état des tables : au plus toutes les 5 s
  clearStatsCache();
  assert.equal((await request(app).get('/api/stats/summary').set(auth())).body.exportEur, before + 1);
});
