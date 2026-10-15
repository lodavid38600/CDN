import { Router } from 'express';
import { pagination, parseFilters, hasMonthBounds } from '../services/filters.js';
import { countryName } from '../services/labels.js';
import { buildScope } from '../services/scope.js';
import { config } from '../config.js';

const router = Router();

const SORTABLE = { year: 'year', valueEur: 'valueEur', quantityKg: 'quantityKg', price: 'unitPrice', product: 'product', partner: 'partner', reporter: 'reporter' };

function sortSpec(query) {
  const field = SORTABLE[String(query.sort || 'valueEur')] || 'valueEur';
  const dir = String(query.order || 'desc') === 'asc' ? 1 : -1;
  return { [field]: dir, _id: 1 };
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
  const [total, rows] = await Promise.all([
    s.Model.aggregate([{ $match: s.match }, ...pre, { $count: 'n' }]).then((r) => r[0]?.n ?? 0),
    s.Model.aggregate([{ $match: s.match }, ...pre, unitPrice, { $sort: sortSpec(req.query) }, { $skip: skip }, { $limit: limit }, ...lookupProduct(source === 'eu' ? 'products' : 'nomenclatures')]),
  ]);
  res.json({
    page, limit, total, pages: Math.ceil(total / limit), nomenclature: s.mode,
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
  const max = config.exportLimits[req.user.plan] ?? config.exportLimits.free;
  const cursor = s.Model.aggregate([{ $match: s.match }, ...pre, unitPrice, { $sort: sortSpec(req.query) }, { $limit: max }, ...lookupProduct(source === 'eu' ? 'products' : 'nomenclatures')]).allowDiskUse(true).cursor();

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

export default router;
