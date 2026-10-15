import { Router } from 'express';
import { Product } from '../models/Product.js';
import { TradeFlow } from '../models/TradeFlow.js';
import { pagination, parseFilters, buildMatch, FilterError } from '../services/filters.js';
import { chapterName, hs6Labels, sectionName } from '../services/labels.js';

const router = Router();

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Catalogue des codes NC : recherche plein texte / par code, filtrage par catégorie.
router.get('/', async (req, res) => {
  const f = parseFilters({ sections: req.query.sections, chapters: req.query.chapters });
  const { page, limit, skip } = pagination(req.query, { defaultLimit: 25, maxLimit: 200 });
  const q = String(req.query.q || '').trim().slice(0, 100);

  const match = {};
  if (f.sections) match.section = { $in: f.sections };
  if (f.chapters) match.chapter = { $in: f.chapters };
  if (q) {
    const digits = q.replace(/[\s.]/g, '');
    match.$or = /^\d+$/.test(digits)
      ? [{ code: { $regex: `^${digits}` } }]
      : [{ description: { $regex: escapeRegex(q), $options: 'i' } }];
  }
  const [total, rows] = await Promise.all([
    Product.countDocuments(match),
    Product.find(match, { _id: 0, __v: 0, createdAt: 0, updatedAt: 0 }).sort({ code: 1 }).skip(skip).limit(limit).lean(),
  ]);
  res.json({
    page, limit, total, pages: Math.ceil(total / limit),
    rows: rows.map((p) => ({ ...p, chapterLabel: chapterName(p.chapter), sectionLabel: sectionName(p.section) })),
  });
});

// Fiche d'un code NC.
router.get('/:code', async (req, res) => {
  const code = String(req.params.code).replace(/[\s.]/g, '');
  if (!/^\d{8}$/.test(code)) throw new FilterError('Le code NC doit comporter 8 chiffres');
  const product = await Product.findOne({ code }, { _id: 0, __v: 0 }).lean();
  if (!product) return res.status(404).json({ error: 'Code NC introuvable' });

  const f = parseFilters({ ...req.query, product: code });
  const years = await TradeFlow.distinct('year', buildMatch(f, { omit: ['flow'] }));
  const hs6 = await hs6Labels([product.code.slice(0, 6)]);
  res.json({
    hs6: product.code.slice(0, 6),
    hs6Label: hs6[product.code.slice(0, 6)] || '',
    ...product,
    chapterLabel: chapterName(product.chapter),
    sectionLabel: sectionName(product.section),
    years: years.sort((a, b) => a - b),
  });
});

export default router;
