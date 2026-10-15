// Constitution et mise à jour de la base à partir des fichiers « bulk » d'Eurostat (Comext).
//
// Pourquoi des fichiers plutôt que l'API : un fichier mensuel contient TOUS les codes NC8,
// tous les pays et tous les partenaires d'un mois, sans quota ni limite de requêtes ; la base
// est constituée une fois, puis seuls les fichiers modifiés (révisions) sont retraités.
// Les utilisateurs n'interrogent jamais Eurostat : ils lisent notre base.
//
// Chaîne de traitement, entièrement en flux (aucun fichier chargé en mémoire) :
//   fichier .7z / .gz / .csv → lignes → filtres de qualité → table intermédiaire →
//   agrégation et fusion mois par mois dans la base ($merge) → libellés NC manquants.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { createRequire } from 'node:module';
import { config } from '../config.js';
import { EU_CODES, isCountryCode, normalizeCountry } from '../data/countries.js';
import { SECTIONS, CHAPTERS } from '../data/nomenclature.js';
import { TradeFlow } from '../models/TradeFlow.js';
import { Product } from '../models/Product.js';
import { Nomenclature } from '../models/Nomenclature.js';
import { Rejected } from '../models/System.js';
import { BulkFile, BulkStaging } from '../models/BulkFile.js';

const require = createRequire(import.meta.url);

// Noms de colonnes selon les versions des fichiers Comext (ancienne et « v2 »)
const COLUMNS = {
  reporter: ['DECLARANT_ISO', 'REPORTER', 'REPORTER_ISO', 'DECLARANT'],
  partner: ['PARTNER_ISO', 'PARTNER'],
  tradeType: ['TRADE_TYPE'],
  product: ['PRODUCT_NC', 'PRODUCT', 'CN8'],
  flow: ['FLOW'],
  period: ['PERIOD', 'TIME_PERIOD'],
  value: ['VALUE_IN_EUROS', 'VALUE_EUR', 'VALUE'],
  kg: ['QUANTITY_IN_KG', 'QUANTITY_KG'],
};

function sevenZipPath() {
  const p = require('7zip-bin').path7za;
  try {
    fs.chmodSync(p, 0o755);
  } catch { /* déjà exécutable */ }
  return p;
}

/** Lignes d'un fichier .7z, .gz ou texte, lues en flux. */
export function openLines(file) {
  let input;
  let child;
  if (/\.(7z|zip)$/i.test(file)) {
    child = spawn(sevenZipPath(), ['e', '-so', file], { stdio: ['ignore', 'pipe', 'pipe'] });
    input = child.stdout;
  } else if (/\.gz$/i.test(file)) {
    input = fs.createReadStream(file).pipe(zlib.createGunzip());
  } else {
    input = fs.createReadStream(file);
  }
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  return { rl, child };
}

function headerIndex(cells) {
  const upper = cells.map((c) => c.trim().replace(/^"|"$/g, '').toUpperCase());
  const idx = {};
  // Par ordre de préférence : DECLARANT_ISO avant DECLARANT (code numérique) etc.
  for (const [key, names] of Object.entries(COLUMNS)) idx[key] = names.map((n) => upper.indexOf(n)).find((i) => i >= 0) ?? -1;
  const missing = ['reporter', 'partner', 'product', 'flow', 'period', 'value'].filter((k) => idx[k] < 0);
  if (missing.length) throw new Error(`colonnes absentes du fichier : ${missing.join(', ')}`);
  return idx;
}

const sectionExpr = (chapterField) => ({
  $switch: {
    branches: SECTIONS.map((s) => ({
      case: { $and: [{ $gte: [{ $toInt: chapterField }, s.chapters[0]] }, { $lte: [{ $toInt: chapterField }, s.chapters[1]] }] },
      then: s.code,
    })),
    default: 'XXI',
  },
});

/**
 * Charge un fichier bulk dans la base.
 * - garde le commerce extra-UE (déclarant UE, partenaire hors UE) au niveau NC8 ;
 * - ignore les totaux annuels (période « AAAA52 ») et les agrégats ;
 * - additionne les régimes statistiques d'un même flux ;
 * - remplace les mois présents dans le fichier (relancer ne double jamais les valeurs).
 */
