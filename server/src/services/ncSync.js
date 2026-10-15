// Synchronisation automatique de la nomenclature :
//  1. lit les tables de correspondance officielles (fichiers CSV, éventuellement téléchargés) ;
//  2. déduit les liens manquants à partir des données (codes qui disparaissent / apparaissent) ;
//  3. pondère chaque lien avec les volumes observés ;
//  4. écrit sur chaque ligne de commerce les codes actuels correspondants (tc) et les facteurs (h) ;
//  5. met à jour le cycle de vie des codes (actuel, remplacé, abandonné).
// L'opération est idempotente : la relancer donne le même résultat.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TradeFlow } from '../models/TradeFlow.js';
import { WorldFlow } from '../models/WorldFlow.js';
import { Product } from '../models/Product.js';
import { NcLink } from '../models/NcLink.js';
import { NcGraph, validateLinks, computeWeights, inferLinks, implicitSelfLinks, deriveHs6Links } from './ncGraph.js';

export const CORRESPONDENCE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/correspondances');

/**
 * Lit une table de correspondance CSV (séparateur ; , ou tabulation, en-tête facultatif).
 * Les deux premières colonnes contenant des codes donnent « ancien code → nouveau code ».
 * L'année d'application vient d'une colonne « year/annee » ou du nom du fichier
 * (ex. CN2021_CN2022.csv → 2022).
 */
export function parseCorrespondenceCsv(text, filename = '') {
  const links = [];
  const errors = [];
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { links, errors: ['fichier vide'] };
  const sep = [';', '\t', ','].find((s) => lines[0].includes(s)) || ';';
  const split = (l) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
  const isCode = (c) => /^\d[\d\s.]*$/.test(c) && [6, 8].includes(c.replace(/[\s.]/g, '').length);
  const head = split(lines[0]);
  const hasHeader = !head.some(isCode);
  const yearCol = hasHeader ? head.findIndex((h) => /^(year|annee|année)$/i.test(h)) : -1;
  const years = [...String(path.basename(filename)).matchAll(/(19|20)\d{2}/g)].map((m) => Number(m[0]));
  const fileYear = years.length ? Math.max(...years) : null;

  lines.slice(hasHeader ? 1 : 0).forEach((line, i) => {
    const cells = split(line);
    const codes = cells.filter(isCode).map((c) => c.replace(/[\s.]/g, ''));
    const year = yearCol >= 0 ? Number(cells[yearCol]) : fileYear;
    if (codes.length < 2) {
      errors.push(`ligne ${i + 1 + (hasHeader ? 1 : 0)} : deux codes attendus`);
      return;
    }
    if (codes[0].length !== codes[1].length) {
      errors.push(`ligne ${i + 1} : codes de longueurs différentes`);
      return;
    }
    if (!Number.isInteger(year)) {
      errors.push(`ligne ${i + 1} : année d'application inconnue`);
      return;
    }
    links.push({ from: codes[0], to: codes[1], year, level: codes[0].length, source: 'official', file: path.basename(filename) });
  });
  return { links, errors };
}

export function loadCorrespondenceFiles(dir = CORRESPONDENCE_DIR) {
  const out = { links: [], files: [], errors: [] };
  if (!fs.existsSync(dir)) return out;
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(csv|txt|tsv)$/i.test(entry.name)) {
        try {
          const { links, errors } = parseCorrespondenceCsv(fs.readFileSync(full, 'utf8'), entry.name);
          out.links.push(...links);
          out.files.push(entry.name);
          out.errors.push(...errors.map((e) => `${entry.name} — ${e}`));
        } catch (e) {
          out.errors.push(`${entry.name} — ${e.message}`);
        }
      }
    }
  };
  walk(dir);
  return out;
}

/** Télécharge les tables publiées (URL configurées) dans le dossier des correspondances. */
export async function downloadCorrespondences(urls = [], dir = CORRESPONDENCE_DIR) {
  const report = [];
  if (!urls.length) return report;
  const target = path.join(dir, 'telechargees');
  fs.mkdirSync(target, { recursive: true });
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const name = path.basename(new URL(url).pathname).replace(/[^\w.-]/g, '_') || 'table.csv';
      const { links } = parseCorrespondenceCsv(text, name);
      if (!links.length) throw new Error('aucune correspondance lisible');
      fs.writeFileSync(path.join(target, name.endsWith('.csv') ? name : `${name}.csv`), text);
      report.push({ url, links: links.length });
    } catch (e) {
      report.push({ url, error: e.message }); // un échec de téléchargement ne bloque jamais la synchronisation
    }
  }
  return report;
}

async function observedTotals(Model) {
  const rows = await Model.aggregate([
    { $group: { _id: { c: '$product', y: '$year', f: '$flow' }, v: { $sum: '$valueEur' }, q: { $sum: '$quantityKg' } } },
  ]).allowDiskUse(true);
  const totals = new Map();
  const years = new Map();
  let lastYear = 0;
  for (const r of rows) {
    totals.set(`${r._id.c}|${r._id.y}|${r._id.f}`, { v: r.v, q: r.q });
    if (!years.has(r._id.c)) years.set(r._id.c, new Set());
    if (r.v > 0 || r.q > 0) years.get(r._id.c).add(r._id.y);
    lastYear = Math.max(lastYear, r._id.y);
  }
  return { totals, yearsByCode: new Map([...years].map(([c, s]) => [c, [...s].sort((a, b) => a - b)])), lastYear };
}

/**
 * Synchronise un niveau de nomenclature.
 * @param {object} opts { level: 8 (Eurostat NC8) | 6 (monde SH6), dir }
 */
