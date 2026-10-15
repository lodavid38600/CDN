// Mise à jour complète à la demande (même tâche que la mise à jour automatique).
//   npm run update                       toutes les étapes
//   npm run update -- --steps sync       seulement la synchronisation
import { parseArgs } from 'node:util';
import { connectDb, disconnectDb } from '../db.js';
import { runUpdateLocked } from '../services/updateJob.js';

const { values } = parseArgs({ options: { steps: { type: 'string' } } });
await connectDb();
try {
  const { ran, result } = await runUpdateLocked(values.steps ? { steps: values.steps.split(',') } : undefined);
  console.log(ran ? JSON.stringify(result, null, 2) : 'Une mise à jour est déjà en cours.');
} finally {
  await disconnectDb();
}
