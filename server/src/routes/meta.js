import { Router } from 'express';
import { EU_COUNTRIES, EXTRA_EU_COUNTRIES } from '../data/countries.js';
import { nomenclatureTree } from '../data/nomenclature.js';
import { TradeFlow } from '../models/TradeFlow.js';

const router = Router();

// Référentiels utilisés pour construire les filtres côté client.
router.get('/', async (req, res) => {
  const [years, reporters, partners] = await Promise.all([
    TradeFlow.distinct('year'),
    TradeFlow.distinct('reporter'),
    TradeFlow.distinct('partner'),
  ]);
  const has = (set) => (c) => set.has(c.code);
  res.json({
    years: years.sort((a, b) => a - b),
    reporters: EU_COUNTRIES.filter(has(new Set(reporters))),
    partners: EXTRA_EU_COUNTRIES.filter(has(new Set(partners))),
    sections: nomenclatureTree(),
  });
});

export default router;
