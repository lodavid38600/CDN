// Prévisions de séries temporelles, sans dépendance externe.
//  - Holt-Winters additif (saison de 12 mois) pour les séries mensuelles d'au moins 2 ans ;
//  - Holt à tendance amortie pour les séries annuelles ou courtes.
// Les paramètres de lissage sont choisis par recherche sur grille (erreur quadratique
// des prévisions à un pas) ; l'intervalle à 95 % s'élargit avec l'horizon.

const GRID = [0.05, 0.15, 0.3, 0.5, 0.7, 0.9];

function holtWintersFit(y, season, alpha, beta, gamma) {
  const n = y.length;
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  let level = mean(y.slice(0, season));
  let trend = (mean(y.slice(season, 2 * season)) - level) / season;
  const seasonal = y.slice(0, season).map((v) => v - level);
  let sse = 0;
  for (let t = 0; t < n; t++) {
    const s = seasonal[t % season];
    const pred = level + trend + s;
    if (t >= season) sse += (y[t] - pred) ** 2;
    const prevLevel = level;
    level = alpha * (y[t] - s) + (1 - alpha) * (level + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
    seasonal[t % season] = gamma * (y[t] - level) + (1 - gamma) * s;
  }
  return { sse, level, trend, seasonal, dof: Math.max(1, n - season) };
}

function holtFit(y, alpha, beta, phi) {
  let level = y[0];
  let trend = y.length > 1 ? y[1] - y[0] : 0;
  let sse = 0;
  for (let t = 1; t < y.length; t++) {
    const pred = level + phi * trend;
    sse += (y[t] - pred) ** 2;
    const prevLevel = level;
    level = alpha * y[t] + (1 - alpha) * (level + phi * trend);
    trend = beta * (level - prevLevel) + (1 - beta) * phi * trend;
  }
  return { sse, level, trend, dof: Math.max(1, y.length - 1) };
}

/**
 * @param {number[]} y série historique (pas réguliers)
 * @param {object} opts { horizon, season }
 * @returns {{ method, values:number[], lower:number[], upper:number[] }}
 */
export function forecast(y, { horizon = 12, season = 12 } = {}) {
  const clean = y.map((v) => (Number.isFinite(v) ? v : 0));
  if (clean.length < 3) return { method: 'insuffisant', values: [], lower: [], upper: [] };

  let best;
  if (season > 1 && clean.length >= 2 * season) {
    for (const a of GRID) for (const b of [0.01, 0.05, 0.15]) for (const g of GRID) {
      const fit = holtWintersFit(clean, season, a, b, g);
      if (!best || fit.sse < best.sse) best = { ...fit, a, b, g };
    }
    const sigma = Math.sqrt(best.sse / best.dof);
    const n = clean.length;
    const values = [], lower = [], upper = [];
    for (let h = 1; h <= horizon; h++) {
      const v = Math.max(0, best.level + h * best.trend + best.seasonal[(n + h - 1) % season]);
      const width = 1.96 * sigma * Math.sqrt(1 + (h - 1) * best.a ** 2);
      values.push(v);
      lower.push(Math.max(0, v - width));
      upper.push(v + width);
    }
    return { method: 'Holt-Winters saisonnier', values, lower, upper };
  }

  const phi = 0.9;
  for (const a of GRID) for (const b of [0.05, 0.15, 0.3, 0.5]) {
    const fit = holtFit(clean, a, b, phi);
    if (!best || fit.sse < best.sse) best = { ...fit, a, b };
  }
  const sigma = Math.sqrt(best.sse / best.dof);
  const values = [], lower = [], upper = [];
  let damp = 0;
  for (let h = 1; h <= horizon; h++) {
    damp += phi ** h;
    const v = Math.max(0, best.level + damp * best.trend);
    const width = 1.96 * sigma * Math.sqrt(h);
    values.push(v);
    lower.push(Math.max(0, v - width));
    upper.push(v + width);
  }
  return { method: 'Holt (tendance amortie)', values, lower, upper };
}
