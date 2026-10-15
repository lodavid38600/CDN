import { Meta } from '../models/System.js';

// Version des données partagée par toutes les instances (clé de cache, fraîcheur affichée).
let cached = { version: 0, updatedAt: null, info: {} };
let readAt = 0;
const listeners = new Set();

export async function getDataVersion({ maxAgeMs = 5000 } = {}) {
  if (Date.now() - readAt < maxAgeMs) return cached;
  const doc = await Meta.findOne({ key: 'data' }).lean();
  const next = doc ? { version: doc.version, updatedAt: doc.updatedAt, info: doc.info || {} } : { version: 0, updatedAt: null, info: {} };
  if (next.version !== cached.version) for (const fn of listeners) fn(next);
  cached = next;
  readAt = Date.now();
  return cached;
}

/** Incrémente la version après un import ou une synchronisation. */
export async function bumpDataVersion(info = {}) {
  const set = { updatedAt: new Date() };
  for (const [k, v] of Object.entries(info)) set[`info.${k}`] = v;
  const doc = await Meta.findOneAndUpdate({ key: 'data' }, { $inc: { version: 1 }, $set: set }, { upsert: true, returnDocument: 'after' }).lean();
  readAt = 0;
  await getDataVersion();
  return doc.version;
}

/** Abonnement aux changements de version (vidage des caches en mémoire). */
export function onDataVersionChange(fn) {
  listeners.add(fn);
}
