import { Router } from 'express';
import {
  parseFilters, FilterError, periodKey, formatPeriod, shiftPeriod, monthsBetween,
} from '../services/filters.js';
import { attachLabels } from '../services/labels.js';
import { getDataRange } from '../services/dataRange.js';
import { forecast } from '../services/forecast.js';
import { buildScope, dimensionExpr, SOURCES } from '../services/scope.js';
import { describePrices } from '../services/priceStats.js';
import { WorldFlow } from '../models/WorldFlow.js';

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
const price = (v, q) => (q > 0 ? Math.round((v / q) * 10000) / 10000 : null);

function withBalance(row) {
  const r = {
    ...row,
    importEur: round(row.importEur ?? 0), exportEur: round(row.exportEur ?? 0),
    importKg: round(row.importKg ?? 0), exportKg: round(row.exportKg ?? 0),
  };
  return {
    ...r,
    balanceEur: r.exportEur - r.importEur,
    totalEur: r.exportEur + r.importEur,
    totalKg: r.exportKg + r.importKg,
    balanceKg: r.exportKg - r.importKg,
    importPrice: price(r.importEur, r.importKg),
    exportPrice: price(r.exportEur, r.exportKg),
  };
}

/** Options communes : source des données (eu | world) et harmonisation (nc=brut pour la désactiver). */
function sourceOpts(req) {
  const source = req.query.source === 'world' ? 'world' : 'eu';
  return { source, raw: req.query.nc === 'brut' };
}

/** Période effective : bornes demandées, ramenées aux données disponibles. */
async function effectivePeriod(f, opts) {
  const range = await getDataRange(SOURCES[opts.source].Model);
  if (!range.first) return null;
  const from = f.from && periodKey(f.from) > periodKey(range.first) ? f.from : range.first;
  const to = f.to && periodKey(f.to) < periodKey(range.last) ? f.to : range.last;
  return { from, to, range };
}

async function aggregate(f, opts, stages, scopeOpts = {}) {
  const s = await buildScope(f, { ...opts, omit: ['flow'], ...scopeOpts });
  return s.Model.aggregate([{ $match: s.match }, ...s.pre, ...(typeof stages === 'function' ? stages(s) : stages)]).allowDiskUse(true);
}

async function totals(f, opts) {
  const [row] = await aggregate(f, opts, [{ $group: { _id: null, ...sumByFlow } }, { $project: { _id: 0 } }], { dims: [] });
  return withBalance(row || {});
}

const change = (cur, prev) => (prev ? (cur - prev) / prev : null);

// Indicateurs clés sur la période, comparés à la même période un an plus tôt.
// Sans période choisie : total disponible + 12 derniers mois vs 12 mois précédents.
router.get('/summary', async (req, res) => {
  const f = parseFilters(req.query);
  const opts = sourceOpts(req);
  const eff = await effectivePeriod(f, opts);
  if (!eff || periodKey(eff.from) > periodKey(eff.to)) {
    return res.json({ ...withBalance({}), productCount: 0, partnerCount: 0, reporterCount: 0, period: null });
  }
  const custom = Boolean(f.from || f.to);
  const cur = { ...f, from: eff.from, to: eff.to };
  const refTo = custom ? eff.to : eff.range.last;
  const refFrom = custom ? eff.from : shiftPeriod(refTo, -11);
  const ref = { ...f, from: refFrom, to: refTo };
  const prev = { ...f, from: shiftPeriod(refFrom, -12), to: shiftPeriod(refTo, -12) };

  const [total, refTotals, prevTotals, counts, scope] = await Promise.all([
    totals(cur, opts),
    custom ? null : totals(ref, opts),
    totals(prev, opts),
    // Comptages : codes NC (table par produit) et pays (table par pays) séparément.
    // counts=0 : inutiles pour l'appelant (fiche pays), on évite de relire les lignes détaillées.
    req.query.counts === '0' ? [{}] : Promise.all([
      aggregate(cur, opts, (sc) => [
        { $project: { tc: { $ifNull: ['$tc', ['$product']] } } }, { $unwind: '$tc' },
        // Un ancien code réparti entre plusieurs codes actuels ne compte que pour ceux du périmètre
        ...(sc.code && sc.mode === 'harmonized' ? [{ $match: { tc: { $regex: `^${sc.code}` } } }] : []),
        { $group: { _id: '$tc' } }, { $count: 'n' },
      ], { noPeriodSlice: true, dims: ['tc'] }),
      aggregate(cur, opts, [{ $group: { _id: '$partner' } }, { $count: 'n' }], { noPeriodSlice: true, dims: ['partner'] }),
      aggregate(cur, opts, [{ $group: { _id: '$reporter' } }, { $count: 'n' }], { noPeriodSlice: true, dims: ['reporter'] }),
    ]).then(([p, pa, re]) => [{ products: p[0]?.n ?? 0, partners: pa[0]?.n ?? 0, reporters: re[0]?.n ?? 0 }]),
    buildScope(cur, { ...opts, noPeriodSlice: true }),
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
    changeImportPrice: change(base.importPrice, prevTotals.importPrice),
    changeExportPrice: change(base.exportPrice, prevTotals.exportPrice),
    lastPeriod: formatPeriod(eff.range.last),
    nomenclature: scope.mode,
    source: opts.source,
  });
});

