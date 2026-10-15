import { Router } from 'express';
import { TradeFlow } from '../models/TradeFlow.js';
import { buildMatch, pagination, parseFilters } from '../services/filters.js';
import { countryName } from '../services/labels.js';
import { config } from '../config.js';

const router = Router();

const SORTABLE = { year: 'year', valueEur: 'valueEur', quantityKg: 'quantityKg', product: 'product', partner: 'partner', reporter: 'reporter' };

function sortSpec(query) {
  const field = SORTABLE[String(query.sort || 'valueEur')] || 'valueEur';
  const dir = String(query.order || 'desc') === 'asc' ? 1 : -1;
  return { [field]: dir, _id: 1 };
}

const lookupProduct = [
  { $lookup: { from: 'products', localField: 'product', foreignField: 'code', as: 'p' } },
  {
    $project: {
      _id: 0, reporter: 1, partner: 1, product: 1, chapter: 1, section: 1, year: 1, flow: 1,
      valueEur: 1, quantityKg: 1, description: { $ifNull: [{ $first: '$p.description' }, ''] },
    },
  },
];

// Tableau détaillé des flux, filtré, trié et paginé.
router.get('/', async (req, res) => {
  const f = parseFilters(req.query);
  const match = buildMatch(f);
  const { page, limit, skip } = pagination(req.query);
  const [total, rows] = await Promise.all([
    TradeFlow.countDocuments(match),
    TradeFlow.aggregate([{ $match: match }, { $sort: sortSpec(req.query) }, { $skip: skip }, { $limit: limit }, ...lookupProduct]),
  ]);
  res.json({
    page, limit, total, pages: Math.ceil(total / limit),
    rows: rows.map((r) => ({ ...r, reporterName: countryName(r.reporter), partnerName: countryName(r.partner) })),
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
  const f = parseFilters(req.query);
  const max = config.exportLimits[req.user.plan] ?? config.exportLimits.free;
  const cursor = TradeFlow.aggregate([{ $match: buildMatch(f) }, { $sort: sortSpec(req.query) }, { $limit: max }, ...lookupProduct]).cursor();

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="donnees-douanieres.csv"');
  res.write('﻿annee;flux;declarant;partenaire;code_nc;description;chapitre;section;valeur_eur;quantite_kg\n');
  for await (const r of cursor) {
    res.write(
      [r.year, r.flow, r.reporter, r.partner, r.product, r.description, r.chapter, r.section, r.valueEur, r.quantityKg]
        .map(csvCell)
        .join(';') + '\n'
    );
  }
  res.end();
});

export default router;
