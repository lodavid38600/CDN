// UN Comtrade (Nations unies) : ~200 pays déclarants, SH6, mensuel ou annuel, en USD et kg.
// API : https://comtradeapi.un.org — clé d'abonnement gratuite (COMTRADE_API_KEY).
import { fetchJson } from './http.js';
import { ISO_BY_M49, M49_BY_ISO, KNOWN } from './countryCodes.js';

export const info = {
  id: 'comtrade', name: 'UN Comtrade (Nations unies)', currency: 'USD', level: 'SH6', frequency: 'mensuelle',
  coverage: 'Plus de 200 pays déclarants', url: 'https://comtradeplus.un.org', needsKey: 'COMTRADE_API_KEY', priority: 2,
};

/** Normalise une réponse JSON de l'API v1 (`data: [...]`). */
export function normalize(json) {
  const out = [];
  for (const r of json?.data || []) {
    const reporter = ISO_BY_M49[Number(r.reporterCode)];
    const partner = ISO_BY_M49[Number(r.partnerCode)];
    const flow = r.flowCode === 'M' ? 'import' : r.flowCode === 'X' ? 'export' : null;
    const period = String(r.period ?? r.refPeriodId ?? '');
    const hs6 = String(r.cmdCode ?? '');
    if (!reporter || !partner || !flow || !KNOWN.has(reporter) || !KNOWN.has(partner) || !/^\d{6}$/.test(hs6)) continue;
    if (!/^\d{6}$/.test(period)) continue; // mensuel uniquement (AAAAMM)
    out.push({
      reporter, partner, product: hs6, flow,
      year: Number(period.slice(0, 4)), month: Number(period.slice(4, 6)),
      valueOrig: Number(r.primaryValue ?? r.cifvalue ?? r.fobvalue ?? 0), currency: 'USD',
      kg: Number(r.netWgt ?? 0) || 0, source: 'comtrade',
    });
  }
  return out;
}

export async function fetchData({ reporters, hs6, periods, apiKey }) {
  if (!apiKey) throw new Error('COMTRADE_API_KEY manquante');
  const records = [];
  for (const iso of reporters) {
    const code = M49_BY_ISO[iso];
    if (!code) continue;
    // L'API limite le nombre de périodes et de codes par requête : 12 mois × 20 codes.
    for (let i = 0; i < periods.length; i += 12) {
      for (let j = 0; j < hs6.length; j += 20) {
        const url = `https://comtradeapi.un.org/data/v1/get/C/M/HS?reporterCode=${code}&period=${periods.slice(i, i + 12).join(',')}&cmdCode=${hs6.slice(j, j + 20).join(',')}&flowCode=M,X&includeDesc=false`;
        records.push(...normalize(await fetchJson(url, { headers: { 'Ocp-Apim-Subscription-Key': apiKey } })));
      }
    }
  }
  return records;
}
