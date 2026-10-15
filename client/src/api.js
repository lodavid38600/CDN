// Client HTTP minimal : ajoute le jeton JWT et convertit les erreurs de l'API.
import { ref } from 'vue';

const TOKEN_KEY = 'douane.token';

export const tokenStore = {
  get: () => {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  set: (t) => {
    try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* stockage indisponible */ }
  },
};

export function toQuery(params = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    q.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** Nombre de requêtes en cours (barre de chargement en haut de page). */
export const pending = ref(0);

export async function api(path, opts = {}) {
  pending.value += 1;
  try {
    return await request(path, opts);
  } finally {
    pending.value -= 1;
  }
}

async function request(path, { method = 'GET', body, params, raw = false } = {}) {
  const headers = {};
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`/api${path}${toQuery(params)}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401 && token) {
    tokenStore.set(null);
    window.location.assign('/connexion');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Erreur ${res.status}`);
  }
  if (raw) return res;
  // 204 (suppression…) : pas de corps à lire
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
