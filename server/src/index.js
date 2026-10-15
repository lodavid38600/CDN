import { config } from './config.js';
import { connectDb } from './db.js';
import { createApp } from './app.js';
import { startScheduler } from './services/scheduler.js';
import { getDataRange } from './services/dataRange.js';
import { onDataVersionChange } from './services/dataVersion.js';
import { TradeFlow } from './models/TradeFlow.js';
import { WorldFlow } from './models/WorldFlow.js';

// Période couverte calculée d'avance (au démarrage et à chaque nouvel import) : aucune page ne l'attend
const warmUp = () => Promise.all([getDataRange(TradeFlow), getDataRange(WorldFlow)]).catch((e) => console.error('Calcul de la période :', e.message));

await connectDb();
console.log(`MongoDB connecté (${config.mongoUrl.replace(/\/\/.*@/, '//***@')})`);
createApp().listen(config.port, () => {
  console.log(`API douanière démarrée sur http://localhost:${config.port}`);
  warmUp();
  onDataVersionChange(() => setTimeout(warmUp, 0));
  if (startScheduler()) console.log(`Mise à jour automatique activée (toutes les ${config.autoUpdate.intervalHours} h)`);
});