async function monthlySeries(f, eff, opts) {
  const fromK = periodKey(eff.from);
  const toK = periodKey(eff.to);
  // Une seule passe : 12 accumulateurs par mesure (somme élément par élément des tableaux mensuels).
  const acc = {};
  for (let i = 0; i < 12; i++) {
    acc[`v${i}`] = { $sum: { $ifNull: [{ $arrayElemAt: ['$months', i] }, { $divide: ['$valueEur', 12] }] } };
    acc[`q${i}`] = { $sum: { $ifNull: [{ $arrayElemAt: ['$monthsKg', i] }, { $divide: ['$quantityKg', 12] }] } };
  }
  const rows = await aggregate({ ...f, from: eff.from, to: eff.to }, opts, [{ $group: { _id: { y: '$year', f: '$flow' }, ...acc } }], { noPeriodSlice: true, dims: [] });
  const byKey = new Map();
  for (const r of rows) {
    for (let i = 0; i < 12; i++) {
      const k = r._id.y * 100 + i + 1;
      const e = byKey.get(k) || { importEur: 0, exportEur: 0, importKg: 0, exportKg: 0 };
      e[`${r._id.f}Eur`] += r[`v${i}`];
      e[`${r._id.f}Kg`] += r[`q${i}`];
      byKey.set(k, e);
    }
  }
  // Série continue : les mois sans échange valent 0.
  const out = [];
  for (let p = eff.from; periodKey(p) <= toK; p = shiftPeriod(p, 1)) {
    if (periodKey(p) < fromK) continue;
    const r = byKey.get(periodKey(p)) || {};
    out.push(withBalance({ period: formatPeriod(p), year: p.y, month: p.m, ...r }));
  }
  return out;
}

async function annualSeries(f, eff, opts) {
  const cur = { ...f, from: eff.from, to: eff.to };
  const rows = await aggregate(cur, opts, [{ $group: { _id: '$year', ...sumByFlow } }, { $sort: { _id: 1 } }], { dims: [] });
  const byYear = new Map(rows.map((r) => [r._id, r]));
  const out = [];
  for (let y = eff.from.y; y <= eff.to.y; y++) {
    const r = byYear.get(y) || {};
    const m0 = y === eff.from.y ? eff.from.m : 1;
    const m1 = y === eff.to.y ? eff.to.m : 12;
    out.push(withBalance({ period: String(y), year: y, months: m1 - m0 + 1, importEur: r.importEur, exportEur: r.exportEur, importKg: r.importKg, exportKg: r.exportKg }));
  }
  return out;
}

/** Trimestres (« 2023-T2 ») à partir de la série mensuelle ; `months` < 3 signale un trimestre partiel. */
async function quarterlySeries(f, eff, opts) {
  const monthly = await monthlySeries(f, eff, opts);
  const out = [];
  for (const m of monthly) {
    const q = Math.ceil(m.month / 3);
    const key = `${m.year}-T${q}`;
    let r = out.at(-1);
    if (!r || r.period !== key) {
      r = { period: key, year: m.year, quarter: q, months: 0, importEur: 0, exportEur: 0, importKg: 0, exportKg: 0 };
      out.push(r);
    }
    r.months += 1;
    for (const k of ['importEur', 'exportEur', 'importKg', 'exportKg']) r[k] += m[k];
  }
  return out.map(withBalance);
}

