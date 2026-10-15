import { Router } from 'express';
import { TradeFlow } from '../models/TradeFlow.js';
import {
  buildMatch, parseFilters, FilterError, valueStages, periodKey,
  formatPeriod, shiftPeriod, monthsBetween,
} from '../services/filters.js';
import { attachLabels } from '../services/labels.js';
import { getDataRange } from '../services/dataRange.js';
import { forecast } from '../services/forecast.js';

const router = Router();

// Les flux import/export sont toujours renvoyés côte à côte : le filtre `flow`
// sert uniquement au tri des classements.
const sumByFlow = {
  importEur: { $sum: { $cond: [{ $eq: ['$flow', 'import'] }, '$valueEur', 0] } },
  exportEur: { $sum: { $cond: [{ $eq: ['$flow', 'export'] }, '$valueEur', 0] } },
  importKg: { $sum: { $cond: [{ $eq: ['$flow', 'import'] }, '$quantityKg', 0] } },
  exportKg: { $sum: { $cond: [{ $eq: ['$flow', 'export'] }, '$quantityKg', 0] } },
};

const round = (v) => Math.round(v);

function withBalance(row) {
  const r = {
    ...row,
    importEur: round(row.importEur), exportEur: round(row.exportEur),
    importKg: round(row.importKg ?? 0), exportKg: round(row.exportKg ?? 0),
  };
  return { ...r, balanceEur: r.exportEur - r.importEur, totalEur: r.exportEur + r.importEur };
}

/** Période effective : bornes demandées, ramenées aux données disponibles. */
async function effectivePeriod(f) {
  const range = await getDataRange();
  if (!range.first) return null;
  const from = f.from && periodKey(f.from) > periodKey(range.first) ? f.from : range.first;
  const to = f.to && periodKey(f.to) < periodKey(range.last) ? f.to : range.last;
  return { from, to, range };
}

async function totals(f) {
  const [row] = await TradeFlow.aggregate([
    { $match: buildMatch(f, { omit: ['flow'] }) },
    ...valueStages(f),
    { $group: { _id: null, ...sumByFlow } },
    { $project: { _id: 0 } },
  ]);
  return withBalance(row || { importEur: 0, exportEur: 0, importKg: 0, exportKg: 0 });
}

const change = (cur, prev) => (prev ? (cur - prev) / prev : null);

// Indicateurs clés sur la période, comparés à la même période un an plus tôt.
// Sans période choisie : total disponible + 12 derniers mois vs 12 mois précédents.
router.get('/summary', async (req, res) => {
  const f = parseFilters(req.query);
  const eff = await effectivePeriod(f);
  if (!eff || periodKey(eff.from) > periodKey(eff.to)) {
    return res.json({ ...withBalance({ importEur: 0, exportEur: 0 }), productCount: 0, partnerCount: 0, period: null });
  }
  const custom = Boolean(f.from || f.to);
  const cur = { ...f, from: eff.from, to: eff.to };
  const refTo = custom ? eff.to : eff.range.last;
  const refFrom = custom ? eff.from : shiftPeriod(refTo, -11);
  const ref = { ...f, from: refFrom, to: refTo };
  const prev = { ...f, from: shiftPeriod(refFrom, -12), to: shiftPeriod(refTo, -12) };

  const [total, refTotals, prevTotals, counts] = await Promise.all([
    totals(cur),
    custom ? null : totals(ref),
    totals(prev),
    TradeFlow.aggregate([
      { $match: buildMatch(cur, { omit: ['flow'] }) },
      { $group: { _id: null, products: { $addToSet: '$product' }, partners: { $addToSet: '$partner' }, reporters: { $addToSet: '$reporter' } } },
      { $project: { _id: 0, products: { $size: '$products' }, partners: { $size: '$partners' }, reporters: { $size: '$reporters' } } },
    ]),
  ]);
  const base = refTotals || total;
  res.json({
    ...total,
    productCount: counts[0]?.products ?? 0,
    partnerCount: counts[0]?.partners ?? 0,
    reporterCount: counts[0]?.reporters ?? 0,
    period: { from: formatPeriod(eff.from), to: formatPeriod(eff.to), months: monthsBetween(eff.from, eff.to) },
    reference: { from: formatPeriod(refFrom), to: formatPeriod(refTo), ...base },
    previous: { from: formatPeriod(prev.from), to: formatPeriod(prev.to), ...prevTotals },
    changeImport: change(base.importEur, prevTotals.importEur),
    changeExport: change(base.exportEur, prevTotals.exportEur),
    changeImportKg: change(base.importKg, prevTotals.importKg),
    changeExportKg: change(base.exportKg, prevTotals.exportKg),
    lastPeriod: formatPeriod(eff.range.last),
  });
});

