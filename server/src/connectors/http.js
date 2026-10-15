// Requête HTTP robuste : délai maximal, nouvelles tentatives avec attente exponentielle.
export async function fetchJson(url, { method = 'GET', headers = {}, body, retries = Number(process.env.HTTP_RETRIES ?? 3), timeoutMs = 60_000 } = {}) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { method, headers: { Accept: 'application/json', ...headers }, body, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 404 || res.status === 204) return null;
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} : ${(await res.text()).slice(0, 200)}`);
        err.fatal = true;
        throw err;
      }
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    } catch (e) {
      last = e;
      if (e.fatal || attempt === retries) break;
      await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
    }
  }
  throw last;
}
