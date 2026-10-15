// US Census Bureau : commerce des États-Unis, mensuel, SH6/SH10, en USD.
// API : https://api.census.gov/data/timeseries/intltrade — sans clé pour un usage modéré.
// Les poids publiés ne couvrent que les transports aérien et maritime (signalé dans `quality`).
import { fetchJson } from './http.js';
import { isoFromEnglishName, KNOWN } from './countryCodes.js';

export const info = {
  id: 'us-census', name: 'US Census Bureau', currency: 'USD', level: 'SH6', frequency: 'mensuelle',
  coverage: 'États-Unis', url: 'https://www.census.gov/foreign-trade', needsKey: null, priority: 3,
};

/** Normalise une réponse (tableau de tableaux, première ligne = en-têtes). */
export function normalize(rows, flow) {
  if (!Array.isArray(rows) || rows.length < 2) return [];
  const head = rows[0];
  const col = (name) => head.indexOf(name);
  const iName = col('CTY_NAME');
  const iVal = col(flow === 'export' ? 'ALL_VAL_MO' : 'GEN_VAL_MO');
  const iAir = col('AIR_WGT_MO');
  const iVes = col('VES_WGT_MO');
  const iCode = col(flow === 'export' ? 'E_COMMODITY' : 'I_COMMODITY');
  const iTime = col('time');
  const out = [];
  for (const r of rows.slice(1)) {
    const partner = isoFromEnglishName(r[iName]);
    const code = String(r[iCode] || '').slice(0, 6);
    const [y, m] = String(r[iTime] || '').split('-').map(Number);
    if (!partner || !KNOWN.has(partner) || partner === 'US' || !/^\d{6}$/.test(code) || !y || !m) continue;
    out.push({
      reporter: 'US', partner, product: code, flow, year: y, month: m,
      valueOrig: Number(r[iVal]) || 0, currency: 'USD',
      kg: (Number(r[iAir]) || 0) + (Number(r[iVes]) || 0), source: 'us-census', quality: ['poids-partiel'],
    });
  }
  return out;
}

export async function fetchData({ hs6, periods }) {
  const records = [];
  for (const flow of ['export', 'import']) {
    const base = `https://api.census.gov/data/timeseries/intltrade/${flow === 'export' ? 'exports' : 'imports'}/hs`;
    const fields = flow === 'export' ? 'CTY_NAME,ALL_VAL_MO,AIR_WGT_MO,VES_WGT_MO,E_COMMODITY' : 'CTY_NAME,GEN_VAL_MO,AIR_WGT_MO,VES_WGT_MO,I_COMMODITY';
    for (const code of hs6) {
      for (const p of periods) {
        const url = `${base}?get=${fields}&time=${p.slice(0, 4)}-${p.slice(4, 6)}&COMM_LVL=HS6&${flow === 'export' ? 'E' : 'I'}_COMMODITY=${code}`;
        records.push(...normalize(await fetchJson(url), flow));
      }
    }
  }
  return records;
}
