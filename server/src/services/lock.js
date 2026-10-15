import { randomUUID } from 'node:crypto';
import { Lock } from '../models/System.js';

// Verrou distribué (une seule instance exécute une tâche à la fois), sous forme de bail court
// renouvelé tant que la tâche tourne : si le processus s'arrête (Ctrl+C, plantage, redémarrage),
// le verrou se libère de lui-même en moins de LEASE_MS — jamais de blocage pendant des heures.
const LEASE_MS = 90 * 1000;
const RENEW_MS = 30 * 1000;
const held = new Map(); // verrous détenus par ce processus : libérés à l'arrêt

let exitHooked = false;
function hookExit() {
  if (exitHooked) return;
  exitHooked = true;
  const release = (signal) => {
    Promise.all([...held.entries()].map(([name, owner]) => Lock.deleteOne({ _id: name, owner }).catch(() => {})))
      .finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
  };
  process.once('SIGINT', () => release('SIGINT'));
  process.once('SIGTERM', () => release('SIGTERM'));
}

/**
 * Exécute `fn` sous le verrou `name`.
 * @param maxMs durée maximale de la tâche (le bail n'est plus renouvelé au-delà)
 * @returns {Promise<{ ran: boolean, result?: any }>}
 */
export async function withLock(name, maxMs, fn) {
  const owner = randomUUID();
  const now = new Date();
  try {
    await Lock.findOneAndUpdate(
      { _id: name, $or: [{ expiresAt: { $lt: now } }, { owner }] },
      { $set: { owner, expiresAt: new Date(now.getTime() + LEASE_MS) } },
      { upsert: true }
    );
  } catch (e) {
    if (e.code === 11000) return { ran: false }; // déjà détenu par une autre instance
    throw e;
  }
  const current = await Lock.findById(name).lean();
  if (current?.owner !== owner) return { ran: false };
  held.set(name, owner);
  hookExit();
  const started = Date.now();
  const renew = setInterval(() => {
    if (Date.now() - started > maxMs) return;
    Lock.updateOne({ _id: name, owner }, { $set: { expiresAt: new Date(Date.now() + LEASE_MS) } }).catch(() => {});
  }, RENEW_MS);
  renew.unref();
  try {
    return { ran: true, result: await fn() };
  } finally {
    clearInterval(renew);
    held.delete(name);
    await Lock.deleteOne({ _id: name, owner });
  }
}

/**
 * Verrous posés par une version précédente (baux d'une heure, voire de 12 h) : supprimés au
 * démarrage. Un verrou actuel ne dépasse jamais un bail de LEASE_MS.
 */
export async function clearLegacyLocks() {
  const r = await Lock.deleteMany({ expiresAt: { $gt: new Date(Date.now() + LEASE_MS + 5000) } });
  return r.deletedCount;
}