async function monthlySeries(f, eff) {
  const fromK = periodKey(eff.from);
  const toK = periodKey(eff.to);
  const rows = await TradeFlow.aggregate([
    { $match: buildMatch({ ...f, from: eff.from, to: eff.to }, { omit: ['flow'] }) },
    {
      $project: {
        flow: 1,
        pts: {
          $map: {
            input: { $range: [0, 12] },
            as: 'i',
            in: {
              p: { $add: [{ $multiply: ['$year', 100] }, '$$i', 1] },
              v: { $ifNull: [{ $arrayElemAt: ['$months', '$$i'] }, { $divide: ['$valueEur', 12] }] },
              q: { $ifNull: [{ $arrayElemAt: ['$monthsKg', '$$i'] }, { $divide: ['$quantityKg', 12] }] },
            },
          },
        },
      },
    },
    { $unwind: '$pts' },
    { $match: { 'pts.p': { $gte: fromK, $lte: toK } } },
    {
      $group: {
        _id: '$pts.p',
        importEur: { $sum: { $cond: [{ $eq: ['$flow', 'import'] }, '$pts.v', 0] } },
        exportEur: { $sum: { $cond: [{ $eq: ['$flow', 'export'] }, '$pts.v', 0] } },
        importKg: { $sum: { $cond: [{ $eq: ['$flow', 'import'] }, '$pts.q', 0] } },
        exportKg: { $sum: { $cond: [{ $eq: ['$flow', 'export'] }, '$pts.q', 0] } },
      },
    },
  ]);
  // Série continue : les mois sans échange valent 0.
  const byKey = new Map(rows.map((r) => [r._id, r]));
  const out = [];
  for (let p = eff.from; periodKey(p) <= toK; p = shiftPeriod(p, 1)) {
    const r = byKey.get(periodKey(p)) || { importEur: 0, exportEur: 0, importKg: 0, exportKg: 0 };
    out.push(withBalance({ period: formatPeriod(p), year: p.y, month: p.m, importEur: r.importEur, exportEur: r.exportEur, importKg: r.importKg, exportKg: r.exportKg }));
  }
  return out;
}

async function annualSeries(f, eff) {
  const cur = { ...f, from: eff.from, to: eff.to };
  const rows = await TradeFlow.aggregate([
    { $match: buildMatch(cur, { omit: ['flow'] }) },
    ...valueStages(cur),
    { $group: { _id: '$year', ...sumByFlow } },
    { $sort: { _id: 1 } },
  ]);
  const byYear = new Map(rows.map((r) => [r._id, r]));
  const out = [];
  for (let y = eff.from.y; y <= eff.to.y; y++) {
    const r = byYear.get(y) || { importEur: 0, exportEur: 0, importKg: 0, exportKg: 0 };
    const m0 = y === eff.from.y ? eff.from.m : 1;
    const m1 = y === eff.to.y ? eff.to.m : 12;
    out.push(withBalance({ period: String(y), year: y, months: m1 - m0 + 1, importEur: r.importEur, exportEur: r.exportEur, importKg: r.importKg, exportKg: r.exportKg }));
  }
  return out;
}

// Évolution import / export, annuelle (granularity=year) ou mensuelle (granularity=month).
router.get('/timeseries', async (req, res) => {
  const f = parseFilters(req.query);
  const eff = await effectivePeriod(f);
  if (!eff) return res.json([]);
  const series = req.query.granularity === 'month' ? await monthlySeries(f, eff) : await annualSeries(f, eff);
  res.json(series);
});

// Prévision import / export (valeur ou quantité) à partir de l'historique filtré.
router.get('/forecast', async (req, res) => {
  const f = parseFilters(req.query);
  const monthly = req.query.granularity !== 'year';
  const horizon = Math.min(monthly ? 36 : 5, Math.max(1, Number.parseInt(req.query.horizon, 10) || (monthly ? 12 : 3)));
  const measure = req.query.measure === 'quantity' ? 'Kg' : 'Eur';
  const range = await getDataRange();
  if (!range.first) return res.json({ history: [], forecast: [] });

  // La prévision s'appuie sur tout l'historique disponible (le filtre de période est ignoré).
  const eff = { from: range.first, to: range.last, range };
  let history = monthly ? await monthlySeries(f, eff) : await annualSeries(f, eff);
  if (!monthly) history = history.filter((r) => r.months === 12); // années complètes seulement

  const imp = forecast(history.map((r) => r[`import${measure}`]), { horizon, season: monthly ? 12 : 1 });
  const exp = forecast(history.map((r) => r[`export${measure}`]), { horizon, season: monthly ? 12 : 1 });
  const last = monthly ? range.last : { y: history.at(-1)?.year ?? range.last.y, m: 12 };
  const out = imp.values.map((_, i) => {
    const p = monthly ? shiftPeriod(last, i + 1) : { y: last.y + i + 1, m: 12 };
    return {
      period: monthly ? formatPeriod(p) : String(p.y),
      import: round(imp.values[i]), importLow: round(imp.lower[i]), importHigh: round(imp.upper[i]),
      export: round(exp.values[i]), exportLow: round(exp.lower[i]), exportHigh: round(exp.upper[i]),
    };
  });
  res.json({
    granularity: monthly ? 'month' : 'year',
    measure: measure === 'Kg' ? 'quantity' : 'value',
    method: imp.method,
    history: history.map((r) => ({ period: r.period, import: r[`import${measure}`], export: r[`export${measure}`] })),
    forecast: out,
  });
});