const SERIES = { month: monthlySeries, quarter: quarterlySeries, year: annualSeries };
const granularityOf = (g) => (SERIES[g] ? g : 'year');

// Évolution import / export : mensuelle, trimestrielle ou annuelle (granularity=month|quarter|year).
router.get('/timeseries', async (req, res) => {
  const f = parseFilters(req.query);
  const opts = sourceOpts(req);
  const eff = await effectivePeriod(f, opts);
  if (!eff) return res.json([]);
  res.json(await SERIES[granularityOf(String(req.query.granularity))](f, eff, opts));
});

// Prévision import / export (valeur, quantité ou prix) à partir de l'historique filtré.
router.get('/forecast', async (req, res) => {
  const f = parseFilters(req.query);
  const opts = sourceOpts(req);
  const g = req.query.granularity ? granularityOf(String(req.query.granularity)) : 'month';
  const cfg = {
    month: { season: 12, maxH: 36, defH: 12, full: 1, step: 1 },
    quarter: { season: 4, maxH: 12, defH: 4, full: 3, step: 3 },
    year: { season: 1, maxH: 5, defH: 3, full: 12, step: 12 },
  }[g];
  const horizon = Math.min(cfg.maxH, Math.max(1, Number.parseInt(req.query.horizon, 10) || cfg.defH));
  const measure = ['quantity', 'price'].includes(req.query.measure) ? req.query.measure : 'value';
  const range = await getDataRange(SOURCES[opts.source].Model);
  if (!range.first) return res.json({ history: [], forecast: [] });

  // La prévision s'appuie sur tout l'historique disponible (le filtre de période est ignoré),
  // en ne gardant que les périodes complètes.
  const eff = { from: range.first, to: range.last, range };
  let history = await SERIES[g]({ ...f, from: undefined, to: undefined }, eff, opts);
  if (g !== 'month') history = history.filter((r) => r.months === cfg.full);
  const pick = (r, flow) => (measure === 'quantity' ? r[`${flow}Kg`] : measure === 'price' ? r[`${flow}Price`] ?? 0 : r[`${flow}Eur`]);

  const imp = forecast(history.map((r) => pick(r, 'import')), { horizon, season: cfg.season });
  const exp = forecast(history.map((r) => pick(r, 'export')), { horizon, season: cfg.season });
  const lastRow = history.at(-1);
  const last = g === 'month' ? range.last : g === 'quarter' ? { y: lastRow?.year ?? range.last.y, m: (lastRow?.quarter ?? 4) * 3 } : { y: lastRow?.year ?? range.last.y, m: 12 };
  const label = (p) => (g === 'month' ? formatPeriod(p) : g === 'quarter' ? `${p.y}-T${Math.ceil(p.m / 3)}` : String(p.y));
  const r4 = (x) => (measure === 'price' ? Math.round(x * 10000) / 10000 : round(x));
  const out = imp.values.map((_, i) => {
    const p = shiftPeriod(last, (i + 1) * cfg.step);
    return {
      period: label(p),
      import: r4(imp.values[i]), importLow: r4(imp.lower[i]), importHigh: r4(imp.upper[i]),
      export: r4(exp.values[i]), exportLow: r4(exp.lower[i]), exportHigh: r4(exp.upper[i]),
    };
  });
  res.json({
    granularity: g,
    measure,
    method: imp.method,
    history: history.map((r) => ({ period: r.period, import: pick(r, 'import'), export: pick(r, 'export') })),
    forecast: out,
  });
});

const DIMENSIONS = ['partner', 'reporter', 'product', 'hs6', 'chapter', 'section'];
const PRODUCT_DIMS = new Set(['product', 'hs6', 'chapter']);

