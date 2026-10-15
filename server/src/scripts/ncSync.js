// Synchronisation manuelle de la nomenclature (tables de correspondance, liens déduits, conversion).
//   npm run nc:sync
import { connectDb, disconnectDb } from '../db.js';
import { syncNomenclature } from '../services/ncSync.js';
import { syncWorld } from '../services/worldSync.js';
import { bumpDataVersion } from '../services/dataVersion.js';
import { rebuildCubes } from '../services/cubes.js';

await connectDb();
try {
  const nc8 = await syncNomenclature({ level: 8 });
  console.log('NC8 :', { ...nc8, orphans: nc8.orphans.length, rejected: nc8.rejected.length });
  if (nc8.rejected.length) console.log('Liens rejetés :', nc8.rejected.slice(0, 20));
  if (nc8.orphans.length) console.log('Codes disparus sans successeur :', nc8.orphans.slice(0, 20));
  const world = await syncWorld();
  console.log('Monde :', { ...world, nc: { ...world.nc, orphans: world.nc.orphans.length, rejected: world.nc.rejected.length } });
  console.log('Version des données :', await bumpDataVersion({ lastSync: new Date() }));
  console.log('Tables de synthèse :', JSON.stringify(await rebuildCubes()));
} finally {
  await disconnectDb();
}
