// Transforme les paramètres de requête en filtre MongoDB, en validant chaque valeur
// (liste blanche par expression régulière : aucune donnée brute n'atteint la base).

export class FilterError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const COUNTRY_RE = /^[A-Z]{2}$/;
const SECTION_RE = /^[IVX]{1,5}$/;
const CHAPTER_RE = /^\d{2}$/;
const PRODUCT_PREFIX_RE = /^\d{2,8}$/;
const PERIOD_RE = /^(\d{4})(?:-?(\d{2}))?$/;

function asString(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (Array.isArray(value)) return value.join(',');
  return String(value);
}

function list(value, re, name, transform = (v) => v) {
  const raw = asString(value);
  if (!raw) return undefined;
  const items = raw
    .split(',')
    .map((v) => transform(v.trim()))
    .filter(Boolean);
  for (const item of items) {
    if (!re.test(item)) throw new FilterError(`Valeur invalide pour ${name} : ${item}`);
  }
  return items.length ? [...new Set(items)] : undefined;
}

/** "2018-03" | "201803" | "2018" -> { y, m } ; `end` choisit décembre pour une année seule. */
export function parsePeriod(value, name, { end = false } = {}) {
  const raw = asString(value);
  if (!raw) return undefined;
  const m = PERIOD_RE.exec(raw.trim());
  if (!m) throw new FilterError(`Période invalide pour ${name} : ${raw} (format AAAA-MM)`);
  const y = Number(m[1]);
  const month = m[2] ? Number(m[2]) : end ? 12 : 1;
  if (y < 1988 || y > 2100 || month < 1 || month > 12) throw new FilterError(`Période invalide pour ${name} : ${raw}`);
  return { y, m: month };
}

export const periodKey = (p) => p.y * 100 + p.m; // 2018-03 -> 201803
export const periodFromKey = (k) => ({ y: Math.floor(k / 100), m: k % 100 });
export const formatPeriod = (p) => `${p.y}-${String(p.m).padStart(2, '0')}`;
export function shiftPeriod(p, months) {
  const idx = p.y * 12 + (p.m - 1) + months;
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
}
export const monthsBetween = (a, b) => (b.y - a.y) * 12 + (b.m - a.m) + 1;

/**
 * Paramètres supportés :
 *  periodFrom, periodTo — période au mois près (AAAA-MM) ; yearFrom, yearTo, year — raccourcis annuels
 *  flow — import | export
 *  reporters — pays UE déclarants (FR,DE)
 *  partners — pays partenaires hors UE (US,CN)
 *  sections — sections NC (IV,XVI)
 *  chapters — chapitres NC (22,84)
 *  product — préfixe de code NC (2 à 8 chiffres)
 */
export function parseFilters(query = {}) {
  const f = {};
  const single = parsePeriod(query.year, 'year');
  f.from = parsePeriod(query.periodFrom, 'periodFrom') ?? (single ? { y: single.y, m: 1 } : parsePeriod(query.yearFrom, 'yearFrom'));
  f.to =
    parsePeriod(query.periodTo, 'periodTo', { end: true }) ??
    (single ? { y: single.y, m: 12 } : parsePeriod(query.yearTo, 'yearTo', { end: true }));
  if (f.from && f.to && periodKey(f.from) > periodKey(f.to)) {
    throw new FilterError('Le début de période doit précéder la fin');
  }

  const flow = asString(query.flow);
  if (flow) {
    if (!['import', 'export'].includes(flow)) throw new FilterError('flow doit valoir import ou export');
    f.flow = flow;
  }

  f.reporters = list(query.reporters, COUNTRY_RE, 'reporters', (v) => v.toUpperCase());
  f.partners = list(query.partners, COUNTRY_RE, 'partners', (v) => v.toUpperCase());
  f.sections = list(query.sections, SECTION_RE, 'sections', (v) => v.toUpperCase());
  f.chapters = list(query.chapters, CHAPTER_RE, 'chapters', (v) => v.padStart(2, '0'));

  const product = asString(query.product)?.replace(/\s|\./g, '');
  if (product) {
    if (!PRODUCT_PREFIX_RE.test(product)) {
      throw new FilterError('product doit être un code NC de 2 à 8 chiffres');
    }
    f.product = product;
  }
  return f;
}

/** Construit le $match MongoDB. `omit` permet d'ignorer une dimension (ex. : flow). */
export function buildMatch(f, { omit = [] } = {}) {
  const m = {};
  if (!omit.includes('year') && (f.from || f.to)) {
    m.year = {};
    if (f.from) m.year.$gte = f.from.y;
    if (f.to) m.year.$lte = f.to.y;
  }
  if (!omit.includes('flow') && f.flow) m.flow = f.flow;
  if (f.reporters) m.reporter = { $in: f.reporters };
  if (f.partners) m.partner = { $in: f.partners };
  if (f.sections) m.section = { $in: f.sections };
  if (f.chapters) m.chapter = { $in: f.chapters };
  if (f.product) {
    if (f.product.length === 8) m.product = f.product;
    else if (f.product.length === 6) m.hs6 = f.product;
    else if (f.product.length === 2) m.chapter = f.product;
    else m.product = { $regex: `^${f.product}` };
  }
  return m;
}

/** Vrai si la période coupe une année (il faut alors sommer les mois). */
export const hasMonthBounds = (f) => Boolean((f.from && f.from.m > 1) || (f.to && f.to.m < 12));

function sliceSum(arrayField, totalField, f) {
  const start = f.from && f.from.m > 1 ? { $cond: [{ $eq: ['$year', f.from.y] }, f.from.m - 1, 0] } : 0;
  const end = f.to && f.to.m < 12 ? { $cond: [{ $eq: ['$year', f.to.y] }, f.to.m - 1, 11] } : 11;
  const count = { $add: [{ $subtract: [end, start] }, 1] };
  return {
    $cond: [
      { $isArray: arrayField },
      { $sum: { $slice: [arrayField, start, count] } },
      // Donnée annuelle sans détail mensuel : prorata du nombre de mois.
      { $multiply: [totalField, { $divide: [count, 12] }] },
    ],
  };
}

/**
 * Étapes à insérer après le $match : remplace valueEur / quantityKg par la somme
 * des seuls mois compris dans la période demandée.
 */
export function valueStages(f) {
  if (!hasMonthBounds(f)) return [];
  return [
    {
      $addFields: {
        valueEur: sliceSum('$months', '$valueEur', f),
        quantityKg: sliceSum('$monthsKg', '$quantityKg', f),
      },
    },
  ];
}

export function pagination(query, { defaultLimit = 50, maxLimit = 500 } = {}) {
  const page = Math.max(1, Number.parseInt(asString(query.page) ?? '1', 10) || 1);
  const limit = Math.min(
    maxLimit,
    Math.max(1, Number.parseInt(asString(query.limit) ?? String(defaultLimit), 10) || defaultLimit)
  );
  return { page, limit, skip: (page - 1) * limit };
}
