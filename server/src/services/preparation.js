// Travaux de préparation en cours (index, tables de synthèse, index de recherche), par exemple
// juste après une mise à jour de l'application : les pages peuvent être plus lentes pendant ce temps,
// on le dit aux utilisateurs plutôt que de les laisser attendre sans explication.
const running = new Map();

export function track(name, promise) {
  running.set(name, Date.now());
  return Promise.resolve(promise).finally(() => running.delete(name));
}

export const preparing = () => [...running.keys()];
