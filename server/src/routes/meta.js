import { Router } from 'express';
import { EU_COUNTRIES, EXTRA_EU_COUNTRIES } from '../data/countries.js';
import { nomenclatureTree } from '../data/nomenclature.js';
import { TradeFlow } from '../models/TradeFlow.js';
import { getDataRange } from '../services/dataRange.js';
import { formatPeriod } from '../services/filters.js';

const router = Router();

// Référentiels utilisés pour construire les filtres côté client.
router.get('/', async (req, res) => {
  const [range, reporters, partners] = await Promise.all([
    getDataRange(),
    TradeFlow.distinct('reporter'),
    TradeFlow.distinct('partner'),
  ]);
  const years = [];
  if (range.first) for (let y = range.first.y; y <= range.last.y; y++) years.push(y);
  const has = (set) => (c) => set.has(c.code);
  res.json({
    years,
    firstPeriod: range.first ? formatPeriod(range.first) : null,
    lastPeriod: range.last ? formatPeriod(range.last) : null,
    reporters: EU_COUNTRIES.filter(has(new Set(reporters))),
    partners: EXTRA_EU_COUNTRIES.filter(has(new Set(partners))),
    sections: nomenclatureTree(),
  });
});

export default router;
