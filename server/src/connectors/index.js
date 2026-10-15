// Registre des sources de données hors Eurostat et mise à jour des données mondiales.
import * as comtrade from './comtrade.js';
import * as usCensus from './usCensus.js';
import * as ukHmrc from './ukHmrc.js';
import * as ssb from './ssb.js';
import { loadFx, fetchEcbRates } from './fx.js';
import { WorldFlow } from '../models/WorldFlow.js';
import { Rejected } from '../models/System.js';
import { ingest, toYearly } from '../services/ingest.js';

export const CONNECTORS = { comtrade, 'us-census': usCensus, 'uk-hmrc': ukHmrc, ssb };

export const SOURCES_INFO = [
  {
    id: 'eurostat', name: 'Eurostat — Comext', currency: 'EUR', level: 'NC8', frequency: 'mensuelle',
    coverage: '27 pays de l\'UE (commerce avec les pays hors UE)', url: 'https://ec.europa.eu/eurostat/comext', priority: 3,
  },
  ...Object.values(CONNECTORS).map((c) => c.info),
  {
    id: 'mirror', name: 'Données miroir', currency: 'EUR', level: 'SH6', frequency: 'mensuelle',
    coverage: 'Pays ne publiant pas de données : reconstitués à partir des déclarations de leurs partenaires', priority: 1,
  },
];

const PRIORITY = Object.fromEntries(SOURCES_INFO.map((s) => [s.id, s.priority]));

/** Écrit des enregistrements mensuels normalisés (toutes sources) dans les données mondiales. */
export async function ingestWorldRecords(records) {
  const currencies = [...new Set(records.map((r) => r.currency))];
  const fx = await loadFx(currencies);
  const { docs, rejected } = toYearly(records, fx);
  if (rejected.length) await Rejected.insertMany(rejected.slice(0, 2000).map((r) => ({ ...r, source: r.record.source })), { ordered: false }).catch(() => {});
  const withPriority = docs.map((d) => ({ ...d, priority: PRIORITY[d.source] ?? 2, mirror: false }));
  const res = await ingest(WorldFlow, withPriority, { level: 6, source: 'monde', keys: ['reporter', 'partner', 'product', 'year', 'flow'], priority: true });
  return { ...res, rejected: res.rejected + rejected.length };
}

/**
 * Mise à jour des sources configurées (WORLD_SOURCES=us-census,uk-hmrc,ssb,comtrade).
 * Une source en échec n'empêche jamais les autres de se mettre à jour.
 */
export async function updateWorldSources({ sources = [], hs6 = [], periods = [], comtradeKey, comtradeReporters = [] } = {}) {
  const report = { fx: await fetchEcbRates(['USD', 'GBP', 'NOK', 'CHF', 'JPY', 'CAD', 'BRL']).catch((e) => ({ error: e.message })), sources: {} };
  for (const id of sources) {
    const c = CONNECTORS[id];
    if (!c) {
      report.sources[id] = { error: 'source inconnue' };
      continue;
    }
    try {
      const records = await c.fetchData({ hs6, periods, apiKey: comtradeKey, reporters: comtradeReporters });
      report.sources[id] = { records: records.length, ...(await ingestWorldRecords(records)) };
    } catch (e) {
      report.sources[id] = { error: e.message };
    }
  }
  return report;
}
