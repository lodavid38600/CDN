// Import manuel des données Comext d'Eurostat (la mise à jour automatique utilise le même service).
//
// Exemples :
//   npm run import:eurostat -- --products 22042109,87032319 --from 2021-01 --to 2024-12
//   npm run import:eurostat -- --products 22042109 --reporters FR,IT --partners US,CN,GB --from 2023-01
//   npm run import:eurostat -- --from-db --from 2024-01        (tous les codes NC déjà en base)
//
// Après l'import, la nomenclature est resynchronisée et la version des données incrémentée.
import { parseArgs } from 'node:util';
import { connectDb, disconnectDb } from '../db.js';
import { Product } from '../models/Product.js';
import { importEurostat, monthRange } from '../services/eurostat.js';
import { syncNomenclature } from '../services/ncSync.js';
import { syncWorld } from '../services/worldSync.js';
import { bumpDataVersion } from '../services/dataVersion.js';

const now = new Date();
const { values: args } = parseArgs({
  options: {
    products: { type: 'string' },
    'from-db': { type: 'boolean', default: false },
    reporters: { type: 'string' },
    partners: { type: 'string' },
    from: { type: 'string', default: `${now.getFullYear() - 2}-01` },
    to: { type: 'string', default: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}` },
    'batch-size': { type: 'string', default: '10' },
  },
});
const csv = (s) => (s ? s.split(',').map((v) => v.trim()).filter(Boolean) : undefined);

async function main() {
  await connectDb();
  let products = csv(args.products) || [];
  if (args['from-db']) products = [...products, ...(await Product.distinct('code', { status: { $ne: 'obsolete' } }))];
  if (!products.length) throw new Error('Indiquez --products <codes NC8> ou --from-db');
  const report = await importEurostat({
    products, reporters: csv(args.reporters), partners: csv(args.partners),
    months: monthRange(args.from, args.to), batchSize: Number(args['batch-size']) || 10,
    onProgress: (m) => console.log(`  ${m}`),
  });
  console.log('Import :', report);
  console.log('Nomenclature NC8 :', await syncNomenclature({ level: 8 }));
  console.log('Monde :', await syncWorld());
  console.log('Version des données :', await bumpDataVersion({ lastImport: new Date() }));
  await disconnectDb();
}

main().catch(async (err) => {
  console.error(err.message);
  await disconnectDb();
  process.exit(1);
});
