// Moteur d'évolution de la nomenclature (NC8 ou SH6), sans accès à la base.
//
// Un lien { from, to, year } signifie : « les marchandises déclarées sous `from` jusqu'à
// l'année year-1 sont déclarées sous `to` à partir de l'année year ». Un code peut éclater
// (1 → n), fusionner (n → 1), être renommé (1 → 1), continuer partiellement (lien from → from),
// disparaître puis être réutilisé pour un autre produit.
//
// Les données de chaque code sont converties vers les codes « terminaux » (sans successeur) :
// c'est la nomenclature actuelle. La conversion conserve la masse : la somme des valeurs
// converties est toujours égale à la somme des valeurs déclarées.

const SOURCE_RANK = { manual: 4, official: 3, inferred: 2, implicit: 1 };
const MAX_DEPTH = 60;

/**
 * Valide et dédoublonne une liste de liens.
 * @returns {{ valid: object[], rejected: { link: object, reason: string }[] }}
 */
export function validateLinks(links, { level = 8, minYear = 1988, maxYear = 2100 } = {}) {
  const re = new RegExp(`^\\d{${level}}$`);
  const rejected = [];
  const byKey = new Map();
  for (const raw of links || []) {
    const link = {
      ...raw,
      from: String(raw?.from ?? '').replace(/[\s.]/g, ''),
      to: String(raw?.to ?? '').replace(/[\s.]/g, ''),
      year: Number(raw?.year),
      source: raw?.source || 'official',
    };
    let reason = null;
    if (!re.test(link.from)) reason = `code d'origine invalide (${raw?.from})`;
    else if (!re.test(link.to)) reason = `code de destination invalide (${raw?.to})`;
    else if (!Number.isInteger(link.year) || link.year < minYear || link.year > maxYear) reason = `année invalide (${raw?.year})`;
    else if (!SOURCE_RANK[link.source]) reason = `source inconnue (${raw?.source})`;
    if (reason) {
      rejected.push({ link: raw, reason });
      continue;
    }
    const key = `${link.from}|${link.to}|${link.year}`;
    const prev = byKey.get(key);
    if (!prev || SOURCE_RANK[link.source] > SOURCE_RANK[prev.source]) byKey.set(key, link);
  }
  // Un lien vers soi-même n'a de sens que s'il accompagne d'autres liens la même année
  // (le code continue d'exister pour une partie des marchandises).
  const valid = [];
  const outCount = new Map();
  for (const l of byKey.values()) {
    if (l.from !== l.to) outCount.set(`${l.from}|${l.year}`, (outCount.get(`${l.from}|${l.year}`) || 0) + 1);
  }
  for (const l of byKey.values()) {
    if (l.from === l.to && !outCount.get(`${l.from}|${l.year}`)) {
      rejected.push({ link: l, reason: 'lien vers soi-même isolé (aucun changement)' });
      continue;
    }
    valid.push(l);
  }
  // Les liens officiels priment sur les liens déduits pour un même code et une même année.
  const officialOut = new Set(valid.filter((l) => SOURCE_RANK[l.source] >= 3).map((l) => `${l.from}|${l.year}`));
  const kept = valid.filter((l) => {
    if (SOURCE_RANK[l.source] < 3 && officialOut.has(`${l.from}|${l.year}`)) {
      rejected.push({ link: l, reason: 'remplacé par un lien officiel' });
      return false;
    }
    return true;
  });
  return { valid: kept, rejected };
}

export class NcGraph {
  /**
   * @param {object[]} links liens validés (avec éventuellement `weights`)
   * @param {object} opts { isCurrent(code) : le code existe dans la nomenclature actuelle }
   */
  constructor(links = [], { isCurrent = () => false } = {}) {
    this.isCurrent = isCurrent;
    this.out = new Map();
    this.in = new Map();
    for (const l of links) {
      if (!this.out.has(l.from)) this.out.set(l.from, []);
      if (!this.in.has(l.to)) this.in.set(l.to, []);
      this.out.get(l.from).push(l);
      this.in.get(l.to).push(l);
    }
    for (const arr of this.out.values()) arr.sort((a, b) => a.year - b.year || a.to.localeCompare(b.to));
  }

  /** Codes ayant au moins un lien sortant (codes modifiés). */
  changedCodes() {
    return [...this.out.keys()];
  }

  exitYears(code) {
    return [...new Set((this.out.get(code) || []).map((l) => l.year))];
  }

  linksAt(code, year) {
    return (this.out.get(code) || []).filter((l) => l.year === year);
  }

  hasChanged(code) {
    return (this.out.get(code) || []).some((l) => l.to !== code);
  }

  /** Code remplacé et absent de la nomenclature actuelle. */
  isObsolete(code) {
    return this.hasChanged(code) && !this.isCurrent(code);
  }

  /** Poids d'un lien pour un flux : s (répartition de l'ancien code), a (part attribuable au nouveau). */
  static weight(link, flow, n, kind) {
    const w = link.weights?.[flow];
    const v = w?.[kind];
    return Number.isFinite(v) && v >= 0 ? v : 1 / n;
  }