const DIMENSIONS = ['partner', 'reporter', 'product', 'hs6', 'chapter', 'section'];

function sortKeyFor(flow) {
  return flow === 'import' ? 'importEur' : flow === 'export' ? 'exportEur' : 'totalEur';
}

// Classement par dimension (partenaires, pays déclarants, codes NC, NC06, chapitres, sections).
router.get('/top', async (req, res) => {
  const f = parseFilters(req.query);
  const dimension = String(req.query.dimension || 'partner');
  if (!DIMENSIONS.includes(dimension)) throw new FilterError(`dimension doit être parmi ${DIMENSIONS.join(', ')}`);
  const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
  const sortKey = req.query.sort === 'quantity' ? (f.flow === 'import' ? 'importKg' : f.flow === 'export' ? 'exportKg' : 'totalKg') : sortKeyFor(f.flow);

  const rows = await TradeFlow.aggregate([
    { $match: buildMatch(f, { omit: ['flow'] }) },
    ...valueStages(f),
    { $group: { _id: `$${dimension}`, ...sumByFlow } },
    { $addFields: { totalEur: { $add: ['$importEur', '$exportEur'] }, totalKg: { $add: ['$importKg', '$exportKg'] } } },
    { $match: { totalEur: { $gt: 0 } } },
    { $sort: { [sortKey]: -1, _id: 1 } },
    { $limit: limit },
    { $project: { _id: 0, key: '$_id', importEur: 1, exportEur: 1, importKg: 1, exportKg: 1 } },
  ]);
  res.json(await attachLabels(rows.map(withBalance), dimension));
});

// Séries annuelles par élément d'une dimension (mini-graphiques des grilles de navigation).
router.get('/sparklines', async (req, res) => {
  const f = parseFilters(req.query);
  const dimension = String(req.query.dimension || 'chapter');
  if (!DIMENSIONS.includes(dimension)) throw new FilterError(`dimension doit être parmi ${DIMENSIONS.join(', ')}`);
  const eff = await effectivePeriod(f);
  if (!eff) return res.json({ years: [], series: {} });
  const flowValue = f.flow ? { $cond: [{ $eq: ['$flow', f.flow] }, '$valueEur', 0] } : '$valueEur';
  const rows = await TradeFlow.aggregate([
    { $match: buildMatch({ ...f, from: eff.from, to: eff.to }, { omit: ['flow'] }) },
    { $group: { _id: { k: `$${dimension}`, y: '$year' }, v: { $sum: flowValue } } },
  ]);
  const years = [];
  // Années complètes uniquement (une année partielle fausserait la tendance).
  const lastFull = eff.to.m === 12 ? eff.to.y : eff.to.y - 1;
  for (let y = eff.from.y; y <= lastFull; y++) years.push(y);
  const series = {};
  for (const r of rows) {
    const idx = years.indexOf(r._id.y);
    if (idx < 0) continue;
    series[r._id.k] ??= years.map(() => 0);
    series[r._id.k][idx] = round(r.v);
  }
  res.json({ years, series });
});

// Matrice croisée (ex. pays déclarants × partenaires) pour les cartes de chaleur.
router.get('/matrix', async (req, res) => {
  const f = parseFilters(req.query);
  const rowsDim = String(req.query.rows || 'reporter');
  const colsDim = String(req.query.cols || 'partner');
  if (![rowsDim, colsDim].every((d) => DIMENSIONS.includes(d)) || rowsDim === colsDim) {
    throw new FilterError('Dimensions de matrice invalides');
  }
  const size = Math.min(15, Math.max(2, Number.parseInt(req.query.size, 10) || 8));
  const value = f.flow ? { $cond: [{ $eq: ['$flow', f.flow] }, '$valueEur', 0] } : '$valueEur';
  const cells = await TradeFlow.aggregate([
    { $match: buildMatch(f, { omit: ['flow'] }) },
    ...valueStages(f),
    { $group: { _id: { r: `$${rowsDim}`, c: `$${colsDim}` }, v: { $sum: value } } },
    { $match: { v: { $gt: 0 } } },
  ]);
  const totalBy = (k) => {
    const m = new Map();
    for (const c of cells) m.set(c._id[k], (m.get(c._id[k]) || 0) + c.v);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, size).map(([key]) => key);
  };
  const rowKeys = totalBy('r');
  const colKeys = totalBy('c');
  const lookup = new Map(cells.map((c) => [`${c._id.r}|${c._id.c}`, c.v]));
  const values = rowKeys.map((r) => colKeys.map((c) => round(lookup.get(`${r}|${c}`) || 0)));
  const rowsL = await attachLabels(rowKeys.map((key) => ({ key })), rowsDim);
  const colsL = await attachLabels(colKeys.map((key) => ({ key })), colsDim);
  res.json({ rows: rowsL, cols: colsL, values });
});

export default router;
