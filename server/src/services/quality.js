// Contrôles de qualité appliqués à toute donnée entrante (Eurostat, sources nationales, démo).
// Une ligne invalide n'est jamais insérée : elle part en quarantaine avec la raison du rejet.
import { EU_CODES, ALL_CODES } from '../data/countries.js';
import { sectionOfChapter } from '../data/nomenclature.js';
import { Rejected } from '../models/System.js';

const FLOWS = new Set(['import', 'export']);
const finite = (x) => typeof x === 'number' && Number.isFinite(x);

/**
 * Vérifie et normalise une ligne de commerce.
 * @param {object} d ligne brute
 * @param {object} opts { level: 8 (NC8, Eurostat) | 6 (SH6, monde), now: Date }
 * @returns {{ ok: boolean, doc?: object, errors: string[], warnings: string[] }}
 */
export function checkFlow(d, { level = 8, now = new Date() } = {}) {
  const errors = [];
  const warnings = [];
  if (!d || typeof d !== 'object') return { ok: false, errors: ['ligne vide'], warnings };
  const code = String(d.product ?? '').replace(/[\s.]/g, '');
  const reporter = String(d.reporter ?? '').toUpperCase();
  const partner = String(d.partner ?? '').toUpperCase();
  const year = Number(d.year);

  if (!new RegExp(`^\\d{${level}}$`).test(code)) errors.push(`code produit invalide (${d.product})`);
  if (level === 8 && !EU_CODES.has(reporter)) errors.push(`déclarant hors UE (${d.reporter})`);
  if (level === 6 && !ALL_CODES.has(reporter)) errors.push(`déclarant inconnu (${d.reporter})`);
  if (!ALL_CODES.has(partner)) errors.push(`partenaire inconnu (${d.partner})`);
  if (level === 8 && EU_CODES.has(partner)) errors.push(`partenaire membre de l'UE (${d.partner}) : hors périmètre extra-UE`);
  if (reporter && reporter === partner) errors.push('déclarant identique au partenaire');
  if (!FLOWS.has(d.flow)) errors.push(`flux invalide (${d.flow})`);
  if (!Number.isInteger(year) || year < 1988 || year > now.getFullYear()) errors.push(`année invalide (${d.year})`);

  let months = d.months;
  let monthsKg = d.monthsKg;
  for (const [name, arr] of [['months', months], ['monthsKg', monthsKg]]) {
    if (arr === undefined || arr === null) continue;
    if (!Array.isArray(arr) || arr.length !== 12) errors.push(`${name} doit contenir 12 valeurs`);
    else if (arr.some((x) => !finite(x) || x < 0)) errors.push(`${name} contient des valeurs négatives ou non numériques`);
  }
  if (months !== undefined && monthsKg === undefined) monthsKg = Array(12).fill(0);
  if (monthsKg !== undefined && months === undefined) months = Array(12).fill(0);

  let valueEur = d.valueEur;
  let quantityKg = d.quantityKg ?? 0;
  if (Array.isArray(months) && months.length === 12 && !errors.length) {
    // Aucune valeur dans le futur
    if (year === now.getFullYear() && months.some((v, i) => i > now.getMonth() && v > 0)) errors.push('valeurs pour des mois futurs');
    // Les totaux annuels sont toujours la somme des mois (on corrige les écarts)
    const sv = months.reduce((a, b) => a + b, 0);
    const sq = monthsKg.reduce((a, b) => a + b, 0);
    if (finite(valueEur) && Math.abs(sv - valueEur) > Math.max(1, sv * 0.005)) warnings.push('total annuel corrigé (somme des mois)');
    valueEur = sv;
    quantityKg = sq;
  }
  if (!finite(valueEur) || valueEur < 0) errors.push(`valeur invalide (${d.valueEur})`);
  if (!finite(quantityKg) || quantityKg < 0) errors.push(`quantité invalide (${d.quantityKg})`);
  if (errors.length) return { ok: false, errors, warnings };
  if (valueEur === 0 && quantityKg === 0) return { ok: false, errors: ['ligne vide (valeur et quantité nulles)'], warnings };

  const quality = [];
  const chapter = code.slice(0, 2);
  if (quantityKg > 0 && valueEur === 0) quality.push('valeur-nulle');
  if (valueEur > 0 && quantityKg === 0) quality.push('quantite-absente');
  // Prix unitaire aberrant (hors métaux et pierres précieuses, objets d'art)
  const unit = quantityKg > 0 ? valueEur / quantityKg : null;
  if (unit !== null && !['71', '97'].includes(chapter) && (unit > 1e6 || unit < 1e-4)) quality.push('prix-unitaire-aberrant');

  const doc = {
    ...d,
    reporter, partner, product: code, hs6: code.slice(0, 6), chapter, section: sectionOfChapter(chapter), year,
    valueEur, quantityKg, ...(months ? { months, monthsKg } : {}),
    ...(quality.length ? { quality } : {}),
  };
  if (!doc.section) return { ok: false, errors: [`chapitre inconnu (${chapter})`], warnings };
  return { ok: true, doc, errors, warnings };
}

/** Filtre un lot : renvoie les lignes valides et met les autres en quarantaine. */
export async function screen(records, { source, level = 8, persist = true } = {}) {
  const valid = [];
  const rejected = [];
  let corrected = 0;
  for (const r of records) {
    const res = checkFlow(r, { level });
    if (res.ok) {
      valid.push(res.doc);
      if (res.warnings.length) corrected += 1;
    } else rejected.push({ source, reasons: res.errors, record: r });
  }
  if (persist && rejected.length) await Rejected.insertMany(rejected.slice(0, 5000), { ordered: false }).catch(() => {});
  return { valid, rejected, corrected };
}