function sortKeyFor(flow, by) {
  const suffix = by === 'quantity' ? 'Kg' : 'Eur';
  if (by === 'price') return flow === 'import' ? 'importPrice' : 'exportPrice';
  return flow === 'import' ? `import${suffix}` : flow === 'export' ? `export${suffix}` : `total${suffix}`;
}

async function labelsFor(rows, dimension, opts) {
  const dim = opts.source === 'world' && dimension === 'product' ? 'hs6' : dimension;
  return attachLabels(rows, dim);
}

// Classement par dimension (partenaires, pays déclarants, codes NC, NC06, chapitres, sections).
// sort = value (défaut) | quantity | price ; order = desc (défaut) | asc
router.get('/top', async (req, res) => {
  const f = parseFilters(req.query);
  const opts = sourceOpts(req);
  const dimension = String(req.query.dimension || 'partner');
  if (!DIMENSIONS.includes(dimension)) throw new FilterError(`dimension doit être parmi ${DIMENSIONS.join(', ')}`);
  const limit = Math.min(300, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
  const sortKey = sortKeyFor(f.flow, String(req.query.sort || 'value'));
  const dir = req.query.order === 'asc' ? 1 : -1;

  const rows = await aggregate(f, opts, (s) => [
    { $group: { _id: dimensionExpr(dimension, s), ...sumByFlow } },
    {
      $addFields: {
        totalEur: { $add: ['$importEur', '$exportEur'] },
        totalKg: { $add: ['$importKg', '$exportKg'] },
        importPrice: { $cond: [{ $gt: ['$importKg', 0] }, { $divide: ['$importEur', '$importKg'] }, null] },
        exportPrice: { $cond: [{ $gt: ['$exportKg', 0] }, { $divide: ['$exportEur', '$exportKg'] }, null] },
      },
    },
    { $match: { $or: [{ totalEur: { $gt: 0 } }, { totalKg: { $gt: 0 } }], ...(sortKey.endsWith('Price') ? { [sortKey]: { $ne: null } } : {}) } },
    { $sort: { [sortKey]: dir, _id: 1 } },
    { $limit: limit },
    { $project: { _id: 0, key: '$_id', importEur: 1, exportEur: 1, importKg: 1, exportKg: 1 } },
  ], { byProduct: PRODUCT_DIMS.has(dimension), dims: [dimension] });
  res.json(await labelsFor(rows.map(withBalance), dimension, opts));
});

// Séries annuelles par élément d'une dimension (mini-graphiques des grilles de navigation).
router.get('/sparklines', async (req, res) => {
  const f = parseFilters(req.query);
  const opts = sourceOpts(req);
  const dimension = String(req.query.dimension || 'chapter');
  if (!DIMENSIONS.includes(dimension)) throw new FilterError(`dimension doit être parmi ${DIMENSIONS.join(', ')}`);
  const eff = await effectivePeriod(f, opts);
  if (!eff) return res.json({ years: [], series: {} });
  const field = req.query.measure === 'quantity' ? '$quantityKg' : '$valueEur';
  const flowValue = f.flow ? { $cond: [{ $eq: ['$flow', f.flow] }, field, 0] } : field;
  const rows = await aggregate({ ...f, from: eff.from, to: eff.to }, opts, (s) => [
    { $group: { _id: { k: dimensionExpr(dimension, s), y: '$year' }, v: { $sum: flowValue } } },
  ], { byProduct: PRODUCT_DIMS.has(dimension), noPeriodSlice: true, dims: [dimension] });
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
  const opts = sourceOpts(req);
  const rowsDim = String(req.query.rows || 'reporter');
  const colsDim = String(req.query.cols || 'partner');
  if (![rowsDim, colsDim].every((d) => DIMENSIONS.includes(d)) || rowsDim === colsDim) {
    throw new FilterError('Dimensions de matrice invalides');
  }
  const size = Math.min(15, Math.max(2, Number.parseInt(req.query.size, 10) || 8));
  const field = req.query.measure === 'quantity' ? '$quantityKg' : '$valueEur';
  const value = f.flow ? { $cond: [{ $eq: ['$flow', f.flow] }, field, 0] } : field;
  const cells = await aggregate(f, opts, (s) => [
    { $group: { _id: { r: dimensionExpr(rowsDim, s), c: dimensionExpr(colsDim, s) }, v: { $sum: value } } },
    { $match: { v: { $gt: 0 } } },
  ], { byProduct: PRODUCT_DIMS.has(rowsDim) || PRODUCT_DIMS.has(colsDim), dims: [rowsDim, colsDim] });
  const totalBy = (k) => {
    const m = new Map();
    for (const c of cells) m.set(c._id[k], (m.get(c._id[k]) || 0) + c.v);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, size).map(([key]) => key);
  };
  const rowKeys = totalBy('r');
  const colKeys = totalBy('c');
  const lookup = new Map(cells.map((c) => [`${c._id.r}|${c._id.c}`, c.v]));
  const values = rowKeys.map((r) => colKeys.map((c) => round(lookup.get(`${r}|${c}`) || 0)));
  const rowsL = await labelsFor(rowKeys.map((key) => ({ key })), rowsDim, opts);
  const colsL = await labelsFor(colKeys.map((key) => ({ key })), colsDim, opts);
  res.json({ rows: rowsL, cols: colsL, values, measure: req.query.measure === 'quantity' ? 'quantity' : 'value' });
});

