import { getDataVersion } from '../services/dataVersion.js';

// Cache mémoire des réponses statistiques (données identiques pour tous les utilisateurs).
// La clé inclut la version des données : un import ou une synchronisation, même lancé par
// un autre processus, rend immédiatement obsolètes toutes les réponses en cache.
const store = new Map();
const MAX = 800;
let storeVersion = null;

export function clearStatsCache() {
  store.clear();
}

export function statsCache(ttlMs = 60 * 60 * 1000) {
  return async (req, res, next) => {
    if (req.method !== 'GET') return next();
    let version;
    try {
      ({ version } = await getDataVersion());
    } catch {
      return next(); // base momentanément indisponible : pas de cache plutôt qu'une erreur
    }
    if (version !== storeVersion) {
      store.clear();
      storeVersion = version;
    }
    const key = req.originalUrl;
    const hit = store.get(key);
    res.set('X-Data-Version', String(version));
    if (hit && Date.now() - hit.at < ttlMs) {
      res.set('X-Cache', 'HIT');
      return res.json(hit.body);
    }
    const json = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode === 200 && storeVersion === version) {
        if (store.size >= MAX) store.delete(store.keys().next().value);
        store.set(key, { at: Date.now(), body });
      }
      return json(body);
    };
    next();
  };
}
