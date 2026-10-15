// Fichiers bulk Eurostat (Comext) : lecture des formats, filtres, fusion mois par mois,
// idempotence, révisions, téléchargement conditionnel. Nécessitent MongoDB, sinon ignorés.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';

process.env.NODE_ENV = 'test';
const url = (process.env.MONGO_TEST_URL || 'mongodb://127.0.0.1:27017/douane_saas_test').replace(/\/[^/]*$/, '/douane_saas_bulk');
const { TradeFlow } = await import('../src/models/TradeFlow.js');
const { Product } = await import('../src/models/Product.js');
const { Rejected } = await import('../src/models/System.js');
const { BulkFile, BulkStaging } = await import('../src/models/BulkFile.js');
const { processBulkFile, syncBulk, loadCnLabels, monthList } = await import('../src/services/eurostatBulk.js');
const { config } = await import('../src/config.js');

let available = true;
try {
  await mongoose.connect(url, { serverSelectionTimeoutMS: 1500 });
} catch {
  available = false;
}
const it = (name, fn) => test(name, { skip: !available && 'MongoDB indisponible' }, fn);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bulk-'));
const write = (name, content) => {
  const f = path.join(tmp, name);
  fs.writeFileSync(f, content);
  return f;
};
const flow = (q) => TradeFlow.findOne({ reporter: 'FR', partner: 'US', product: '22042109', year: 2023, flow: 'export', ...q }).lean();

// Ancien format (DECLARANT_ISO…) et format v2 (REPORTER…)
const OLD_HEADER = 'DECLARANT,DECLARANT_ISO,PARTNER,PARTNER_ISO,TRADE_TYPE,PRODUCT_NC,PRODUCT_SITC,PRODUCT_CPA2002,PRODUCT_CPA2008,PRODUCT_CPA2_1,PRODUCT_BEC,PRODUCT_BEC5,PRODUCT_SECTION,FLOW,STAT_REGIME,SUPP_UNIT,PERIOD,VALUE_IN_EUROS,QUANTITY_IN_KG,SUP_QUANTITY';
const old = (rep, par, type, nc, fl, regime, period, v, kg) => `001,${rep},400,${par},${type},${nc},,,,,,,,${fl},${regime},,${period},${v},${kg},`;
const JAN = [
  OLD_HEADER,
  old('FR', 'US', 'E', '22042109', '2', '1', '202301', 1000, 100),
  old('FR', 'US', 'E', '22042109', '2', '4', '202301', 500, 50), // autre régime : additionné
  old('FR', 'DE', 'I', '22042109', '2', '1', '202301', 9999, 999), // intra-UE : ignoré
  old('FR', 'US', 'E', '220421', '2', '1', '202301', 7777, 777), // niveau SH6 : ignoré
  old('FR', 'US', 'E', 'TOTAL', '2', '1', '202301', 7777, 777),
  old('FR', 'US', 'E', '22042109', '2', '1', '202352', 88888, 8888), // total annuel : ignoré
  old('FR', 'US', 'E', '22042109', '1', '1', '202301', 300, 40), // import
  old('EL', 'CN', 'E', '03028990', '2', '1', '202301', 200, 20), // Grèce : EL → GR, code inconnu → créé
  old('FR', 'US', 'E', '22042109', '9', '1', '202301', 1, 1), // flux invalide : quarantaine
  old('FR', 'US', 'E', '22042109', '2', '1', '202301', -5, 1), // valeur négative : quarantaine
  old('XX', 'US', 'E', '22042109', '2', '1', '202301', 1, 1), // déclarant hors UE : quarantaine
].join('\r\n');

