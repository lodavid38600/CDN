import { Router } from 'express';
import { TradeFlow } from '../models/TradeFlow.js';
import { buildMatch, parseFilters, FilterError } from '../services/filters.js';
import { attachLabels } from '../services/labels.js';

const router = Router();

// Les flux import/export sont toujours renvoyés côte à côte : le filtre `flow`
// sert uniquement au tri des classements.
const sumByFlow = {
  importEur: { $sum: { $cond: [{ $eq: ['$flow', 'import'] }, '$valueEur', 0] } },
  exportEur: { $sum: { $cond: [{ $eq: ['$flow', 'export'] }, '$valueEur', 0] } },
  importKg: { $sum: { $cond: [{ $eq: ['$flow', 'import'] }, '$quantityKg', 0] } },
  exportKg: { $sum: { $cond: [{ $eq: ['$flow', 'export'] }, '$quantityKg', 0] } },
};

function withBalance(row) {
  return { ...row, balanceEur: row.exportEur - row.importEur, totalEur: row.exportEur + row.importEur };
}

// Indicateurs clés sur la période filtrée + variation de la dernière année.
router.get('/summary', async (req, res) => {
  const f = parseFilters(req.query);
  const match = buildMatch(f, { omit: ['flow'] });
  const [totals] = await TradeFlow.aggregate([
    { $match: match },
    { $group: { _id: null, ...sumByFlow, products: { $addToSet: '$product' }, years: { $addToSet: '$year' } } },
    {
      $project: {
        _id: 0, importEur: 1, exportEur: 1, importKg: 1, exportKg: 1,
        productCount: { $size: '$products' }, years: 1,
      },
    },
  ]);
  if (!totals) {
    return res.json({ importEur: 0, exportEur: 0, balanceEur: 0, totalEur: 0, productCount: 0, latestYear: null });
  }

  const years = totals.years.sort((a, b) => a - b);
  const latestYear = years.at(-1);
  const byYear = await TradeFlow.aggregate([
    { $match: { ...match, year: { $in: [latestYear, latestYear - 1] } } },
    { $group: { _id: '$year', ...sumByFlow } },
  ]);
  const cur = byYear.find((r) => r._id === latestYear);
  const prev = byYear.find((r) => r._id === latestYear - 1);
  const change = (key) => (prev && prev[key] ? (cur[key] - prev[key]) / prev[key] : null);

  delete totals.years;
  res.json({
    ...withBalance(totals),
    latestYear,
    latest: cur ? withBalance({ importEur: cur.importEur, exportEur: cur.exportEur }) : null,
    changeImport: change('importEur'),
    changeExport: change('exportEur'),
  });
});

// Évolution annuelle import / export.
router.get('/timeseries', async (req, res) => {
  const f = parseFilters(req.query);
  const rows = await TradeFlow.aggregate([
    { $match: buildMatch(f, { omit: ['flow'] }) },
    { $group: { _id: '$year', ...sumByFlow } },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, year: '$_id', importEur: 1, exportEur: 1, importKg: 1, exportKg: 1 } },
  ]);
  res.json(rows.map(withBalance));
});

const DIMENSIONS = ['partner', 'reporter', 'product', 'chapter', 'section'];

// Classement par dimension (partenaires, pays déclarants, codes NC, chapitres, sections).
router.get('/top', async (req, res) => {
  const f = parseFilters(req.query);
  const dimension = String(req.query.dimension || 'partner');
  if (!DIMENSIONS.includes(dimension)) throw new FilterError(`dimension doit être parmi ${DIMENSIONS.join(', ')}`);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
  const sortKey = f.flow === 'import' ? 'importEur' : f.flow === 'export' ? 'exportEur' : 'totalEur';

  const rows = await TradeFlow.aggregate([
    { $match: buildMatch(f, { omit: ['flow'] }) },
    { $group: { _id: `$${dimension}`, ...sumByFlow } },
    { $addFields: { totalEur: { $add: ['$importEur', '$exportEur'] } } },
    { $sort: { [sortKey]: -1 } },
    { $limit: limit },
    { $project: { _id: 0, key: '$_id', importEur: 1, exportEur: 1, importKg: 1, exportKg: 1 } },
  ]);
  res.json(await attachLabels(rows.map(withBalance), dimension));
});

export default router;
