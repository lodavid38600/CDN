// Cache mémoire des réponses statistiques (données identiques pour tous les utilisateurs).
// Durée courte : les imports Eurostat sont rares, et le cache se vide au redémarrage.
const store = new Map();
const MAX = 500;

export function clearStatsCache() {
  store.clear();
}

export function statsCache(ttlMs = 15 * 60 * 1000) {
  return (req, res, next) => {
    if (req.method !== 'GET') return next();
    const key = req.originalUrl;
    const hit = store.get(key);
    if (hit && Date.now() - hit.at < ttlMs) {
      res.set('X-Cache', 'HIT');
      return res.json(hit.body);
    }
    const json = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode === 200) {
        if (store.size >= MAX) store.delete(store.keys().next().value);
        store.set(key, { at: Date.now(), body });
      }
      return json(body);
    };
    next();
  };
}
