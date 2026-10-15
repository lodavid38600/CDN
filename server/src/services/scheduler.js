// Planificateur intégré : vérifie toutes les 15 minutes si une mise à jour est due.
import { config } from '../config.js';
import { JobRun } from '../models/System.js';
import { runUpdateLocked } from './updateJob.js';

let timer = null;

export async function isUpdateDue(now = new Date()) {
  const last = await JobRun.findOne({ name: 'mise-a-jour', status: { $in: ['success', 'partial'] } }).sort({ startedAt: -1 }).lean();
  if (!last) return true;
  return now - new Date(last.startedAt) >= config.autoUpdate.intervalHours * 3600 * 1000;
}

export function startScheduler({ everyMs = 15 * 60 * 1000 } = {}) {
  if (!config.autoUpdate.enabled || timer) return false;
  const tick = async () => {
    try {
      if (await isUpdateDue()) {
        const { ran, result } = await runUpdateLocked();
        if (ran) console.log(`Mise à jour des données : ${result.status}`);
      }
    } catch (e) {
      console.error('Mise à jour automatique en échec :', e.message);
    }
  };
  timer = setInterval(tick, everyMs);
  timer.unref();
  setTimeout(tick, 30_000).unref();
  return true;
}

export function stopScheduler() {
  clearInterval(timer);
  timer = null;
}
