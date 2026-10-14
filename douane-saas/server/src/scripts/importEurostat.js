// Import des données Comext d'Eurostat (commerce UE / extra-UE par code NC8).
//
// Exemples :
//   npm run import:eurostat -- --products 22042109,87032319 --years 2021-2024
//   npm run import:eurostat -- --products 22042109 --reporters FR,IT --partners US,CN,GB --years 2023
//   npm run import:eurostat -- --from-db --years 2020-2024   (tous les codes NC déjà en base)
//
// Sans --reporters/--partners, tous les pays UE et les partenaires hors UE de référence sont interrogés.

import { parseArgs } from 'node:util';
import { config } from '../config.js';
import { connectDb, disconnectDb } from '../db.js';
import { EU_CODES, EU_COUNTRIES, EXTRA_EU_COUNTRIES } from '../data/countries.js';
import { Product } from '../models/Product.js';
import { TradeFlow } from '../models/TradeFlow.js';
import { toTradeFlows } from '../services/jsonstat.js';

const { values: args } = parseArgs({
  options: {
    products: { type: 'string' },
    'from-db': { type: 'boolean', default: false },
    reporters: { type: 'string' },
    partners: { type: 'string' },
    years: { type: 'string', default: String(new Date().getFullYear() - 2) },
    dataset: { type: 'string', default: config.eurostatDataset },
    'batch-size': { type: 'string', default: '10' },
  },
});

const csv = (s) => (s ? s.split(',').map((v) => v.trim()).filter(Boolean) : []);

function yearRange(spec) {
  const [a, b] = spec.split('-').map(Number);
  const years = [];
  for (let y = a; y <= (b || a); y++) years.push(y);
  return years;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchDataset(params) {
  const url = new URL(`${config.eurostatBaseUrl}/${args.dataset}`);
  url.searchParams.set('format', 'JSON');
  url.searchParams.set('lang', 'fr');
  url.searchParams.set('freq', 'A');
  for (const [k, list] of Object.entries(params)) for (const v of list) url.searchParams.append(k, v);

  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    if (res.status === 404 || res.status === 400) {
      console.warn(`  ⚠ ${res.status} — aucune donnée pour cette requête`);
      return null;
    }
    const wait = 2 ** attempt * 1000;
    console.warn(`  ⚠ HTTP ${res.status}, nouvel essai dans ${wait / 1000}s`);
    await new Promise((r) => setTimeout(r, wait));
  }
  throw new Error(`Échec de la requête Eurostat : ${url}`);
}

async function main() {
  await connectDb();
  let products = csv(args.products);
  if (args['from-db']) products = [...products, ...(await Product.distinct('code'))];
  products = [...new Set(products)].filter((p) => /^\d{8}$/.test(p));
  if (!products.length) throw new Error('Indiquez --products <codes NC8> ou --from-db');

  const reporters = csv(args.reporters).length ? csv(args.reporters) : EU_COUNTRIES.map((c) => c.code);
  const partners = csv(args.partners).length ? csv(args.partners) : EXTRA_EU_COUNTRIES.map((c) => c.code);
  const years = yearRange(args.years);
  const batches = chunk(products, Number(args['batch-size']) || 10);

  console.log(`Import ${args.dataset} : ${products.length} codes NC, ${reporters.length} déclarants, ${partners.length} partenaires, ${years.join(', ')}`);
  let total = 0;
  for (const [i, batch] of batches.entries()) {
    for (const reporter of reporters) {
      console.log(`[${i + 1}/${batches.length}] ${reporter} — ${batch.join(', ')}`);
      const data = await fetchDataset({ reporter: [reporter], partner: partners, product: batch, flow: ['1', '2'], time: years.map(String) });
      if (!data) continue;
      const { flows, products: labels } = toTradeFlows(data, { euCodes: EU_CODES });

      if (labels.length) {
        await Product.bulkWrite(labels.map((p) => ({ updateOne: { filter: { code: p.code }, update: { $set: p }, upsert: true } })));
      }
      if (flows.length) {
        await TradeFlow.bulkWrite(
          flows.map((f) => ({
            updateOne: {
              filter: { reporter: f.reporter, partner: f.partner, product: f.product, year: f.year, flow: f.flow },
              update: { $set: f },
              upsert: true,
            },
          })),
          { ordered: false }
        );
      }
      total += flows.length;
    }
  }
  console.log(`✔ ${total} lignes importées / mises à jour`);
  await disconnectDb();
}

main().catch(async (err) => {
  console.error(err.message);
  await disconnectDb();
  process.exit(1);
});
