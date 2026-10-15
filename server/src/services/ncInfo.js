import { NcLink } from '../models/NcLink.js';
import { Product } from '../models/Product.js';
import { Nomenclature } from '../models/Nomenclature.js';

/**
 * Historique d'un code : prédécesseurs et successeurs (liens officiels ou déduits),
 * statut et années de validité. Sert aux bandeaux « code remplacé / code créé ».
 */
export async function codeHistory(code, level = 8) {
  const [outs, ins, product] = await Promise.all([
    NcLink.find({ level, from: code, $expr: { $ne: ['$from', '$to'] } }).sort({ year: 1 }).lean(),
    NcLink.find({ level, to: code, $expr: { $ne: ['$from', '$to'] } }).sort({ year: 1 }).lean(),
    level === 8 ? Product.findOne({ code }).lean() : null,
  ]);
  const codes = [...new Set([...outs.map((l) => l.to), ...ins.map((l) => l.from)])];
  const labels = new Map();
  if (codes.length) {
    const [ps, ns] = await Promise.all([
      Product.find({ code: { $in: codes } }, { code: 1, description: 1, status: 1 }).lean(),
      Nomenclature.find({ code: { $in: codes } }, { code: 1, label: 1 }).lean(),
    ]);
    for (const n of ns) labels.set(n.code, { label: n.label });
    for (const p of ps) labels.set(p.code, { label: p.description, status: p.status });
  }
  const view = (l, other) => ({
    code: other,
    label: labels.get(other)?.label || '',
    status: labels.get(other)?.status,
    year: l.year,
    source: l.source,
    share: l.weights?.export?.s ?? l.weights?.import?.s ?? null,
    attributable: l.weights?.export?.a ?? l.weights?.import?.a ?? null,
  });
  const successors = outs.map((l) => view(l, l.to));
  const predecessors = ins.map((l) => view(l, l.from));
  let status = product?.status || 'current';
  if (level === 6) status = successors.length ? 'obsolete' : 'current';
  return {
    status,
    validFrom: product?.validFrom ?? null,
    validTo: product?.validTo ?? null,
    successors,
    predecessors,
    changed: successors.length > 0 || predecessors.length > 0,
  };
}
