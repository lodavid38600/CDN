// Import des données Comext d'Eurostat (commerce UE / extra-UE par code NC8).
import { config } from '../config.js';
import { EU_CODES, EU_COUNTRIES, EXTRA_EU_COUNTRIES } from '../data/countries.js';
import { Product } from '../models/Product.js';
import { Nomenclature } from '../models/Nomenclature.js';
import { TradeFlow } from '../models/TradeFlow.js';
import { toTradeFlows } from './jsonstat.js';
import { ingest } from './ingest.js';
import { fetchJson } from '../connectors/http.js';

const chunk = (arr, size) => Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));

/** Liste des mois « AAAA-MM » entre deux bornes incluses. */
export function monthRange(from, to) {
  const out = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/**
 * @param {object} opts
 *   products : codes NC8 ; reporters / partners : codes pays ; months : liste « AAAA-MM »
 *   dataset, batchSize, onProgress
 */
export async function importEurostat({ products, reporters, partners, months, dataset = config.eurostatDataset, batchSize = 10, onProgress = () => {} }) {
  reporters ??= EU_COUNTRIES.map((c) => c.code);
  partners ??= EXTRA_EU_COUNTRIES.map((c) => c.code);
  const report = { requests: 0, failedRequests: 0, received: 0, valid: 0, rejected: 0, upserted: 0, modified: 0, labels: 0, errors: [] };
  const byYear = new Map();
  for (const p of months) {
    const [y, m] = p.split('-').map(Number);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(m - 1);
  }
  const time = months.map((p) => p.replace('-', 'M'));

  for (const batch of chunk([...new Set(products)].filter((p) => /^\d{8}$/.test(p)), batchSize)) {
    // Les codes parents (NC06) sont demandés aussi pour récupérer leurs libellés.
    const codes = [...batch, ...new Set(batch.map((p) => p.slice(0, 6)))];
    for (const reporter of reporters) {
      onProgress(`${reporter} — ${batch.join(', ')}`);
      const url = new URL(`${config.eurostatBaseUrl}/${dataset}`);
      url.searchParams.set('format', 'JSON');
      url.searchParams.set('lang', 'fr');
      url.searchParams.set('freq', 'M');
      url.searchParams.append('reporter', reporter);
      for (const p of partners) url.searchParams.append('partner', p);
      for (const c of codes) url.searchParams.append('product', c);
      url.searchParams.append('flow', '1');
      url.searchParams.append('flow', '2');
      for (const t of time) url.searchParams.append('time', t);
      report.requests += 1;
      let data;
      try {
        data = await fetchJson(url.toString());
      } catch (e) {
        report.failedRequests += 1;
        report.errors.push(`${reporter} ${batch[0]}… : ${e.message}`);
        continue; // une requête en échec n'interrompt pas l'import
      }
      if (!data) continue;
      const { flows, products: labels, nomenclature } = toTradeFlows(data, { euCodes: EU_CODES });
      if (nomenclature.length) {
        await Nomenclature.bulkWrite(nomenclature.map((n) => ({ updateOne: { filter: { code: n.code }, update: { $set: n }, upsert: true } })), { ordered: false });
      }
      if (labels.length) {
        await Product.bulkWrite(labels.map((p) => ({ updateOne: { filter: { code: p.code }, update: { $set: p }, upsert: true } })), { ordered: false });
        report.labels += labels.length;
      }
      const docs = flows.map((f) => ({ ...f, monthIdx: byYear.get(f.year) || undefined }));
      const r = await ingest(TradeFlow, docs, { level: 8, source: 'eurostat', keys: ['reporter', 'partner', 'product', 'year', 'flow'] });
      for (const k of ['received', 'valid', 'rejected', 'upserted', 'modified']) report[k] += r[k] || 0;
    }
  }
  return report;
}
