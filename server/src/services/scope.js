// Construit le périmètre d'une requête : collection (UE en NC8 ou monde en SH6), filtre MongoDB
// et étapes de conversion de nomenclature.
//
// Par défaut, tout est exprimé dans la nomenclature ACTUELLE : un code créé en 2022 affiche
// aussi son historique reconstitué à partir des anciens codes, et un code supprimé affiche
// sa continuation dans les nouveaux codes. `nc=brut` désactive cette harmonisation.
import { TradeFlow } from '../models/TradeFlow.js';
import { WorldFlow } from '../models/WorldFlow.js';
import { buildMatch, valueStages } from './filters.js';
import { getNcGraph } from './ncContext.js';
import { CUBES, CUBE_ORDER, cubeModel, cubesUsable } from './cubes.js';

export const SOURCES = { eu: { Model: TradeFlow, level: 8 }, world: { Model: WorldFlow, level: 6 } };

/** Filtre sur les codes actuels ; une ligne jamais synchronisée (sans `tc`) reste trouvable par son code. */
function currentCodeMatch(code, level) {
  const cond = code.length === level ? code : { $regex: `^${code}` };
  return { $or: [{ tc: cond }, { tc: { $exists: false }, product: cond }] };
}

const scaleStage = (fv, fq) => ({
  $addFields: {
    valueEur: { $multiply: ['$valueEur', fv] },
    quantityKg: { $multiply: ['$quantityKg', fq] },
    months: { $cond: [{ $isArray: '$months' }, { $map: { input: '$months', in: { $multiply: ['$$this', fv] } } }, '$months'] },
    monthsKg: { $cond: [{ $isArray: '$monthsKg' }, { $map: { input: '$monthsKg', in: { $multiply: ['$$this', fq] } } }, '$monthsKg'] },
  },
});

/**
 * @param {object} f filtres analysés (parseFilters)
 * @param {object} opts
 *   source: 'eu' | 'world'
 *   omit: dimensions de filtre ignorées (ex. ['flow'])
 *   raw: true pour les codes tels que déclarés (pas d'harmonisation)
 *   byProduct: true si l'on regroupe par code produit (ajoute le champ _p = code actuel)
 *   noPeriodSlice: ne pas restreindre les valeurs aux mois de la période
 *   dims: champs utilisés par les étapes suivantes (regroupement…) ; s'il est fourni, la requête
 *         peut être servie par une table de synthèse qui contient tous ces champs
 * @returns {{ Model, match, pre, mode, productField, components?, cube? }}
 */
export async function buildScope(f, { source = 'eu', omit = [], raw = false, byProduct = false, noPeriodSlice = false, dims = null } = {}) {
  const { Model, level } = SOURCES[source] || SOURCES.eu;
  let code = f.product;
  if (code && code.length > level) code = code.slice(0, level);
  const match = buildMatch({ ...f, product: undefined }, { omit });

  // Table de synthèse : mêmes résultats, beaucoup moins de lignes à parcourir
  const cube = source === 'eu' && !raw && dims ? await pickCube(match, dims, code, level) : null;
  if (cube) {
    if (code && cube !== 'product') match.$and = [{ chapter: code }];
    else if (code) Object.assign(match, currentCodeMatch(code, level));
    const pre = noPeriodSlice ? [] : valueStages(f);
    return { Model: cubeModel(cube), match, pre, mode: 'harmonized', level, code, cube, productField: '$product' };
  }
  const pre = [];
  let mode = 'harmonized';
  let components;

  if (raw) {
    mode = 'raw';
    if (code) match.product = code.length === level ? code : { $regex: `^${code}` };
    if (byProduct) pre.push({ $addFields: { _p: '$product' } });
  } else {
    const graph = await getNcGraph(level);
    if (code && code.length === level && graph.isObsolete(code)) {
      // Code supprimé : ses propres données puis sa part dans les codes qui l'ont remplacé.
      mode = 'continuation';
      const comps = [];
      for (const flow of ['import', 'export']) {
        for (const d of graph.descendants(code, flow)) comps.push({ ...d, flow });
      }
      components = comps;
      const codes = [...new Set(comps.map((c) => c.code))];
      match.product = { $in: codes };
      const branch = (field) => ({
        $switch: {
          branches: comps.map((c) => ({
            case: { $and: [{ $eq: ['$product', c.code] }, { $eq: ['$flow', c.flow] }, ...(c.from ? [{ $gte: ['$year', c.from] }] : [])] },
            then: field === 'f' ? c.f : c.fq,
          })),
          default: 0,
        },
      });
      pre.push({ $addFields: { _fv: branch('f'), _fq: branch('fq') } }, { $match: { $expr: { $gt: [{ $add: ['$_fv', '$_fq'] }, 0] } } }, scaleStage('$_fv', '$_fq'));
      if (byProduct) pre.push({ $addFields: { _p: code } });
    } else if (byProduct) {
      // Regroupement par code actuel : une ligne d'un ancien code se répartit entre ses successeurs.
      if (code) Object.assign(match, currentCodeMatch(code, level));
      pre.push(
        { $addFields: { _h: { $ifNull: ['$h', [{ t: '$product', fv: 1, fq: 1 }]] } } },
        { $unwind: '$_h' },
        ...(code ? [{ $match: { $expr: { $eq: [{ $substrBytes: ['$_h.t', 0, code.length] }, code] } } }] : []),
        { $addFields: { _p: '$_h.t' } },
        scaleStage('$_h.fv', '$_h.fq')
      );
    } else if (code) {
      // Filtre sur un code ou un préfixe actuel : seules les parts converties vers ce périmètre comptent.
      Object.assign(match, currentCodeMatch(code, level));
      const part = (k) => ({
        $cond: [
          { $isArray: '$h' },
          { $sum: { $map: { input: { $filter: { input: '$h', cond: { $eq: [{ $substrBytes: ['$$this.t', 0, code.length] }, code] } } }, in: `$$this.${k}` } } },
          1,
        ],
      });
      pre.push({ $addFields: { _fv: part('fv'), _fq: part('fq') } }, scaleStage('$_fv', '$_fq'));
    }
    // Sans filtre produit : les totaux bruts et harmonisés sont identiques (conservation de la masse).
  }
  if (!noPeriodSlice) pre.push(...valueStages(f));
  return { Model, match, pre, mode, level, code, components, productField: byProduct ? '$_p' : '$product' };
}

/** Plus petite table de synthèse capable de servir la requête, ou null (lignes détaillées). */
async function pickCube(match, dims, code, level) {
  const used = new Set([...Object.keys(match), ...dims]);
  for (const cube of CUBE_ORDER) {
    if (![...used].every((k) => CUBES[cube].fields.has(k))) continue;
    if (code && cube === 'product') {
      // Un code supprimé est servi par sa continuation dans les lignes détaillées
      if (code.length === level && (await getNcGraph(level)).isObsolete(code)) return null;
    } else if (code && (code.length !== 2 || !CUBES[cube].fields.has('chapter'))) continue;
    return (await cubesUsable()) ? cube : null;
  }
  return null;
}

/** Expression de regroupement pour une dimension (les codes produits suivent la nomenclature actuelle). */
export function dimensionExpr(dimension, scope) {
  if (scope.cube && scope.cube !== 'product' && (dimension === 'chapter' || dimension === 'section')) return `$${dimension}`;
  if (dimension === 'product') return scope.productField;
  if (dimension === 'hs6') return { $substrBytes: [scope.productField, 0, 6] };
  if (dimension === 'chapter') return { $substrBytes: [scope.productField, 0, 2] };
  return `$${dimension}`;
}