// Analyse des prix unitaires (€/kg) : par pays (ou par produit), prix moyen, médian pondéré
// par les volumes, quartiles, extrêmes, dispersion ; évolution mensuelle du prix médian.
// Exige un produit (code de 6 à 8 chiffres) : comparer des prix entre produits différents n'a pas de sens.
router.get('/prices', async (req, res) => {
  const f = parseFilters(req.query);
  const opts = sourceOpts(req);
  if (!f.product || f.product.length < 6) throw new FilterError('Choisissez un produit (code NC de 6 ou 8 chiffres) pour analyser les prix');
  const dimension = String(req.query.dimension || (f.flow === 'import' ? 'partner' : 'reporter'));
  if (!['reporter', 'partner', 'product'].includes(dimension)) throw new FilterError('dimension doit être reporter, partner ou product');
  const flow = f.flow || 'export';
  const eff = await effectivePeriod(f, opts);
  if (!eff) return res.json({ groups: [], overall: null, periods: [] });
  const fromK = periodKey(eff.from);
  const toK = periodKey(eff.to);

  const docs = await aggregate({ ...f, flow, from: eff.from, to: eff.to }, opts, (s) => [
    { $match: { flow } },
    { $project: { _id: 0, k: dimensionExpr(dimension, s), year: 1, months: 1, monthsKg: 1, valueEur: 1, quantityKg: 1 } },
  ], { byProduct: dimension === 'product', noPeriodSlice: true });

  const groups = new Map();
  const byPeriod = new Map();
  const all = [];
  const series = new Map(); // k -> période -> { v, q }
  for (const d of docs) {
    const months = Array.isArray(d.months) ? d.months : null;
    for (let i = 0; i < 12; i++) {
      const k = d.year * 100 + i + 1;
      if (k < fromK || k > toK) continue;
      const v = months ? d.months[i] : d.valueEur / 12;
      const q = months ? d.monthsKg?.[i] ?? 0 : d.quantityKg / 12;
      if (!(v > 0) || !(q > 0)) continue;
      const o = { v, q };
      if (!groups.has(d.k)) groups.set(d.k, []);
      groups.get(d.k).push(o);
      if (!byPeriod.has(k)) byPeriod.set(k, []);
      byPeriod.get(k).push(o);
      all.push(o);
      if (!series.has(d.k)) series.set(d.k, new Map());
      const sp = series.get(d.k);
      const e = sp.get(k) || { v: 0, q: 0 };
      e.v += v;
      e.q += q;
      sp.set(k, e);
    }
  }
  const overall = all.length ? describePrices(all) : null;
  let rows = [...groups.entries()].map(([key, obs]) => ({ key, ...describePrices(obs) })).filter((r) => r.observations);
  rows.forEach((r) => {
    r.share = overall?.quantityKg ? r.quantityKg / overall.quantityKg : 0;
    r.vsMedian = overall?.median ? r.median / overall.median - 1 : null; // écart au prix médian global
  });
  rows.sort((a, b) => a.median - b.median);
  rows = await labelsFor(rows, dimension, opts);
  const periods = [...byPeriod.entries()].sort((a, b) => a[0] - b[0]).map(([k, obs]) => {
    const d = describePrices(obs);
    return { period: `${Math.floor(k / 100)}-${String(k % 100).padStart(2, '0')}`, median: d?.median ?? null, mean: d?.mean ?? null, p25: d?.p25 ?? null, p75: d?.p75 ?? null, quantityKg: d?.quantityKg ?? 0 };
  });
  // Prix moyen mensuel des 6 premiers pays en volume
  const top = [...rows].sort((a, b) => b.quantityKg - a.quantityKg).slice(0, 6).map((r) => r.key);
  const topSeries = Object.fromEntries(top.map((key) => [key, periods.map((p) => {
    const e = series.get(key)?.get(Number(p.period.replace('-', '')));
    return e && e.q > 0 ? Math.round((e.v / e.q) * 10000) / 10000 : null;
  })]));
  res.json({
    flow, dimension, unit: 'EUR/kg',
    period: { from: formatPeriod(eff.from), to: formatPeriod(eff.to) },
    overall,
    groups: rows,
    cheapest: rows[0]?.key ?? null,
    priciest: rows.at(-1)?.key ?? null,
    periods,
    topSeries,
  });
});

