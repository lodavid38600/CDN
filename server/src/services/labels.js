import { ALL_COUNTRIES } from '../data/countries.js';
import { CHAPTERS, SECTIONS } from '../data/nomenclature.js';
import { Product } from '../models/Product.js';

const COUNTRY_NAMES = Object.fromEntries(ALL_COUNTRIES.map((c) => [c.code, c.name]));
const SECTION_NAMES = Object.fromEntries(SECTIONS.map((s) => [s.code, s.label]));

export const countryName = (code) => COUNTRY_NAMES[code] || code;
export const chapterName = (code) => CHAPTERS[code] || `Chapitre ${code}`;
export const sectionName = (code) => SECTION_NAMES[code] || `Section ${code}`;

/** Ajoute un champ `label` à chaque ligne selon la dimension. */
export async function attachLabels(rows, dimension) {
  if (dimension === 'product') {
    const products = await Product.find({ code: { $in: rows.map((r) => r.key) } }, { code: 1, description: 1 }).lean();
    const byCode = Object.fromEntries(products.map((p) => [p.code, p.description]));
    return rows.map((r) => ({ ...r, label: byCode[r.key] || r.key }));
  }
  const fn = { partner: countryName, reporter: countryName, chapter: chapterName, section: sectionName }[dimension];
  return rows.map((r) => ({ ...r, label: fn ? fn(r.key) : r.key }));
}
