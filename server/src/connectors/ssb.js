// Statistisk sentralbyrå (Norvège) : table 08799, commerce par code SH8 national, mensuel, en NOK.
// API PxWeb (JSON-stat 2), sans clé.
import { fetchJson } from './http.js';
import { cells } from '../services/jsonstat.js';
import { KNOWN } from './countryCodes.js';

export const info = {
  id: 'ssb', name: 'Statistisk sentralbyrå (Norvège)', currency: 'NOK', level: 'SH8 → SH6', frequency: 'mensuelle',
  coverage: 'Norvège', url: 'https://www.ssb.no/en/statbank/table/08799', needsKey: null, priority: 3,
};

/** Normalise une réponse JSON-stat 2 de la table 08799. */
export function normalize(dataset) {
  if (!dataset?.id) return [];
  const acc = new Map();
  for (const c of cells(dataset)) {
    const code = String(c.Varenummer ?? '').slice(0, 6);
    const partner = String(c.Land ?? '');
    const flow = String(c.ImpEks) === '1' ? 'import' : String(c.ImpEks) === '2' ? 'export' : null;
    const m = /^(\d{4})M(\d{2})$/.exec(String(c.Tid ?? ''));
    if (!flow || !m || !/^\d{6}$/.test(code) || !KNOWN.has(partner) || partner === 'NO') continue;
    const key = `${partner}|${code}|${flow}|${m[1]}|${m[2]}`;
    const e = acc.get(key) || { reporter: 'NO', partner, product: code, flow, year: Number(m[1]), month: Number(m[2]), valueOrig: 0, currency: 'NOK', kg: 0, source: 'ssb' };
    if (c.ContentsCode === 'Verdi') e.valueOrig += c.value;
    else if (c.ContentsCode === 'Mengde1') e.kg += c.value;
    acc.set(key, e);
  }
  return [...acc.values()];
}

export async function fetchData({ hs6, periods }) {
  const body = JSON.stringify({
    query: [
      { code: 'Varenummer', selection: { filter: 'agg:VareKoder8', values: hs6.map((h) => `${h}*`) } },
      { code: 'ImpEks', selection: { filter: 'item', values: ['1', '2'] } },
      { code: 'ContentsCode', selection: { filter: 'item', values: ['Verdi', 'Mengde1'] } },
      { code: 'Tid', selection: { filter: 'item', values: periods.map((p) => `${p.slice(0, 4)}M${p.slice(4, 6)}`) } },
    ],
    response: { format: 'json-stat2' },
  });
  const ds = await fetchJson('https://data.ssb.no/api/v0/en/table/08799', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
  return normalize(ds);
}
