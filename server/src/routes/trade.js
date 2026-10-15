import { Router } from 'express';
import { pagination, parseFilters, hasMonthBounds } from '../services/filters.js';
import { countryName } from '../services/labels.js';
import { buildScope } from '../services/scope.js';
import { audit } from '../services/audit.js';
import { getDataRange } from '../services/dataRange.js';
import { formatPeriod } from '../services/filters.js';
import { monthWindow, monthlyPage } from '../services/monthlyRows.js';
import { TradeFlow } from '../models/TradeFlow.js';

const router = Router();

const SORTABLE = { year: 'year', valueEur: 'valueEur', quantityKg: 'quantityKg', price: 'unitPrice', product: 'product', partner: 'partner', reporter: 'reporter' };

function sortSpec(query) {
  const field = SORTABLE[String(query.sort || 'valueEur')] || 'valueEur';
  const dir = String(query.order || 'desc') === 'asc' ? 1 : -1;
  // Départage par _id dans le même sens : le tri suit alors les index { champ: -1, _id: -1 }
  return { [field]: dir, _id: dir };
}

const unitPrice = { $addFields: { unitPrice: { $cond: [{ $gt: ['$quantityKg', 0] }, { $divide: ['$valueEur', '$quantityKg'] }, null] } } };
// Libellés ajoutés après tri et pagination (jointure limitée aux lignes affichées).
const lookupProduct = (collection) => [
  ...(collection === 'products'
    ? [{ $lookup: { from: 'products', localField: 'product', foreignField: 'code', as: 'p' } }]
    : [{ $lookup: { from: 'nomenclatures', localField: 'product', foreignField: 'code', as: 'p' } }]),
  {
    $project: {
      _id: 0, reporter: 1, partner: 1, product: 1, chapter: 1, section: 1, year: 1, flow: 1, source: 1, mirror: 1,
      valueEur: { $round: ['$valueEur', 0] }, quantityKg: { $round: ['$quantityKg', 0] }, unitPrice: { $round: ['$unitPrice', 4] },
      months: 1, share: { $ifNull: ['$_fv', 1] }, tc: 1, quality: 1,
      description: { $ifNull: [{ $first: '$p.description' }, { $ifNull: [{ $first: '$p.label' }, ''] }] },
    },
  },
];

const COUNT_CAP = 100000;

/**
 * Lignes triées : quand aucune étape ne modifie les valeurs (pas de période partielle ni de
 * conversion), le filtre et le tri passent en tête pour profiter des index (tri par valeur,
 * année… sans trier toute la table).
 */
function sortedRows(s, pre, query, page) {
  const sort = { $sort: sortSpec(query) };
  if (s.pre.length || sortSpec(query).unitPrice) return [{ $match: s.match }, ...pre, unitPrice, sort, ...page];
  // « valeur ou quantité non nulle » écrit sans $or : le tri peut alors suivre l'index
  const nonZero = { $nor: [{ valueEur: { $lte: 0 }, quantityKg: { $lte: 0 } }] };
  const match = pre.length ? { $and: [s.match, nonZero] } : s.match;
  return [{ $match: match }, sort, ...page, unitPrice];
}

async function rowsPipeline(req) {
  const f = parseFilters(req.query);
  const source = req.query.source === 'world' ? 'world' : 'eu';
  const s = await buildScope(f, { source, raw: req.query.nc === 'brut' });
  const pre = [...s.pre];
  if (hasMonthBounds(f) || s.mode !== 'raw') pre.push({ $match: { $or: [{ valueEur: { $gt: 0 } }, { quantityKg: { $gt: 0 } }] } });
  return { f, s, pre, source };
}

// Tableau détaillé des flux, filtré, trié et paginé. En nomenclature actuelle, une ligne déclarée
// sous un ancien code apparaît avec la part convertie vers le code demandé (`declaredAs`, `share`).
router.get('/', async (req, res) => {
  const { f, s, pre, source } = await rowsPipeline(req);
  const { page, limit, skip } = pagination(req.query);
  // Nombre de lignes : instantané sans filtre (estimation), plafonné sinon (affiché « 100 000+ »)
  const count = !Object.keys(s.match).length && !s.pre.length
    ? s.Model.estimatedDocumentCount()
    : s.Model.aggregate([{ $match: s.match }, ...pre, { $limit: COUNT_CAP + 1 }, { $count: 'n' }]).then((r) => r[0]?.n ?? 0);
  const [counted, rows] = await Promise.all([
    count,
    s.Model.aggregate([...sortedRows(s, pre, req.query, [{ $skip: skip }, { $limit: limit }]), ...lookupProduct(source === 'eu' ? 'products' : 'nomenclatures')]),
  ]);
  const capped = counted > COUNT_CAP;
  const total = Math.min(counted, COUNT_CAP);
  res.json({
    page, limit, total, capped, pages: Math.ceil(total / limit), nomenclature: s.mode,
    rows: rows.map(({ months, tc, ...r }) => ({
      ...r,
      share: Math.round(r.share * 10000) / 10000,
      currentCodes: tc && (tc.length > 1 || tc[0] !== r.product) ? tc : undefined,
      monthly: hasMonthBounds(f) ? undefined : months,
      reporterName: countryName(r.reporter),
      partnerName: countryName(r.partner),
    })),
  });
});

