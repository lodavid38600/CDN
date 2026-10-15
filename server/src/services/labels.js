import { ALL_COUNTRIES } from '../data/countries.js';
import { CHAPTERS, SECTIONS } from '../data/nomenclature.js';
import { Product } from '../models/Product.js';
import { Nomenclature } from '../models/Nomenclature.js';

const COUNTRY_NAMES = Object.fromEntries(ALL_COUNTRIES.map((c) => [c.code, c.name]));
const SECTION_NAMES = Object.fromEntries(SECTIONS.map((s) => [s.code, s.label]));

export const countryName = (code) => COUNTRY_NAMES[code] || code;
export const chapterName = (code) => CHAPTERS[code] || `Chapitre ${code}`;
export const sectionName = (code) => SECTION_NAMES[code] || `Section ${code}`;

/** Libellés NC06 : table de nomenclature, à défaut la désignation du premier code NC8. */
export async function hs6Labels(codes) {
  const out = {};
  const docs = await Nomenclature.find({ code: { $in: codes } }, { code: 1, label: 1 }).lean();
  for (const d of docs) out[d.code] = d.label;
  const missing = codes.filter((c) => !out[c]);
  if (missing.length) {
    const products = await Product.find({ code: { $regex: `^(${missing.join('|')})` } }, { code: 1, description: 1 }).sort({ code: 1 }).lean();
    for (const p of products) out[p.code.slice(0, 6)] ??= p.description;
  }
  return out;
}

/** Ajoute un champ `label` à chaque ligne selon la dimension. */
export async function attachLabels(rows, dimension) {
  if (dimension === 'product') {
    const products = await Product.find({ code: { $in: rows.map((r) => r.key) } }, { code: 1, description: 1 }).lean();
    const byCode = Object.fromEntries(products.map((p) => [p.code, p.description]));
    return rows.map((r) => ({ ...r, label: byCode[r.key] || r.key }));
  }
  if (dimension === 'hs6') {
    const labels = await hs6Labels(rows.map((r) => r.key).filter((k) => /^\d{6}$/.test(k)));
    return rows.map((r) => ({ ...r, label: labels[r.key] || r.key }));
  }
  const fn = { partner: countryName, reporter: countryName, chapter: chapterName, section: sectionName }[dimension];
  return rows.map((r) => ({ ...r, label: fn ? fn(r.key) : r.key }));
}