export async function processBulkFile(file, { source = path.basename(file) } = {}) {
  const run = randomUUID();
  const stats = { lines: 0, kept: 0, intraEu: 0, annual: 0, otherLevel: 0, rejected: 0, months: new Set() };
  const rejectedSamples = [];
  const reject = (reason, line) => {
    stats.rejected += 1;
    if (rejectedSamples.length < 200) rejectedSamples.push({ source: `bulk:${source}`, reasons: [reason], record: { line: line.slice(0, 300) } });
  };
  const { rl, child } = openLines(file);
  let childError = '';
  child?.stderr.on('data', (d) => { childError += d; });
  const exited = child ? new Promise((resolve) => child.on('close', resolve)) : Promise.resolve(0);

  let idx = null;
  let sep = ',';
  let batch = [];
  const flush = async () => {
    if (!batch.length) return;
    const docs = batch;
    batch = [];
    await BulkStaging.insertMany(docs, { ordered: false });
  };
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      if (!idx) {
        sep = [',', ';', '\t', '|'].find((s) => line.includes(s)) || ',';
        idx = headerIndex(line.split(sep));
        continue;
      }
      stats.lines += 1;
      const c = line.split(sep).map((x) => x.trim().replace(/^"|"$/g, ''));
      const reporter = normalizeCountry(c[idx.reporter]);
      const partner = normalizeCountry(c[idx.partner]);
      const tradeType = idx.tradeType >= 0 ? c[idx.tradeType] : null;
      if (!EU_CODES.has(reporter)) { reject(`déclarant non UE (${reporter})`, line); continue; }
      if (tradeType === 'I' || EU_CODES.has(partner)) { stats.intraEu += 1; continue; }
      const product = c[idx.product];
      if (!/^\d{8}$/.test(product)) { stats.otherLevel += 1; continue; } // totaux, chapitres, codes confidentiels
      if (!isCountryCode(partner)) { reject(`partenaire inconnu (${partner})`, line); continue; }
      const flow = c[idx.flow] === '1' ? 'import' : c[idx.flow] === '2' ? 'export' : null;
      if (!flow) { reject(`flux invalide (${c[idx.flow]})`, line); continue; }
      const period = c[idx.period];
      const m = Number(period.slice(4, 6));
      const y = Number(period.slice(0, 4));
      if (!/^\d{6}$/.test(period)) { reject(`période invalide (${period})`, line); continue; }
      if (m === 52) { stats.annual += 1; continue; } // total annuel publié à part
      if (m < 1 || m > 12 || y < 1988 || y > new Date().getFullYear()) { reject(`période invalide (${period})`, line); continue; }
      const v = Number(c[idx.value] || 0);
      const q = idx.kg >= 0 ? Number(c[idx.kg] || 0) : 0;
      if (!Number.isFinite(v) || !Number.isFinite(q) || v < 0 || q < 0) { reject('valeur ou quantité invalide', line); continue; }
      if (v === 0 && q === 0) continue;
      if (!CHAPTERS[product.slice(0, 2)]) { reject(`chapitre inconnu (${product})`, line); continue; }
      stats.kept += 1;
      stats.months.add(`${y}-${String(m).padStart(2, '0')}`);
      batch.push({ run, r: reporter, p: partner, c: product, f: flow, y, m: m - 1, v, q });
      if (batch.length >= 20000) await flush();
    }
    await flush();
    const code = await exited;
    if (child && code !== 0) throw new Error(`décompression impossible (${childError.trim().split('\n').pop() || `code ${code}`})`);
    if (!idx) throw new Error('fichier vide');

    // Agrégation (régimes statistiques additionnés) et fusion mois par mois dans la base
    const months = '$$new.months';
    await BulkStaging.aggregate([
      { $match: { run } },
      { $group: { _id: { r: '$r', p: '$p', c: '$c', f: '$f', y: '$y', m: '$m' }, v: { $sum: '$v' }, q: { $sum: '$q' } } },
      { $group: { _id: { r: '$_id.r', p: '$_id.p', c: '$_id.c', f: '$_id.f', y: '$_id.y' }, e: { $push: { m: '$_id.m', v: '$v', q: '$q' } } } },
      {
        $project: {
          _id: 0, reporter: '$_id.r', partner: '$_id.p', product: '$_id.c', year: '$_id.y', flow: '$_id.f',
          hs6: { $substrBytes: ['$_id.c', 0, 6] }, chapter: { $substrBytes: ['$_id.c', 0, 2] },
          mi: '$e.m',
          months: { $map: { input: { $range: [0, 12] }, as: 'i', in: { $sum: { $map: { input: { $filter: { input: '$e', cond: { $eq: ['$$this.m', '$$i'] } } }, in: '$$this.v' } } } } },
          monthsKg: { $map: { input: { $range: [0, 12] }, as: 'i', in: { $sum: { $map: { input: { $filter: { input: '$e', cond: { $eq: ['$$this.m', '$$i'] } } }, in: '$$this.q' } } } } },
        },
      },
      { $addFields: { section: sectionExpr('$chapter'), source: 'eurostat', valueEur: { $sum: '$months' }, quantityKg: { $sum: '$monthsKg' }, tc: ['$product'] } },
      {
        $merge: {
          into: TradeFlow.collection.name,
          on: ['reporter', 'partner', 'product', 'year', 'flow'],
          whenMatched: [
            {
              $set: {
                months: { $map: { input: { $range: [0, 12] }, as: 'i', in: { $cond: [{ $in: ['$$i', '$$new.mi'] }, { $arrayElemAt: [months, '$$i'] }, { $arrayElemAt: [{ $ifNull: ['$months', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]] }, '$$i'] }] } } },
                monthsKg: { $map: { input: { $range: [0, 12] }, as: 'i', in: { $cond: [{ $in: ['$$i', '$$new.mi'] }, { $arrayElemAt: ['$$new.monthsKg', '$$i'] }, { $arrayElemAt: [{ $ifNull: ['$monthsKg', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]] }, '$$i'] }] } } },
                source: 'eurostat',
              },
            },
            { $set: { valueEur: { $sum: '$months' }, quantityKg: { $sum: '$monthsKg' }, tc: { $ifNull: ['$tc', ['$product']] } } },
          ],
          whenNotMatched: 'insert',
        },
      },
    ]).allowDiskUse(true);
    await TradeFlow.collection.updateMany({ mi: { $exists: true } }, { $unset: { mi: 1 } });

    // Codes NC apparus dans le fichier mais absents du catalogue
    const codes = await BulkStaging.distinct('c', { run });
    const known = new Set((await Product.find({ code: { $in: codes } }, { code: 1 }).lean()).map((p) => p.code));
    const missing = codes.filter((c) => !known.has(c));
    if (missing.length) {
      const labels = new Map((await Nomenclature.find({ code: { $in: missing } }).lean()).map((n) => [n.code, n.label]));
      await Product.insertMany(missing.map((code) => ({
        code, description: labels.get(code) || `Code NC ${code.slice(0, 4)} ${code.slice(4, 6)} ${code.slice(6)}`,
        chapter: code.slice(0, 2), heading: code.slice(0, 4), section: SECTIONS.find((s) => Number(code.slice(0, 2)) >= s.chapters[0] && Number(code.slice(0, 2)) <= s.chapters[1])?.code || 'XXI',
      })), { ordered: false }).catch(() => {});
    }
    stats.newCodes = missing.length;
  } finally {
    rl.close();
    child?.kill();
    await BulkStaging.deleteMany({ run });
    if (rejectedSamples.length) await Rejected.insertMany(rejectedSamples, { ordered: false }).catch(() => {});
  }
  return { ...stats, months: [...stats.months].sort() };
}