export async function syncNomenclature({ level = 8, dir = CORRESPONDENCE_DIR } = {}) {
  const Model = level === 8 ? TradeFlow : WorldFlow;
  const report = { level, files: [], fileErrors: [], official: 0, manual: 0, inferred: 0, implicit: 0, rejected: [], orphans: [], changedCodes: 0, updatedRows: 0 };

  const { totals, yearsByCode, lastYear } = await observedTotals(Model);
  if (!lastYear) return { ...report, empty: true };

  // 1. Liens officiels (fichiers) + manuels (base) + dérivés (SH6 depuis la NC8)
  const files = loadCorrespondenceFiles(dir);
  report.files = files.files;
  report.fileErrors = files.errors;
  const manual = await NcLink.find({ level, source: 'manual' }).lean();
  let base = [...files.links.filter((l) => l.level === level), ...manual];
  if (level === 6) {
    const cn8 = await NcLink.find({ level: 8 }).lean();
    base.push(...deriveHs6Links([...cn8, ...files.links.filter((l) => l.level === 8)]));
  }
  let { valid, rejected } = validateLinks(base, { level });
  report.rejected.push(...rejected.map((r) => ({ ...r.link, reason: r.reason })));

  // 2. Liens déduits des données (codes disparus remplacés par de nouveaux codes voisins)
  const { inferred, orphans } = inferLinks(yearsByCode, valid, { level, lastYear });
  ({ valid, rejected } = validateLinks([...valid, ...inferred], { level }));
  report.rejected.push(...rejected.filter((r) => r.link.source === 'inferred').map((r) => ({ ...r.link, reason: r.reason })));
  report.orphans = orphans;

  // 3. Continuations implicites puis pondération par les volumes
  const all = [...valid, ...implicitSelfLinks(valid, yearsByCode)];
  const weighted = computeWeights(all, (c, y, f) => totals.get(`${c}|${y}|${f}`));
  for (const l of weighted) report[l.source] = (report[l.source] || 0) + 1;

  await NcLink.deleteMany({ level });
  if (weighted.length) {
    await NcLink.insertMany(weighted.map((l) => ({ level, from: l.from, to: l.to, year: l.year, source: l.source, confidence: l.confidence ?? 1, estimated: Boolean(l.estimated), weights: l.weights, file: l.file })));
  }

  // 4. Cycle de vie des codes
  // Un code est « actuel » s'il a des données récentes ET :
  //  - qu'il n'a jamais été remplacé, ou
  //  - qu'il continue partiellement après son éclatement (lien vers lui-même), ou
  //  - qu'il a été réutilisé : ses nouvelles données reprennent après une interruption.
  // Des déclarations qui se poursuivent sans interruption sous un code remplacé sont un
  // reliquat (pays en retard) : elles sont rattachées aux successeurs.
  const recent = (c) => {
    const ys = yearsByCode.get(c) || [];
    return ys.includes(lastYear) || ys.includes(lastYear - 1);
  };
  const exitsOf = (c) => weighted.filter((l) => l.from === c && l.to !== c).map((l) => l.year);
  const active = (c) => {
    if (!recent(c)) return false;
    const exits = exitsOf(c);
    if (!exits.length) return true;
    const lastExit = Math.max(...exits);
    if (weighted.some((l) => l.from === c && l.to === c && l.year === lastExit)) return true;
    const ys = yearsByCode.get(c) || [];
    const later = ys.filter((y) => y >= lastExit);
    return later.length > 0 && later[0] > lastExit; // reprise après au moins une année sans données
  };
  const graph = new NcGraph(weighted, { isCurrent: active });
  if (level === 8) {
    const ops = [];
    for (const [code, ys] of yearsByCode) {
      if (!ys.length) continue;
      const status = active(code) ? 'current' : graph.hasChanged(code) ? 'obsolete' : 'discontinued';
      ops.push({ updateOne: { filter: { code }, update: { $set: { validFrom: ys[0], status, ...(status === 'current' ? {} : { validTo: ys.at(-1) }) }, ...(status === 'current' ? { $unset: { validTo: 1 } } : {}) } } });
    }
    if (ops.length) await Product.bulkWrite(ops, { ordered: false });
    // Codes du catalogue sans aucune donnée : hors des listes par défaut
    await Product.updateMany({ code: { $nin: [...yearsByCode.keys()] } }, { $set: { status: 'discontinued' } });
  }

  // 5. Codes actuels et facteurs de conversion sur chaque ligne
  const reset = await Model.updateMany(
    { $or: [{ tc: { $exists: false } }, { h: { $exists: true } }] },
    [{ $set: { tc: ['$product'] } }, { $unset: 'h' }]
  );
  report.updatedRows += reset.modifiedCount;
  const changed = graph.changedCodes();
  report.changedCodes = changed.filter((c) => graph.hasChanged(c)).length;
  for (const code of changed) {
    const exits = graph.exitYears(code);
    const bounds = [-Infinity, ...exits, Infinity];
    for (let k = 0; k < bounds.length - 1; k++) {
      const from = bounds[k];
      const to = bounds[k + 1];
      const sample = Number.isFinite(from) ? from : exits[0] - 1;
      for (const flow of ['import', 'export']) {
        const conv = graph.convert(code, sample, flow);
        if (conv.length === 1 && conv[0].t === code) continue; // inchangé
        const yearFilter = {};
        if (Number.isFinite(from)) yearFilter.$gte = from;
        if (Number.isFinite(to)) yearFilter.$lt = to;
        const res = await Model.updateMany(
          { product: code, flow, ...(Object.keys(yearFilter).length ? { year: yearFilter } : {}) },
          { $set: { tc: conv.map((c) => c.t), h: conv } }
        );
        report.updatedRows += res.modifiedCount;
      }
    }
  }
  return report;
}
