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
import { refreshSearchText } from './services/cnLabels.js';
import { Product } from './models/Product.js';
import mongoose from 'mongoose';
import { track } from './services/preparation.js';
import { clearLegacyLocks } from './services/lock.js';

// Période couverte calculée d'avance (au démarrage et à chaque nouvel import) : aucune page ne l'attend
const warmUp = () => Promise.all([getDataRange(TradeFlow), getDataRange(WorldFlow)]).catch((e) => console.error('Calcul de la période :', e.message));
// Tables de synthèse absentes ou périmées (base existante, import fait ailleurs) : construites en arrière-plan
// Réessai tant qu'elles ne sont pas prêtes (une autre instance peut être en train de les construire)
let cubesRetry;
const warmCubes = () => track('syntheses', ensureCubes())
  .then((r) => {
    if (r?.result?.ms) console.log(`Tables de synthèse prêtes (${Math.round(r.result.ms / 1000)} s)`);
    if (r && r.ran === false && r.result === undefined) { clearTimeout(cubesRetry); cubesRetry = setTimeout(warmCubes, 60 * 1000); }
  })
  .catch((e) => { console.error('Tables de synthèse :', e.message); clearTimeout(cubesRetry); cubesRetry = setTimeout(warmCubes, 5 * 60 * 1000); });

await connectDb();
console.log(`MongoDB connecté (${config.mongoUrl.replace(/\/\/.*@/, '//***@')})`);
const legacyLocks = await clearLegacyLocks();
if (legacyLocks) console.log(`${legacyLocks} ancien(s) verrou(x) libéré(s)`);
const migrated = await migrateLegacyUsers();
if (migrated) console.log(`${migrated} compte(s) rattaché(s) à une société`);
createApp().listen(config.port, () => {
  console.log(`API douanière démarrée sur http://localhost:${config.port}`);
  warmUp();
  warmCubes();
  // Index de recherche par mots (base existante ou produits ajoutés hors chargement)
  track('recherche', Product.exists({ $or: [{ st: { $exists: false } }, { st: '' }] }).then((missing) => missing && refreshSearchText())).catch((e) => console.error('Index de recherche :', e.message));
  // Index créés ou ajoutés par une nouvelle version : construits en arrière-plan
  track('index', Promise.all(Object.values(mongoose.models).map((m) => m.init()))).then(() => console.log('Index prêts')).catch((e) => console.error('Index :', e.message));
  onDataVersionChange(() => setTimeout(() => { warmUp(); warmCubes(); }, 0));
  if (startScheduler()) console.log(`Mise à jour automatique activée (toutes les ${config.autoUpdate.intervalHours} h)`);
});
