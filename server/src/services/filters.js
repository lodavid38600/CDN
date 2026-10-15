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

function year(value, name) {
  const raw = asString(value);
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1988 || n > 2100) {
    throw new FilterError(`Année invalide pour ${name} : ${raw}`);
  }
  return n;
}

/**
 * Paramètres supportés :
 *  yearFrom, yearTo, year — période
 *  flow — import | export
 *  reporters — pays UE déclarants (FR,DE)
 *  partners — pays partenaires hors UE (US,CN)
 *  sections — sections NC (IV,XVI)
 *  chapters — chapitres NC (22,84)
 *  product — préfixe de code NC (2 à 8 chiffres)
 */
export function parseFilters(query = {}) {
  const f = {};
  const single = year(query.year, 'year');
  f.yearFrom = single ?? year(query.yearFrom, 'yearFrom');
  f.yearTo = single ?? year(query.yearTo, 'yearTo');
  if (f.yearFrom && f.yearTo && f.yearFrom > f.yearTo) {
    throw new FilterError('yearFrom doit être inférieur ou égal à yearTo');
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
  if (!omit.includes('year') && (f.yearFrom || f.yearTo)) {
    m.year = {};
    if (f.yearFrom) m.year.$gte = f.yearFrom;
    if (f.yearTo) m.year.$lte = f.yearTo;
  }
  if (!omit.includes('flow') && f.flow) m.flow = f.flow;
  if (f.reporters) m.reporter = { $in: f.reporters };
  if (f.partners) m.partner = { $in: f.partners };
  if (f.sections) m.section = { $in: f.sections };
  if (f.chapters) m.chapter = { $in: f.chapters };
  if (f.product) {
    m.product = f.product.length === 8 ? f.product : { $regex: `^${f.product}` };
  }
  return m;
}

export function pagination(query, { defaultLimit = 50, maxLimit = 500 } = {}) {
  const page = Math.max(1, Number.parseInt(asString(query.page) ?? '1', 10) || 1);
  const limit = Math.min(
    maxLimit,
    Math.max(1, Number.parseInt(asString(query.limit) ?? String(defaultLimit), 10) || defaultLimit)
  );
  return { page, limit, skip: (page - 1) * limit };
}
