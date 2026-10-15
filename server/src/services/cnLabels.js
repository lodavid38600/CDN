// Libellés de la nomenclature combinée et recherche des produits par mots.
//
// Le fichier officiel (tableau annuel de la NC8 publié par la douane, ou liste Eurostat) peut être
// importé tel quel : CSV, TSV, texte ou classeur Excel .xlsx. La colonne du code (2, 4, 6 ou
// 8 chiffres, espaces et points tolérés) et celle du libellé sont reconnues automatiquement ;
// si le fichier contient un libellé « autosuffisant » (compréhensible seul), il est préféré.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { Product } from '../models/Product.js';
import { Nomenclature } from '../models/Nomenclature.js';
import { CHAPTERS } from '../data/nomenclature.js';

const require = createRequire(import.meta.url);

/** Texte normalisé : minuscules, sans accents ni ponctuation. */
export const normalize = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// --- Lecture des fichiers
function splitCsv(line, sep) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') quoted = false; else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}

function decodeText(buf) {
  const utf8 = buf.toString('utf8');
  // Fichiers Excel « CSV » enregistrés en Windows-1252 : caractères invalides en UTF-8
  return utf8.includes('�') ? buf.toString('latin1') : utf8;
}

function rowsFromText(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const sample = lines.slice(0, 20).join('\n');
  const sep = ['\t', ';', '|', ','].map((s) => [s, sample.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  return lines.map((l) => splitCsv(l, sep));
}

const xmlText = (s) => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Première feuille d'un classeur .xlsx (archive zip de fichiers XML), lue avec 7-Zip. */
function rowsFromXlsx(file) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-'));
  try {
    const za = require('7zip-bin').path7za;
    try { fs.chmodSync(za, 0o755); } catch { /* déjà exécutable */ }
    execFileSync(za, ['x', '-y', `-o${dir}`, file, 'xl/sharedStrings.xml', 'xl/worksheets/*.xml', 'xl/workbook.xml'], { stdio: 'ignore' });
    const shared = [];
    const ssPath = path.join(dir, 'xl', 'sharedStrings.xml');
    if (fs.existsSync(ssPath)) for (const m of fs.readFileSync(ssPath, 'utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(xmlText(m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, '')));
    const sheets = fs.readdirSync(path.join(dir, 'xl', 'worksheets')).filter((f) => f.endsWith('.xml')).sort();
    const xml = fs.readFileSync(path.join(dir, 'xl', 'worksheets', sheets[0]), 'utf8');
    const col = (ref) => [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    const rows = [];
    for (const r of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const row = [];
      for (const c of r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = /r="([A-Z]+)\d+"/.exec(c[1])?.[1];
        const type = /t="(\w+)"/.exec(c[1])?.[1];
        const inner = c[2] || '';
        let v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '';
        if (type === 's') v = shared[Number(v)] ?? '';
        else if (type === 'inlineStr') v = xmlText(/<is>([\s\S]*?)<\/is>/.exec(inner)?.[1] || '');
        else v = xmlText(v);
        if (ref) row[col(ref)] = v;
      }
      rows.push(Array.from(row, (x) => x ?? ''));
    }
    return rows;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Lignes d'un fichier de libellés, quel que soit son format. */
export function readTable(file) {
  const head = fs.readFileSync(file).subarray(0, 4);
  if (head[0] === 0x50 && head[1] === 0x4b) return rowsFromXlsx(file); // « PK » : classeur .xlsx
  if (head[0] === 0xd0 && head[1] === 0xcf) throw new Error('Ancien format Excel (.xls) : ouvrez le fichier dans Excel et enregistrez-le en .xlsx ou en CSV.');
  return rowsFromText(decodeText(fs.readFileSync(file)));
}

const codeOf = (cell) => {
  const d = String(cell || '').replace(/[\s. ]/g, '');
  return /^\d+$/.test(d) && [2, 4, 6, 8].includes(d.length) ? d : null;
};

/**
 * Extrait les couples (code, libellé). Colonne du code : celle qui contient le plus de codes ;
 * colonne du libellé : en-tête « autosuffisant » s'il existe, sinon la colonne de texte la plus longue.
 */
export function extractLabels(rows) {
  const width = Math.max(...rows.slice(0, 200).map((r) => r.length));
  const sample = rows.slice(0, 500);
  const codeCol = [...Array(width).keys()].map((c) => [c, sample.filter((r) => codeOf(r[c])).length]).sort((a, b) => b[1] - a[1])[0];
  if (!codeCol || codeCol[1] === 0) throw new Error('Aucune colonne de codes NC (2, 4, 6 ou 8 chiffres) trouvée dans le fichier');
  const header = rows.find((r) => !codeOf(r[codeCol[0]]) && r.some((x) => /[a-z]/i.test(x))) || [];
  const textCols = [...Array(width).keys()].filter((c) => c !== codeCol[0]);
  const autoCol = textCols.find((c) => /autosuff|self.?expl/i.test(header[c] || ''));
  const avgLen = (c) => sample.reduce((s, r) => s + (codeOf(r[codeCol[0]]) && !/^\d/.test(r[c] || '') ? String(r[c] || '').length : 0), 0);
  const labelCol = autoCol ?? textCols.sort((a, b) => avgLen(b) - avgLen(a))[0];
  const out = new Map();
  for (const r of rows) {
    const code = codeOf(r[codeCol[0]]);
    const label = String(r[labelCol] || '').replace(/^[-–\s]+/, '').replace(/\s+/g, ' ').trim();
    if (code && label && !out.has(code)) out.set(code, label);
  }
  return out;
}

/**
 * Importe les libellés. replaceAll = false : seuls les libellés provisoires (« Code NC … ») sont remplacés.
 */
export async function importLabels(file, { replaceAll = true } = {}) {
  const labels = extractLabels(readTable(file));
  if (!labels.size) throw new Error('Aucun libellé trouvé');
  const entries = [...labels.entries()];
  for (let i = 0; i < entries.length; i += 5000) {
    await Nomenclature.bulkWrite(entries.slice(i, i + 5000).map(([code, label]) => ({
      updateOne: { filter: { code }, update: { $set: { code, level: code.length, label } }, upsert: true },
    })), { ordered: false });
  }
  const cn8 = entries.filter(([c]) => c.length === 8);
  let updated = 0;
  for (let i = 0; i < cn8.length; i += 5000) {
    const r = await Product.bulkWrite(cn8.slice(i, i + 5000).map(([code, label]) => ({
      updateOne: { filter: replaceAll ? { code } : { code, description: /^Code NC / }, update: { $set: { description: label } } },
    })), { ordered: false });
    updated += r.modifiedCount;
  }
  const search = await refreshSearchText();
  return { labels: labels.size, byLevel: Object.fromEntries([2, 4, 6, 8].map((l) => [l, entries.filter(([c]) => c.length === l).length])), productsUpdated: updated, searchIndexed: search };
}

/** Recalcule le texte de recherche de chaque produit (désignation + libellés parents). */
export async function refreshSearchText() {
  const parents = new Map((await Nomenclature.find({ level: { $in: [4, 6] } }, { code: 1, label: 1 }).lean()).map((n) => [n.code, n.label]));
  const ops = [];
  let n = 0;
  for await (const p of Product.find({}, { code: 1, description: 1, st: 1 }).lean().cursor()) {
    const st = normalize([p.description, parents.get(p.code.slice(0, 6)), parents.get(p.code.slice(0, 4)), CHAPTERS[p.code.slice(0, 2)]].filter(Boolean).join(' '));
    if (st !== p.st) ops.push({ updateOne: { filter: { _id: p._id }, update: { $set: { st } } } });
    if (ops.length >= 5000) { n += (await Product.bulkWrite(ops.splice(0), { ordered: false })).modifiedCount; }
  }
  if (ops.length) n += (await Product.bulkWrite(ops, { ordered: false })).modifiedCount;
  return n;
}

/** Recherche par mots (tous les mots, dans n'importe quel ordre, accents ignorés) ou par début de code. */
export async function searchProducts(q, { limit = 10, current = true } = {}) {
  const digits = String(q).replace(/[\s.]/g, '');
  const base = current ? { status: { $ne: 'obsolete' } } : {};
  if (/^\d+$/.test(digits)) return Product.find({ ...base, code: { $regex: `^${digits}` } }, { _id: 0, code: 1, description: 1, status: 1 }).sort({ code: 1 }).limit(limit).lean();
  const words = normalize(q).split(' ').filter((w) => w.length >= 2).slice(0, 6);
  if (!words.length) return [];
  const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rows = await Product.find({ ...base, $and: words.map((w) => ({ st: { $regex: `(^|\\s)${esc(w)}` } })) }, { _id: 0, code: 1, description: 1, status: 1, st: 1 }).limit(400).lean();
  // Classement : mots présents dans la désignation du code d'abord, puis désignation la plus courte
  const score = (p) => {
    const d = normalize(p.description);
    return words.filter((w) => d.includes(w)).length * 1000 - d.length;
  };
  return rows.sort((a, b) => score(b) - score(a)).slice(0, limit).map(({ st, ...p }) => p);
}
