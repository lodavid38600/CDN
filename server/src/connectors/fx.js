// Conversion en euros : taux mensuels de la BCE (1 EUR = taux × devise).
// Repli automatique sur le mois disponible le plus proche, puis sur une moyenne annuelle intégrée.
import { FxRate } from '../models/System.js';

// Moyennes annuelles BCE (2025-2026 : estimations, remplacées dès que les taux mensuels sont chargés)
export const ANNUAL_FALLBACK = {
  USD: { 2015: 1.1095, 2016: 1.1069, 2017: 1.1297, 2018: 1.181, 2019: 1.1195, 2020: 1.1422, 2021: 1.1827, 2022: 1.053, 2023: 1.0813, 2024: 1.0824, 2025: 1.13, 2026: 1.15 },
  GBP: { 2015: 0.7258, 2016: 0.8195, 2017: 0.8767, 2018: 0.8847, 2019: 0.8778, 2020: 0.8897, 2021: 0.8596, 2022: 0.8528, 2023: 0.8698, 2024: 0.8466, 2025: 0.85, 2026: 0.86 },
  NOK: { 2015: 8.9496, 2016: 9.2906, 2017: 9.327, 2018: 9.5975, 2019: 9.8511, 2020: 10.7228, 2021: 10.1633, 2022: 10.1026, 2023: 11.4248, 2024: 11.629, 2025: 11.7, 2026: 11.6 },
  CHF: { 2015: 1.0679, 2016: 1.0902, 2017: 1.1117, 2018: 1.155, 2019: 1.1124, 2020: 1.0705, 2021: 1.0811, 2022: 1.0047, 2023: 0.9718, 2024: 0.9526, 2025: 0.94, 2026: 0.93 },
  JPY: { 2015: 134.31, 2016: 120.2, 2017: 126.71, 2018: 130.4, 2019: 122.01, 2020: 121.85, 2021: 129.88, 2022: 138.03, 2023: 151.99, 2024: 163.85, 2025: 165, 2026: 165 },
  CAD: { 2015: 1.4186, 2016: 1.4659, 2017: 1.4647, 2018: 1.5294, 2019: 1.4855, 2020: 1.53, 2021: 1.4826, 2022: 1.3695, 2023: 1.4595, 2024: 1.4821, 2025: 1.57, 2026: 1.58 },
  BRL: { 2015: 3.7004, 2016: 3.8561, 2017: 3.6054, 2018: 4.3085, 2019: 4.4134, 2020: 5.8943, 2021: 6.3779, 2022: 5.4399, 2023: 5.401, 2024: 5.8283, 2025: 6.3, 2026: 6.3 },
};

/** Table de conversion en mémoire, chargée une fois par lot. */
export async function loadFx(currencies) {
  const rows = await FxRate.find({ currency: { $in: currencies } }).lean();
  const byCur = new Map();
  for (const r of rows) {
    if (!byCur.has(r.currency)) byCur.set(r.currency, new Map());
    byCur.get(r.currency).set(r.period, r.rate);
  }
  return {
    /** Taux pour une période « AAAA-MM » ; null si la devise est totalement inconnue. */
    rate(currency, period) {
      if (currency === 'EUR') return 1;
      const m = byCur.get(currency);
      if (m?.has(period)) return m.get(period);
      if (m?.size) {
        // Mois le plus proche disponible
        const target = Number(period.replace('-', ''));
        let best = null;
        let dist = Infinity;
        for (const [p, r] of m) {
          const d = Math.abs(Number(p.replace('-', '')) - target);
          if (d < dist) {
            dist = d;
            best = r;
          }
        }
        if (dist <= 200) return best; // au plus ~2 ans d'écart
      }
      const year = Number(period.slice(0, 4));
      const annual = ANNUAL_FALLBACK[currency];
      if (!annual) return null;
      const years = Object.keys(annual).map(Number);
      const y = years.reduce((a, b) => (Math.abs(b - year) < Math.abs(a - year) ? b : a));
      return annual[y];
    },
  };
}

/** Télécharge les taux mensuels BCE (API SDMX, CSV). */
export async function fetchEcbRates(currencies, { from = '2015-01' } = {}) {
  const report = [];
  for (const cur of currencies) {
    try {
      const url = `https://data-api.ecb.europa.eu/service/data/EXR/M.${cur}.EUR.SP00.A?format=csvdata&startPeriod=${from}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const lines = (await res.text()).trim().split(/\r?\n/);
      const head = lines[0].split(',');
      const iP = head.indexOf('TIME_PERIOD');
      const iV = head.indexOf('OBS_VALUE');
      const ops = lines.slice(1).map((l) => l.split(',')).filter((c) => Number(c[iV]) > 0).map((c) => ({
        updateOne: { filter: { currency: cur, period: c[iP] }, update: { $set: { rate: Number(c[iV]), source: 'ecb' } }, upsert: true },
      }));
      if (ops.length) await FxRate.bulkWrite(ops, { ordered: false });
      report.push({ currency: cur, months: ops.length });
    } catch (e) {
      report.push({ currency: cur, error: e.message });
    }
  }
  return report;
}
