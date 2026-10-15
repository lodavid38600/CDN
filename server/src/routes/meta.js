import { Router } from 'express';
import { EU_COUNTRIES, EU_CODES, ALL_COUNTRIES, countryLabel } from '../data/countries.js';
import { nomenclatureTree } from '../data/nomenclature.js';
import { TradeFlow } from '../models/TradeFlow.js';
import { WorldFlow } from '../models/WorldFlow.js';
import { JobRun } from '../models/System.js';
import { getDataRange, peekDataRange } from '../services/dataRange.js';
import { getDataVersion } from '../services/dataVersion.js';
import { formatPeriod } from '../services/filters.js';
import { SOURCES_INFO } from '../connectors/index.js';
import { countriesIndex } from '../services/countriesIndex.js';

const router = Router();

// Pays présents dans les données, y compris ceux absents du référentiel de base (Andorre, Groenland,
// territoires, codes spéciaux Comext…) : libellé automatique, jamais écartés.
const KNOWN = new Map(ALL_COUNTRIES.map((c) => [c.code, c]));
const countriesOf = (codes) => [...new Set(codes)]
  .map((code) => KNOWN.get(code) || { code, name: countryLabel(code), eu: EU_CODES.has(code), region: 'Autres pays et territoires' })
  .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

// Référentiels utilisés pour construire les filtres côté client, et fraîcheur des données.
router.get('/', async (req, res) => {
  const [range, worldRange, countries, version, lastRun] = await Promise.all([
    getDataRange(TradeFlow),
    peekDataRange(WorldFlow), // ne bloque pas l'ouverture de l'application
    countriesIndex(),
    getDataVersion(),
    JobRun.findOne({ name: 'mise-a-jour' }).sort({ startedAt: -1 }).lean(),
  ]);
  const years = [];
  if (range.first) for (let y = range.first.y; y <= range.last.y; y++) years.push(y);
  const has = (set) => (c) => set.has(c.code);
  const { reporters, partners } = countries;
  const wr = new Map(countries.world.map((r) => [r.code, r]));
  res.json({
    years,
    firstPeriod: range.first ? formatPeriod(range.first) : null,
    lastPeriod: range.last ? formatPeriod(range.last) : null,
    world: worldRange?.first ? { firstPeriod: formatPeriod(worldRange.first), lastPeriod: formatPeriod(worldRange.last) } : null,
    reporters: EU_COUNTRIES.filter(has(new Set(reporters))),
    partners: countriesOf(partners.filter((c) => !EU_CODES.has(c))),
    // Pays présents dans les données mondiales : sources directes ou reconstitution « miroir »
    worldCountries: countriesOf([...wr.keys()]).map((c) => ({
      ...c,
      sources: wr.get(c.code).sources,
      mirrorOnly: wr.get(c.code).mirrorOnly,
    })),
    sources: SOURCES_INFO,
    data: {
      version: version.version,
      updatedAt: version.updatedAt,
      lastRun: lastRun ? { status: lastRun.status, startedAt: lastRun.startedAt, endedAt: lastRun.endedAt } : null,
    },
    sections: nomenclatureTree(),
  });
});

export default router;
