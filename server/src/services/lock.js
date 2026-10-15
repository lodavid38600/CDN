import { randomUUID } from 'node:crypto';
import { Lock } from '../models/System.js';

/**
 * Exécute `fn` sous un verrou distribué (une seule instance à la fois).
 * Le verrou expire tout seul (processus interrompu) : jamais de blocage définitif.
 * @returns {Promise<{ ran: boolean, result?: any }>}
 */
export async function withLock(name, ttlMs, fn) {
  const owner = randomUUID();
  const now = new Date();
  try {
    await Lock.findOneAndUpdate(
      { _id: name, $or: [{ expiresAt: { $lt: now } }, { owner }] },
      { $set: { owner, expiresAt: new Date(now.getTime() + ttlMs) } },
      { upsert: true }
    );
  } catch (e) {
    if (e.code === 11000) return { ran: false }; // déjà détenu par une autre instance
    throw e;
  }
  const held = await Lock.findById(name).lean();
  if (held?.owner !== owner) return { ran: false };
  try {
    return { ran: true, result: await fn() };
  } finally {
    await Lock.deleteOne({ _id: name, owner });
  }
}