// Comparaison « miroir » (données mondiales) : exportations déclarées par A vers B
// face aux importations déclarées par B depuis A, et inversement.
router.get('/mirror', async (req, res) => {
  const f = parseFilters(req.query);
  const a = f.reporters?.[0];
  const b = f.partners?.[0];
  if (!a || !b) throw new FilterError('Indiquez un pays déclarant (reporters) et un partenaire (partners)');
  const product = f.product ? f.product.slice(0, 6) : undefined;
  const base = { ...f, product, reporters: undefined, partners: undefined, flow: undefined };
  const opts = { source: 'world', raw: false };
  const eff = await effectivePeriod(base, opts);
  if (!eff) return res.json({ years: [] });
  const s = await buildScope({ ...base, from: eff.from, to: eff.to }, { ...opts, omit: ['flow'] });
  const rows = await WorldFlow.aggregate([
    {
      // $and : le filtre produit peut lui-même contenir un $or (codes actuels / anciens codes)
      $match: { $and: [s.match, { mirror: { $ne: true } }, { $or: [{ reporter: a, partner: b }, { reporter: b, partner: a }] }] },
    },
    ...s.pre,
    { $group: { _id: { r: '$reporter', f: '$flow', y: '$year' }, v: { $sum: '$valueEur' }, q: { $sum: '$quantityKg' }, src: { $addToSet: '$source' } } },
  ]);
  const get = (r, fl, y) => rows.find((x) => x._id.r === r && x._id.f === fl && x._id.y === y);
  const years = [];
  for (let y = eff.from.y; y <= eff.to.y; y++) {
    const ab = get(a, 'export', y);
    const ba = get(b, 'import', y);
    const ba2 = get(b, 'export', y);
    const ab2 = get(a, 'import', y);
    years.push({
      year: y,
      aExports: ab ? round(ab.v) : null, bImportsFromA: ba ? round(ba.v) : null,
      bExports: ba2 ? round(ba2.v) : null, aImportsFromB: ab2 ? round(ab2.v) : null,
      aExportsKg: ab ? round(ab.q) : null, bImportsFromAKg: ba ? round(ba.q) : null,
    });
  }
  const gap = (x, y) => (x && y ? y / x - 1 : null);
  const sum = (k) => years.reduce((t, r) => t + (r[k] || 0), 0);
  res.json({
    reporter: a, partner: b, product,
    years: years.map((r) => ({ ...r, gapAB: gap(r.aExports, r.bImportsFromA), gapBA: gap(r.bExports, r.aImportsFromB) })),
    totals: { aExports: sum('aExports'), bImportsFromA: sum('bImportsFromA'), bExports: sum('bExports'), aImportsFromB: sum('aImportsFromB') },
    sources: [...new Set(rows.flatMap((r) => r.src))],
  });
});

export default router;