before(async () => {
  if (!available) return;
  await mongoose.connection.dropDatabase();
  await Promise.all([TradeFlow.syncIndexes(), BulkFile.syncIndexes()]);
  await Product.create({ code: '22042109', description: 'Vins', chapter: '22', heading: '2204', section: 'IV' });
});
after(async () => {
  if (available) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('liste des mois couverts', () => {
  assert.deepEqual(monthList('2022-11', '2023-02'), ['202211', '202212', '202301', '202302']);
  assert.deepEqual(monthList('2023-03', '2023-02'), []);
});

it('fichier CSV ancien format : filtres, régimes additionnés, quarantaine', async () => {
  const stats = await processBulkFile(write('full202301.dat', JAN));
  assert.equal(stats.kept, 4);
  assert.equal(stats.intraEu, 1);
  assert.equal(stats.otherLevel, 2);
  assert.equal(stats.annual, 1);
  assert.equal(stats.rejected, 3);
  assert.deepEqual(stats.months, ['2023-01']);
  const exp = await flow();
  assert.equal(exp.months[0], 1500);
  assert.equal(exp.monthsKg[0], 150);
  assert.equal(exp.valueEur, 1500);
  assert.equal(exp.hs6, '220421');
  assert.equal(exp.section, 'IV');
  assert.equal(exp.source, 'eurostat');
  assert.deepEqual(exp.tc, ['22042109']);
  assert.equal(exp.mi, undefined);
  assert.equal((await flow({ flow: 'import' })).valueEur, 300);
  assert.equal(await TradeFlow.countDocuments({ partner: 'DE' }), 0);
  const gr = await TradeFlow.findOne({ reporter: 'GR' }).lean();
  assert.equal(gr.section, 'I');
  assert.match((await Product.findOne({ code: '03028990' })).description, /^Code NC 0302 89 90/);
  assert.equal(await Rejected.countDocuments({ source: 'bulk:full202301.dat' }), 3);
  assert.equal(await BulkStaging.countDocuments(), 0, 'table intermédiaire vidée');
});

it('retraiter le même fichier ne double jamais les valeurs', async () => {
  await processBulkFile(write('full202301.dat', JAN));
  assert.equal((await flow()).valueEur, 1500);
  assert.equal(await TradeFlow.countDocuments({ reporter: 'FR', product: '22042109' }), 2);
});

it('format v2 compressé (.gz) : un nouveau mois complète la ligne sans toucher les autres', async () => {
  const csv = ['REPORTER;PARTNER;TRADE_TYPE;PRODUCT_NC;FLOW;PERIOD;VALUE_EUR;QUANTITY_KG',
    'FR;US;E;22042109;2;202302;2000;180', 'FR;GB;E;22042109;2;202302;400;30'].join('\n');
  const f = path.join(tmp, 'full_v2_202302.csv.gz');
  fs.writeFileSync(f, zlib.gzipSync(csv));
  await processBulkFile(f);
  const exp = await flow();
  assert.deepEqual(exp.months.slice(0, 3), [1500, 2000, 0]);
  assert.equal(exp.valueEur, 3500);
  assert.equal(exp.quantityKg, 330);
  assert.ok(await TradeFlow.findOne({ partner: 'GB' }), 'UK/GB hors UE conservé');
});

it('révision Eurostat : le mois révisé est remplacé, pas additionné', async () => {
  const csv = [OLD_HEADER, old('FR', 'US', 'E', '22042109', '2', '1', '202301', 1600, 160)].join('\n');
  await processBulkFile(write('rev.csv', csv));
  const exp = await flow();
  assert.deepEqual(exp.months.slice(0, 2), [1600, 2000]);
  assert.equal(exp.valueEur, 3600);
});

it('archive .7z lue en flux', async () => {
  const za = createRequire(import.meta.url)('7zip-bin').path7za;
  fs.chmodSync(za, 0o755);
  const src = write('full202303.dat', [OLD_HEADER, old('FR', 'US', 'E', '22042109', '2', '1', '202303', 700, 70)].join('\n'));
  const archive = path.join(tmp, 'full202303.7z');
  execFileSync(za, ['a', '-bd', archive, src], { stdio: 'ignore' });
  fs.rmSync(src);
  const stats = await processBulkFile(archive);
  assert.equal(stats.kept, 1);
  assert.equal((await flow()).months[2], 700);
});

it('écritures parallèles : plusieurs mois d\'une même ligne dans un fichier, petits lots concurrents', async () => {
  const rows = [];
  for (let m = 1; m <= 12; m++) for (const p of ['JP', 'KR', 'CA']) rows.push(old('IT', p, 'E', '04069021', '2', '1', `2023${String(m).padStart(2, '0')}`, 100 * m, m));
  const f = write('annee.dat', [OLD_HEADER, ...rows].join('\n'));
  let r = await processBulkFile(f, { batchSize: 2, concurrency: 4 });
  assert.equal(r.flows, 36);
  const check = async (factor) => {
    for (const p of ['JP', 'KR', 'CA']) {
      const d = await TradeFlow.findOne({ reporter: 'IT', partner: p, product: '04069021', year: 2023 }).lean();
      assert.deepEqual(d.months, Array.from({ length: 12 }, (_, i) => factor * 100 * (i + 1)));
      assert.equal(d.valueEur, factor * 7800);
      assert.equal(d.quantityKg, 78);
    }
  };
  await check(1);
  // Révision de toute l'année : toutes les lignes existent, totaux recalculés
  const f2 = write('annee2.dat', [OLD_HEADER, ...rows.map((l) => l.replace(/,(\d+),(\d+),$/, (_, v, q) => `,${2 * v},${q},`))].join('\n'));
  r = await processBulkFile(f2, { batchSize: 5, concurrency: 4 });
  assert.equal(r.updated, 36);
  await check(2);
});

it('fichiers illisibles : erreur claire, base intacte', async () => {
  await assert.rejects(processBulkFile(write('vide.csv', '')), /vide/);
  await assert.rejects(processBulkFile(write('cols.csv', 'A,B,C\n1,2,3\n')), /colonnes absentes/);
  await assert.rejects(processBulkFile(write('casse.7z', 'pas une archive')), /décompression/);
  assert.equal((await flow()).valueEur, 4300);
  assert.equal(await BulkStaging.countDocuments(), 0);
});

it('libellés NC officiels remplacent les libellés provisoires', async () => {
  await loadCnLabels(write('labels.txt', '03028990\tAutres poissons frais\n22042109\tVins AOP\n0302\tPoissons frais\n'));
  assert.equal((await Product.findOne({ code: '03028990' })).description, 'Autres poissons frais');
  assert.equal((await Product.findOne({ code: '22042109' })).description, 'Vins', 'libellé existant conservé');
});

it('synchronisation : télécharge les mois publiés, ignore les inchangés, retraite les révisés', async () => {
  const files = {
    'full_v2_202304.7z': null, // n'existe pas : essai du nom suivant
    'full202304.dat': { body: [OLD_HEADER, old('FR', 'US', 'E', '22042109', '2', '1', '202304', 100, 10)].join('\n'), mod: 'Mon, 01 May 2023 00:00:00 GMT' },
    'full202305.dat': { body: 'cassé', mod: 'Mon, 01 Jun 2023 00:00:00 GMT' },
  };
  let gets = 0;
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, 'http://x').searchParams.get('f'));
    const f = files[name];
    if (!f) return res.writeHead(404).end();
    res.writeHead(200, { 'content-length': Buffer.byteLength(f.body), 'last-modified': f.mod });
    if (req.method === 'HEAD') return res.end();
    gets += 1;
    res.end(f.body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const prev = { ...config.bulk };
  Object.assign(config.bulk, {
    fileUrl: `http://127.0.0.1:${server.address().port}/?f={name}`,
    patterns: ['full_v2_{YYYYMM}.7z', 'full{YYYYMM}.dat'],
    dir: path.join(tmp, 'dl'), keepFiles: false, labelsUrl: '',
  });
  try {
    let r = await syncBulk({ from: '2023-04', to: '2023-06' });
    assert.equal(r.checked, 3);
    assert.equal(r.processed, 1);
    assert.equal(r.failed, 1, 'fichier cassé isolé');
    assert.equal(r.missing, 1, 'mois pas encore publié');
    assert.equal((await flow()).months[3], 100);
    assert.equal((await BulkFile.findOne({ name: 'full202305.dat' })).status, 'failed');
    assert.deepEqual(fs.readdirSync(config.bulk.dir), [], 'fichiers supprimés après chargement');

    gets = 0;
    r = await syncBulk({ from: '2023-04', to: '2023-04' });
    assert.equal(r.unchanged, 1);
    assert.equal(gets, 0, 'fichier inchangé non retéléchargé');

    files['full202304.dat'] = { body: [OLD_HEADER, old('FR', 'US', 'E', '22042109', '2', '1', '202304', 150, 15)].join('\n'), mod: 'Thu, 01 Jun 2023 00:00:00 GMT' };
    r = await syncBulk({ from: '2023-04', to: '2023-04' });
    assert.equal(r.processed, 1);
    assert.equal((await flow()).months[3], 150);
  } finally {
    Object.assign(config.bulk, prev);
    server.close();
  }
});
