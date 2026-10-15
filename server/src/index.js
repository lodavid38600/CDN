import { config } from './config.js';
import { connectDb } from './db.js';
import { createApp } from './app.js';
import { startScheduler } from './services/scheduler.js';
import { getDataRange } from './services/dataRange.js';
import { onDataVersionChange } from './services/dataVersion.js';
import { TradeFlow } from './models/TradeFlow.js';
import { WorldFlow } from './models/WorldFlow.js';
import { ensureCubes } from './services/cubes.js';
import { migrateLegacyUsers } from './services/accounts.js';

// Période couverte calculée d'avance (au démarrage et à chaque nouvel import) : aucune page ne l'attend
const warmUp = () => Promise.all([getDataRange(TradeFlow), getDataRange(WorldFlow)]).catch((e) => console.error('Calcul de la période :', e.message));
// Tables de synthèse absentes ou périmées (base existante, import fait ailleurs) : construites en arrière-plan
const warmCubes = () => ensureCubes()
  .then((r) => r?.result?.ms && console.log(`Tables de synthèse prêtes (${Math.round(r.result.ms / 1000)} s)`))
  .catch((e) => console.error('Tables de synthèse :', e.message));

await connectDb();
console.log(`MongoDB connecté (${config.mongoUrl.replace(/\/\/.*@/, '//***@')})`);
const migrated = await migrateLegacyUsers();
if (migrated) console.log(`${migrated} compte(s) rattaché(s) à une société`);
createApp().listen(config.port, () => {
  console.log(`API douanière démarrée sur http://localhost:${config.port}`);
  warmUp();
  warmCubes();
  onDataVersionChange(() => setTimeout(() => { warmUp(); warmCubes(); }, 0));
  if (startScheduler()) console.log(`Mise à jour automatique activée (toutes les ${config.autoUpdate.intervalHours} h)`);
});
