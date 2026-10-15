// Constitution / mise à jour de la base à partir des fichiers bulk Eurostat (Comext).
//   npm run bulk:sync                               depuis EUROSTAT_BULK_FROM (2015-01) jusqu'au mois courant
//   npm run bulk:sync -- --from 2023-01 --to 2023-12
//   npm run bulk:sync -- --force                    retraite même les fichiers inchangés
//   npm run bulk:sync -- --file chemin/full_v2_202301.7z   charge un fichier déjà téléchargé
import { parseArgs } from 'node:util';
import { connectDb, disconnectDb } from '../db.js';
import { syncBulk, processBulkFile } from '../services/eurostatBulk.js';
import { syncNomenclature } from '../services/ncSync.js';
import { syncWorld } from '../services/worldSync.js';
import { bumpDataVersion } from '../services/dataVersion.js';
import { withLock } from '../services/lock.js';
import { Nomenclature } from '../models/Nomenclature.js';
import { CHAPTERS } from '../data/nomenclature.js';

const { values } = parseArgs({
  options: { from: { type: 'string' }, to: { type: 'string' }, force: { type: 'boolean' }, file: { type: 'string', multiple: true } },
});
await connectDb();
try {
  // Libellés des chapitres NC02 (base vide : la grille de navigation en a besoin)
  await Nomenclature.bulkWrite(Object.entries(CHAPTERS).map(([code, label]) => ({ updateOne: { filter: { code }, update: { $setOnInsert: { code, level: 2, label } }, upsert: true } })));
  const { ran, result } = await withLock('mise-a-jour', 12 * 60 * 60 * 1000, async () => {
    let report;
    if (values.file) {
      report = { files: [] };
      for (const f of values.file) report.files.push({ file: f, ...(await processBulkFile(f)) });
    } else report = await syncBulk({ from: values.from, to: values.to, force: values.force, onProgress: (m) => console.log(m) });
    report.nc8 = await syncNomenclature({ level: 8 });
    report.world = await syncWorld();
    report.version = await bumpDataVersion({ lastUpdate: new Date(), lastUpdateStatus: report.failed ? 'partial' : 'success' });
    return report;
  });
  console.log(ran ? JSON.stringify(result, null, 2) : 'Une mise à jour est déjà en cours.');
} finally {
  await disconnectDb();
}