function csvCell(v) {
  const s = String(v ?? '');
  // Neutralise les formules (injection CSV) et échappe les guillemets.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

// Export CSV (séparateur « ; » pour Excel FR), plafonné selon l'offre.
router.get('/export.csv', async (req, res) => {
  const { s, pre, source } = await rowsPipeline(req);
  const max = req.access.exportLimit;
  audit(req, { action: 'export.csv', category: 'export', message: `Export CSV des lignes détaillées (max ${max} lignes)`, details: req.query });
  const cursor = s.Model.aggregate([...sortedRows(s, pre, req.query, [{ $limit: max }]), ...lookupProduct(source === 'eu' ? 'products' : 'nomenclatures')]).allowDiskUse(true).cursor();

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="donnees-douanieres.csv"');
  res.write('﻿annee;flux;declarant;partenaire;code_declare;codes_actuels;part_convertie;description;chapitre;valeur_eur;quantite_kg;prix_eur_kg;source\n');
  for await (const r of cursor) {
    res.write(
      [r.year, r.flow, r.reporter, r.partner, r.product, (r.tc || [r.product]).join(' '), r.share, r.description, r.chapter, r.valueEur, r.quantityKg, r.unitPrice ?? '', r.source]
        .map(csvCell)
        .join(';') + '\n'
    );
  }
  res.end();
});

// --- Vue mensuelle : une ligne = un flux sur un mois, la déclaration la plus récente d'abord
const MONTH_SORTS = ['recent', 'value', 'quantity', 'price'];
async function monthlyRequest(req) {
  const f = parseFilters(req.query);
  const window = monthWindow(f, await getDataRange(TradeFlow));
  const scope = await buildScope(f, { raw: req.query.nc === 'brut', noPeriodSlice: true });
  const sort = MONTH_SORTS.includes(req.query.sort) ? req.query.sort : 'recent';
  return { f, window, scope, sort, order: req.query.order === 'asc' ? 'asc' : 'desc' };
}
const rowView = (r) => ({
  ...r, period: `${r.year}-${String(r.month).padStart(2, '0')}`,
  reporterName: countryName(r.reporter), partnerName: countryName(r.partner),
  currentCodes: r.tc && (r.tc.length > 1 || r.tc[0] !== r.product) ? r.tc : undefined, tc: undefined,
});

router.get('/mois', async (req, res) => {
  const { f, window, scope, sort, order } = await monthlyRequest(req);
  if (!window) return res.json({ rows: [], total: 0, page: 1, pages: 0 });
  const { page, limit, skip } = pagination(req.query, { defaultLimit: 50, maxLimit: 500 });
  const r = await monthlyPage({ f, scope, window, sort, order, skip, limit });
  res.json({
    page, limit, total: r.total, capped: r.capped, pages: Math.ceil(r.total / limit), sort, order,
    window: { from: formatPeriod(window.from), to: formatPeriod(window.to), clamped: window.clamped, kind: window.kind },
    rows: r.rows.map(rowView),
  });
});

router.get('/mois.csv', async (req, res) => {
  const { f, window, scope, sort, order } = await monthlyRequest(req);
  const max = req.access.exportLimit;
  audit(req, { action: 'export.csv', category: 'export', message: `Export CSV des lignes mensuelles (max ${max} lignes)`, details: req.query });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="declarations-mensuelles.csv"');
  res.write('\ufeffmois;annee;flux;declarant;partenaire;code_nc;designation;valeur_eur;quantite_kg;prix_eur_kg\n');
  if (window) {
    const { rows } = await monthlyPage({ f, scope, window, sort, order, skip: 0, limit: max, cap: 0 });
    for (const r of rows.map(rowView)) {
      res.write(`${[r.period, r.year, r.flow === 'import' ? 'importation' : 'exportation', r.reporterName, r.partnerName, r.product, r.description, r.valueEur, r.quantityKg, r.unitPrice ?? ''].map(csvCell).join(';')}\n`);
    }
  }
  res.end();
});

export default router;