/** Libellés NC officiels (fichier « code<TAB>libellé », éventuellement compressé). */
export async function loadCnLabels(file) {
  const { rl } = openLines(file);
  const ops = [];
  for await (const line of rl) {
    const m = /^"?(\d{2}(?:\d{2})?(?:\d{2})?(?:\d{2})?)"?\s*[\t;|]\s*"?(.+?)"?\s*$/.exec(line.replace(/^﻿/, ''));
    if (!m) continue;
    const code = m[1];
    if (![2, 4, 6, 8].includes(code.length)) continue;
    ops.push({ updateOne: { filter: { code }, update: { $set: { code, level: code.length, label: m[2] } }, upsert: true } });
  }
  for (let i = 0; i < ops.length; i += 5000) await Nomenclature.bulkWrite(ops.slice(i, i + 5000), { ordered: false });
  // Les libellés officiels remplacent les libellés provisoires « Code NC … »
  const cn8 = ops.filter((o) => o.updateOne.filter.code.length === 8);
  for (let i = 0; i < cn8.length; i += 5000) {
    await Product.bulkWrite(cn8.slice(i, i + 5000).map((o) => ({ updateOne: { filter: { code: o.updateOne.filter.code, description: /^Code NC / }, update: { $set: { description: o.updateOne.update.$set.label } } } })), { ordered: false });
  }
  return { labels: ops.length };
}

