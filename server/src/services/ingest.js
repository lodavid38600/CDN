// Écriture « incassable » des données :
//  - fusion mois par mois : un import partiel (ex. 6 derniers mois) ne remet jamais à zéro
//    les autres mois de l'année ;
//  - priorité entre sources : une source moins fiable n'écrase jamais une source plus fiable
//    (national / Eurostat > Comtrade > miroir) ;
//  - toute ligne passe d'abord les contrôles de qualité (sinon quarantaine) ;
//  - les totaux annuels sont recalculés à partir des mois, dans la base.
import { screen } from './quality.js';

const zeros = Array(12).fill(0);
const lit = (v) => ({ $literal: v });

function mergeMonths(field, values, idx) {
  return {
    $map: {
      input: { $range: [0, 12] },
      as: 'i',
      in: {
        $cond: [
          { $in: ['$$i', lit(idx)] },
          { $arrayElemAt: [lit(values), '$$i'] },
          { $arrayElemAt: [{ $ifNull: [`$${field}`, lit(zeros)] }, '$$i'] },
        ],
      },
    },
  };
}

/**
 * @param {Model} Model TradeFlow ou WorldFlow
 * @param {object[]} docs lignes validées, avec `monthIdx` (mois présents dans l'import, 0-11)
 * @param {object} opts { keys: champs de la clé unique, priority: garde de priorité }
 */
export async function upsertMonthly(Model, docs, { keys, priority = false } = {}) {
  const report = { upserted: 0, modified: 0, skippedLowerPriority: 0, errors: 0 };
  if (!docs.length) return report;
  const ops = docs.map((d) => {
    const idx = d.monthIdx?.length ? d.monthIdx : [...Array(12).keys()];
    const filter = Object.fromEntries(keys.map((k) => [k, d[k]]));
    if (priority) filter.priority = { $lte: d.priority ?? 0 };
    const { monthIdx, months, monthsKg, valueEur, quantityKg, tc, h, ...rest } = d;
    const set = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined).map(([k, v]) => [k, lit(v)]));
    if (!Array.isArray(months)) {
      // Donnée annuelle sans détail mensuel
      return { updateOne: { filter, upsert: true, update: [{ $set: { ...set, valueEur: lit(valueEur), quantityKg: lit(quantityKg ?? 0), tc: { $ifNull: ['$tc', ['$product']] } } }] } };
    }
    return {
      updateOne: {
        filter,
        upsert: true,
        update: [
          { $set: { ...set, months: mergeMonths('months', months, idx), monthsKg: mergeMonths('monthsKg', monthsKg, idx) } },
          { $set: { valueEur: { $sum: '$months' }, quantityKg: { $sum: '$monthsKg' }, tc: { $ifNull: ['$tc', ['$product']] } } },
        ],
      },
    };
  });
  for (let i = 0; i < ops.length; i += 2000) {
    try {
      const r = await Model.bulkWrite(ops.slice(i, i + 2000), { ordered: false });
      report.upserted += r.upsertedCount;
      report.modified += r.modifiedCount;
    } catch (e) {
      const res = e.result;
      report.upserted += res?.upsertedCount ?? res?.nUpserted ?? 0;
      report.modified += res?.modifiedCount ?? res?.nModified ?? 0;
      for (const we of e.writeErrors || []) {
        if (we.code === 11000 || we.err?.code === 11000) report.skippedLowerPriority += 1;
        else report.errors += 1;
      }
    }
  }
  return report;
}

/**
 * Regroupe des enregistrements mensuels normalisés (sources étrangères) en lignes annuelles
 * en euros. Un enregistrement dont la devise n'a aucun taux connu est rejeté.
 */
export function toYearly(records, fx) {
  const groups = new Map();
  const rejected = [];
  for (const r of records) {
    const period = `${r.year}-${String(r.month).padStart(2, '0')}`;
    const rate = fx.rate(r.currency, period);
    if (!rate || !(r.month >= 1 && r.month <= 12)) {
      rejected.push({ record: r, reasons: [rate ? 'mois invalide' : `taux de change inconnu (${r.currency} ${period})`] });
      continue;
    }
    const key = `${r.reporter}|${r.partner}|${r.product}|${r.year}|${r.flow}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        reporter: r.reporter, partner: r.partner, product: r.product, year: r.year, flow: r.flow,
        months: Array(12).fill(0), monthsKg: Array(12).fill(0), monthIdx: [], valueOrig: 0,
        currency: r.currency, source: r.source, quality: r.quality,
      };
      groups.set(key, g);
    }
    const i = r.month - 1;
    g.months[i] += (Number(r.valueOrig) || 0) / rate;
    g.monthsKg[i] += Number(r.kg) || 0;
    g.valueOrig += Number(r.valueOrig) || 0;
    if (!g.monthIdx.includes(i)) g.monthIdx.push(i);
  }
  return { docs: [...groups.values()], rejected };
}

/** Contrôle qualité puis écriture fusionnée. */
export async function ingest(Model, docs, { level, source, keys, priority = false }) {
  const { valid, rejected, corrected } = await screen(docs, { source, level });
  // Les champs ajoutés par le contrôle (hs6, chapitre, section) sont conservés ; monthIdx aussi.
  const write = await upsertMonthly(Model, valid, { keys, priority });
  return { received: docs.length, valid: valid.length, rejected: rejected.length, corrected, ...write };
}