  /**
   * Convertit une déclaration (code, année, flux) vers les codes terminaux.
   * @returns {{ t: string, fv: number, fq: number }[]} facteurs valeur / quantité
   */
  convert(code, year, flow, depth = 0) {
    const exits = this.exitYears(code);
    let next = exits.find((y) => y > year);
    // Donnée « tardive » d'un code supprimé (toujours déclarée après son remplacement) :
    // on la rattache aux successeurs, sauf si le code a été réutilisé (code actuel).
    if (next === undefined && depth === 0 && exits.length && year >= exits.at(-1) && !this.isCurrent(code)) next = exits.at(-1);
    if (next === undefined || depth > MAX_DEPTH) return [{ t: code, fv: 1, fq: 1 }];

    const links = this.linksAt(code, next);
    const acc = new Map();
    for (const l of links) {
      const sv = NcGraph.weight(l, flow, links.length, 's');
      const sq = NcGraph.weight(l, flow, links.length, 'sq');
      // Lien vers soi-même : la part qui reste sous ce code (terminal à partir de `next`).
      const children = l.to === code ? this._continue(code, next, flow, depth) : this.convert(l.to, next, flow, depth + 1);
      for (const c of children) {
        const e = acc.get(c.t) || { t: c.t, fv: 0, fq: 0 };
        e.fv += sv * c.fv;
        e.fq += sq * c.fq;
        acc.set(c.t, e);
      }
    }
    return normalize([...acc.values()]);
  }

  _continue(code, year, flow, depth) {
    const later = this.exitYears(code).find((y) => y > year);
    return later === undefined ? [{ t: code, fv: 1, fq: 1 }] : this.convert(code, year, flow, depth + 1);
  }

  /**
   * Vue « ce qu'est devenu un code supprimé » : ses propres données (facteur 1) puis la part
   * qui lui est attribuable dans chacun de ses successeurs, sur leurs années de validité.
   * @returns {{ code, f, fq, from: number|null }[]}
   */
  descendants(code, flow) {
    const out = [{ code, f: 1, fq: 1, from: null }];
    const walk = (c, f, fq, fromYear, depth) => {
      if (depth > MAX_DEPTH) return;
      const years = this.exitYears(c).filter((y) => fromYear === null || y > fromYear);
      for (const y of years) {
        const links = this.linksAt(c, y);
        for (const l of links) {
          if (l.to === c) continue;
          const preds = this.in.get(l.to)?.filter((x) => x.year === y).length || 1;
          const a = NcGraph.weight(l, flow, preds, 'a');
          const aq = NcGraph.weight(l, flow, preds, 'aq');
          if (a === 0 && aq === 0) continue;
          out.push({ code: l.to, f: f * a, fq: fq * aq, from: y });
          walk(l.to, f * a, fq * aq, y, depth + 1);
        }
        // Une seule génération de successeurs par code : la première sortie après `fromYear`.
        break;
      }
    };
    walk(code, 1, 1, null, 0);
    // Fusionne les doublons (chemins multiples vers un même code, même année de départ).
    const merged = new Map();
    for (const d of out) {
      const k = `${d.code}|${d.from}`;
      const e = merged.get(k);
      if (e) {
        e.f += d.f;
        e.fq += d.fq;
      } else merged.set(k, { ...d });
    }
    return [...merged.values()];
  }
}

function normalize(entries) {
  // Corrige les dérives d'arrondi : la somme des facteurs vaut exactement 1.
  const sv = entries.reduce((s, e) => s + e.fv, 0);
  const sq = entries.reduce((s, e) => s + e.fq, 0);
  return entries
    .map((e) => ({ t: e.t, fv: sv > 0 ? e.fv / sv : 1 / entries.length, fq: sq > 0 ? e.fq / sq : 1 / entries.length }))
    .filter((e) => e.fv > 0 || e.fq > 0)
    .sort((a, b) => a.t.localeCompare(b.t));
}

/**
 * Calcule les poids de chaque lien à partir des volumes observés.
 * `totals(code, year, flow)` renvoie { v, q } (valeur, quantité) déclarés pour ce code.
 *  - s : part de l'ancien code répartie vers ce successeur (somme = 1 par code d'origine)
 *  - a : part du nouveau code attribuable à cet ancien code (somme = 1 par code de destination)
 * Si les volumes manquent l'année du changement, on regarde jusqu'à 3 ans autour ; à défaut,
 * répartition égale (confiance réduite).
 */