// ------------------------------------------------------------------ téléchargement

export function monthList(from, to) {
  const out = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

async function remoteInfo(url) {
  const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(30_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { size: Number(res.headers.get('content-length')) || null, lastModified: res.headers.get('last-modified'), etag: res.headers.get('etag') };
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30 * 60_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const tmp = `${dest}.part`;
  await pipeline(res.body, fs.createWriteStream(tmp));
  fs.renameSync(tmp, dest);
}

/**
 * Synchronise la base avec les fichiers bulk : pour chaque mois, télécharge et traite le fichier
 * s'il est nouveau ou s'il a changé depuis le dernier traitement (révision Eurostat).
 * Un mois indisponible ou en échec n'empêche pas les autres.
 */
export async function syncBulk({ from = config.bulk.from, to, force = false, onProgress = () => {} } = {}) {
  const now = new Date();
  to ??= `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const dir = path.resolve(config.bulk.dir);
  fs.mkdirSync(dir, { recursive: true });
  const report = { checked: 0, processed: 0, unchanged: 0, missing: 0, failed: 0, files: [] };

  for (const ym of monthList(from, to)) {
    report.checked += 1;
    let done = false;
    for (const pattern of config.bulk.patterns) {
      const name = pattern.replace('{YYYYMM}', ym);
      const url = config.bulk.fileUrl.replace('{name}', encodeURIComponent(name));
      const dest = path.join(dir, name);
      try {
        const info = await remoteInfo(url);
        if (!info) continue; // ce nom n'existe pas pour ce mois : essai suivant
        const prev = await BulkFile.findOne({ name }).lean();
        const same = prev?.status === 'processed' && prev.size === info.size && prev.lastModified === info.lastModified && prev.etag === info.etag;
        if (same && !force) {
          report.unchanged += 1;
          done = true;
          break;
        }
        onProgress(`${name} : téléchargement`);
        await download(url, dest);
        onProgress(`${name} : chargement`);
        const stats = await processBulkFile(dest, { source: name });
        if (!config.bulk.keepFiles) fs.rmSync(dest, { force: true });
        await BulkFile.updateOne({ name }, { $set: { name, period: `${ym.slice(0, 4)}-${ym.slice(4)}`, url, ...info, status: 'processed', processedAt: new Date(), stats, error: null } }, { upsert: true });
        report.processed += 1;
        report.files.push({ name, kept: stats.kept, rejected: stats.rejected });
        done = true;
        break;
      } catch (e) {
        if (!config.bulk.keepFiles) for (const f of [dest, `${dest}.part`]) fs.rmSync(f, { force: true });
        await BulkFile.updateOne({ name }, { $set: { name, url, status: 'failed', error: e.message } }, { upsert: true });
        report.failed += 1;
        report.files.push({ name, error: e.message });
        done = true;
        break;
      }
    }
    if (!done) report.missing += 1; // mois pas encore publié
  }
  if (config.bulk.labelsUrl) {
    try {
      const dest = path.join(dir, path.basename(new URL(config.bulk.labelsUrl).pathname) || 'cn-labels.txt');
      await download(config.bulk.labelsUrl, dest);
      report.labels = await loadCnLabels(dest);
    } catch (e) {
      report.labels = { error: e.message };
    }
  }
  return report;
}
