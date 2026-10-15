// Parseur JSON-stat 2.0 pour les réponses de l'API de diffusion Comext d'Eurostat.
// https://wikis.ec.europa.eu/display/EUROSTATHELP/API+SDMX+2.1+-+data+query

import { sectionOfChapter } from '../data/nomenclature.js';

const FLOW_CODES = { 1: 'import', 2: 'export' };

// Les jeux de données Comext n'utilisent pas tous les mêmes codes d'indicateurs.
const INDICATORS = {
  VALUE_IN_EUROS: { field: 'valueEur', factor: 1 },
  VALUE_EUR: { field: 'valueEur', factor: 1 },
  QUANTITY_IN_100KG: { field: 'quantityKg', factor: 100 },
  QUANTITY_IN_KG: { field: 'quantityKg', factor: 1 },
  QUANTITY_KG: { field: 'quantityKg', factor: 1 },
};

/** Liste ordonnée des codes d'une dimension JSON-stat. */
function categoryCodes(dimension) {
  const index = dimension.category.index;
  if (Array.isArray(index)) return index;
  if (index) return Object.entries(index).sort((a, b) => a[1] - b[1]).map(([code]) => code);
  return Object.keys(dimension.category.label || {});
}

/** Itère sur toutes les cellules non vides : yield { reporter: 'FR', product: '22042109', ..., value }. */
export function* cells(dataset) {
  const ids = dataset.id;
  const sizes = dataset.size;
  const codes = ids.map((id) => categoryCodes(dataset.dimension[id]));
  const values = dataset.value || {};
  const entries = Array.isArray(values) ? values.map((v, i) => [i, v]) : Object.entries(values);

  for (const [rawIndex, value] of entries) {
    if (value === null || value === undefined) continue;
    let rest = Number(rawIndex);
    const cell = { value: Number(value) };
    for (let d = ids.length - 1; d >= 0; d--) {
      cell[ids[d]] = codes[d][rest % sizes[d]];
      rest = Math.floor(rest / sizes[d]);
    }
    yield cell;
  }
}

/** "2023" -> { year: 2023 } ; "2023M01" / "2023-01" -> { year: 2023, month: 1 } */
export function parseTime(time) {
  const m = /^(\d{4})(?:[M-]?(\d{2}))?$/.exec(String(time));
  if (!m) return null;
  return { year: Number(m[1]), month: m[2] ? Number(m[2]) : null };
}

/**
 * Convertit un jeu JSON-stat Comext (annuel ou mensuel) en documents TradeFlow
 * (une ligne par déclarant × partenaire × produit × année × flux, avec le détail
 * mensuel dans `months` / `monthsKg`) et en libellés de nomenclature.
 */
export function toTradeFlows(dataset, { euCodes, extraEuOnly = true } = {}) {
  const rows = new Map();
  for (const cell of cells(dataset)) {
    const indicator = INDICATORS[cell.indicators];
    const flow = FLOW_CODES[cell.flow];
    const time = parseTime(cell.time);
    const product = String(cell.product);
    if (!indicator || !flow || !time || !/^\d{8}$/.test(product)) continue;
    const { year, month } = time;
    if (euCodes && !euCodes.has(cell.reporter)) continue;
    if (extraEuOnly && euCodes && euCodes.has(cell.partner)) continue;

    const key = [cell.reporter, cell.partner, product, year, flow].join('|');
    let row = rows.get(key);
    if (!row) {
      const chapter = product.slice(0, 2);
      row = {
        reporter: cell.reporter, partner: cell.partner, product, hs6: product.slice(0, 6), chapter,
        section: sectionOfChapter(chapter), year, flow, valueEur: 0, quantityKg: 0, source: 'eurostat',
      };
      rows.set(key, row);
    }
    const v = cell.value * indicator.factor;
    row[indicator.field] += v;
    if (month) {
      const arr = indicator.field === 'valueEur' ? 'months' : 'monthsKg';
      row.months ??= Array(12).fill(0);
      row.monthsKg ??= Array(12).fill(0);
      row[arr][month - 1] += v;
    }
  }

  const labels = dataset.dimension.product?.category?.label || {};
  const products = Object.entries(labels)
    .filter(([code]) => /^\d{8}$/.test(code))
    .map(([code, description]) => ({
      code, description, chapter: code.slice(0, 2), heading: code.slice(0, 4), section: sectionOfChapter(code.slice(0, 2)),
    }));

  // Libellés de tous les niveaux renvoyés (NC02, NC04, NC06, NC08).
  const nomenclature = Object.entries(labels)
    .filter(([code]) => /^(\d{2}|\d{4}|\d{6}|\d{8})$/.test(code))
    .map(([code, label]) => ({ code, level: code.length, label }));

  return { flows: [...rows.values()], products, nomenclature };
}