export function computeWeights(links, totals, flows = ['import', 'export']) {
  const look = (code, year, flow, dir) => {
    for (let k = 0; k < 3; k++) {
      const t = totals(code, year + dir * k, flow);
      if (t && (t.v > 0 || t.q > 0)) return t;
    }
    return { v: 0, q: 0 };
  };
  const groups = new Map(); // année -> liens
  for (const l of links) {
    if (!groups.has(l.year)) groups.set(l.year, []);
    groups.get(l.year).push(l);
  }
  const out = links.map((l) => ({ ...l, weights: {} }));
  const index = new Map(out.map((l) => [`${l.from}|${l.to}|${l.year}`, l]));

  for (const [year, group] of groups) {
    for (const flow of flows) {
      for (const kind of ['v', 'q']) {
        const prev = (c) => look(c, year - 1, flow, -1)[kind];
        const next = (c) => look(c, year, flow, 1)[kind];
        const predOf = (to) => group.filter((l) => l.to === to);
        const succOf = (from) => group.filter((l) => l.from === from);
        const r = new Map();
        for (const l of group) {
          const preds = predOf(l.to);
          const sumPrev = preds.reduce((s, p) => s + prev(p.from), 0);
          const share = sumPrev > 0 ? prev(l.from) / sumPrev : 1 / preds.length;
          r.set(l, next(l.to) * share);
        }
        const s = new Map();
        for (const l of group) {
          const succ = succOf(l.from);
          const sum = succ.reduce((acc, x) => acc + r.get(x), 0);
          s.set(l, sum > 0 ? r.get(l) / sum : 1 / succ.length);
        }
        for (const l of group) {
          const preds = predOf(l.to);
          const sum = preds.reduce((acc, p) => acc + prev(p.from) * s.get(p), 0);
          const a = sum > 0 ? (prev(l.from) * s.get(l)) / sum : 1 / preds.length;
          const target = index.get(`${l.from}|${l.to}|${l.year}`);
          target.weights[flow] ??= {};
          target.weights[flow][kind === 'v' ? 's' : 'sq'] = round6(s.get(l));
          target.weights[flow][kind === 'v' ? 'a' : 'aq'] = round6(a);
          if (kind === 'v') target.estimated = (target.estimated ?? true) && !(r.get(l) > 0);
        }
      }
    }
  }
  return out;
}

const round6 = (x) => Math.round(x * 1e6) / 1e6;

/**
 * Déduit les liens manquants : un code qui disparaît alors que de nouveaux codes apparaissent
 * l'année suivante dans la même position SH4 est relié à ceux qui partagent le plus long préfixe.
 * @param {Map<string, number[]>} yearsByCode années avec données
 */
export function inferLinks(yearsByCode, links, { level = 8, lastYear, minPrefix = 4 } = {}) {
  const outFrom = new Set(links.map((l) => l.from));
  const inTo = new Set(links.filter((l) => l.from !== l.to).map((l) => `${l.to}|${l.year}`));
  const first = new Map();
  const last = new Map();
  for (const [code, years] of yearsByCode) {
    if (!years.length) continue;
    first.set(code, Math.min(...years));
    last.set(code, Math.max(...years));
  }
  const inferred = [];
  const orphans = [];
  for (const [code, end] of last) {
    if (end >= lastYear - 1 || outFrom.has(code)) continue; // toujours actif, ou déjà relié
    const y = end + 1;
    const candidates = [...first.entries()].filter(([c, start]) => start === y && c !== code && !inTo.has(`${c}|${y}`));
    let best = 0;
    for (const [c] of candidates) best = Math.max(best, commonPrefix(c, code));
    if (best >= minPrefix) {
      for (const [c] of candidates.filter(([c2]) => commonPrefix(c2, code) === best)) {
        inferred.push({ from: code, to: c, year: y, source: 'inferred', confidence: round6(best / level) });
      }
    } else orphans.push({ code, lastYear: end });
  }
  return { inferred, orphans };
}

function commonPrefix(a, b) {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return i;
}

/**
 * Liens « implicites » vers soi-même : le code d'origine continue d'exister après un éclatement,
 * ou le code de destination existait déjà avant une fusion.
 */
export function implicitSelfLinks(links, yearsByCode) {
  const has = (c, y) => (yearsByCode.get(c) || []).includes(y);
  const seen = new Set(links.filter((l) => l.from === l.to).map((l) => `${l.from}|${l.year}`));
  const out = [];
  const add = (c, y) => {
    const key = `${c}|${y}`;
    if (seen.has(key)) return;
    out.push({ from: c, to: c, year: y, source: 'implicit' });
    seen.add(key);
  };
  for (const l of links) {
    if (l.from === l.to) continue;
    // L'ancien code reste utilisé après l'éclatement.
    if (has(l.from, l.year) && has(l.from, l.year + 1)) add(l.from, l.year);
    // Fusion dans un code qui existait déjà : sa propre masse antérieure compte dans l'attribution.
    if (has(l.to, l.year - 1)) add(l.to, l.year);
  }
  return out;
}

/** Liens SH6 déduits des liens NC8 (quand la sous-position change). */
export function deriveHs6Links(cn8Links) {
  const out = new Map();
  for (const l of cn8Links) {
    if (l.source === 'implicit') continue;
    const from = l.from.slice(0, 6);
    const to = l.to.slice(0, 6);
    if (from === to) continue;
    const key = `${from}|${to}|${l.year}`;
    if (!out.has(key)) out.set(key, { from, to, year: l.year, source: l.source === 'inferred' ? 'inferred' : 'official' });
  }
  return [...out.values()];
}
