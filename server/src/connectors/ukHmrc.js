// HMRC (Royaume-Uni) : commerce britannique par code de marchandise à 8 chiffres, mensuel, en GBP.
// API OData : https://api.uktradeinfo.com — sans clé.
import { fetchJson } from './http.js';
import { KNOWN } from './countryCodes.js';

export const info = {
  id: 'uk-hmrc', name: 'HMRC — UK Trade Info', currency: 'GBP', level: 'CN8 → SH6', frequency: 'mensuelle',
  coverage: 'Royaume-Uni', url: 'https://www.uktradeinfo.com', needsKey: null, priority: 3,
};

// FlowTypeId : 1 importations UE, 2 exportations UE, 3 importations hors UE, 4 exportations hors UE
const FLOWS = { 1: 'import', 2: 'export', 3: 'import', 4: 'export' };

/** Normalise une page OData (`value: [...]`, pays développé avec $expand=Country). */
export function normalize(json) {
  const out = [];
  for (const r of json?.value || []) {
    const flow = FLOWS[r.FlowTypeId];
    const partner = r.Country?.CountryCodeAlpha === 'GR' ? 'GR' : r.Country?.CountryCodeAlpha;
    const code = String(r.CommodityId ?? '').padStart(8, '0').slice(0, 6);
    const month = String(r.MonthId ?? '');
    if (!flow || !partner || !KNOWN.has(partner) || partner === 'GB' || !/^\d{6}$/.test(code) || !/^\d{6}$/.test(month)) continue;
    out.push({
      reporter: 'GB', partner, product: code, flow, year: Number(month.slice(0, 4)), month: Number(month.slice(4, 6)),
      valueOrig: Number(r.Value) || 0, currency: 'GBP', kg: Number(r.NetMass) || 0, source: 'uk-hmrc',
    });
  }
  return out;
}

export async function fetchData({ hs6, periods }) {
  const records = [];
  const from = periods[0];
  const to = periods.at(-1);
  for (const code of hs6) {
    // Les codes britanniques à 8 chiffres d'une sous-position : CommodityId entre code×100 et code×100+99
    let url = `https://api.uktradeinfo.com/OTS?$filter=MonthId ge ${from} and MonthId le ${to} and CommodityId ge ${Number(code) * 100} and CommodityId le ${Number(code) * 100 + 99}&$expand=Country`;
    while (url) {
      const page = await fetchJson(url);
      records.push(...normalize(page));
      url = page?.['@odata.nextLink'] || null;
    }
  }
  return records;
}
