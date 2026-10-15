import { Router } from 'express';
import { Meta, JobRun } from '../models/System.js';
import { BulkFile } from '../models/BulkFile.js';
import { NcLink } from '../models/NcLink.js';
import { Product } from '../models/Product.js';
import { WorldFlow } from '../models/WorldFlow.js';
import { TradeFlow } from '../models/TradeFlow.js';
import { News, Coverage } from '../models/Content.js';
import { EU_CODES, countryLabel } from '../data/countries.js';
import { getDataRange } from '../services/dataRange.js';
import { formatPeriod } from '../services/filters.js';

// Page d'accueil : l'état de l'outil, sans noyer le visiteur sous les chiffres.
const router = Router();
const SOURCE_NAME = { eurostat: 'Eurostat', 'us-census': 'US Census Bureau', 'uk-hmrc': 'HMRC (Royaume-Uni)', ssb: 'Statistics Norway', comtrade: 'Nations unies (Comtrade)' };
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const monthLabel = (p) => { const [y, m] = p.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };

let coverageCache = { at: 0, data: null };

router.get('/', async (req, res) => {
  const [data, site, range, news, files, runs] = await Promise.all([
    Meta.findOne({ key: 'data' }).lean(),
    Meta.findOne({ key: 'site' }).lean(),
    getDataRange(TradeFlow),
    News.find({ published: true, publishedAt: { $lte: new Date() } }).sort({ publishedAt: -1 }).limit(8).lean(),
    BulkFile.find({ status: 'processed' }, { period: 1, processedAt: 1 }).sort({ processedAt: -1 }).limit(6).lean(),
    JobRun.find({ status: { $in: ['success', 'partial'] } }, { endedAt: 1, status: 1 }).sort({ startedAt: -1 }).limit(3).lean(),
  ]);

  // Journal des mises à jour (données ajoutées ou révisées), le plus récent d'abord
  const updates = [
    ...files.map((f) => ({ at: f.processedAt, kind: 'donnees', text: `Données de ${monthLabel(f.period)} intégrées (Eurostat)` })),
    ...runs.map((r) => ({ at: r.endedAt, kind: 'maj', text: r.status === 'success' ? 'Mise à jour automatique des données terminée' : 'Mise à jour automatique partielle (certaines sources indisponibles)' })),
  ].filter((u) => u.at).sort((a, b) => b.at - a.at).slice(0, 6);

  // Changements de codes NC récents (officiels), avec libellés
  const lastYear = range.last?.y || new Date().getFullYear();
  const links = await NcLink.find({ level: 8, source: { $in: ['official', 'manual'] }, year: { $gte: lastYear - 2 }, $expr: { $ne: ['$from', '$to'] } }).sort({ year: -1 }).limit(60).lean();
  const labels = new Map((await Product.find({ code: { $in: [...new Set(links.flatMap((l) => [l.from, l.to]))] } }, { code: 1, description: 1 }).lean()).map((p) => [p.code, p.description]));
  const byFrom = new Map();
  for (const l of links) {
    const k = `${l.year}|${l.from}`;
    if (!byFrom.has(k)) byFrom.set(k, { year: l.year, from: { code: l.from, label: labels.get(l.from) || '' }, to: [] });
    byFrom.get(k).to.push({ code: l.to, label: labels.get(l.to) || '' });
  }
  const ncChanges = [...byFrom.values()].slice(0, 12);

  res.json({
    banner: site?.info?.banner || null,
    lastUpdate: data?.updatedAt || null,
    period: range.first ? { from: formatPeriod(range.first), to: formatPeriod(range.last) } : null,
    news,
    updates,
    ncChanges,
    coverage: await coverage(),
  });
});

/** Pays couverts (déduits des données), en cours d'intégration et prévus (annoncés par l'équipe). */
async function coverage() {
  if (coverageCache.data && Date.now() - coverageCache.at < 10 * 60 * 1000) return coverageCache.data;
  const [reporters, world, announced] = await Promise.all([
    TradeFlow.distinct('reporter'),
    WorldFlow.aggregate([{ $group: { _id: '$reporter', sources: { $addToSet: '$source' }, mirror: { $min: { $cond: ['$mirror', 1, 0] } } } }]),
    Coverage.find().lean(),
  ]);
  const map = new Map();
  for (const c of reporters) if (EU_CODES.has(c)) map.set(c, { code: c, status: 'disponible', source: 'Eurostat' });
  for (const w of world) {
    if (map.has(w._id) || w._id === 'EU') continue;
    const direct = w.sources.filter((s) => s !== 'mirror' && s !== 'demo' && s !== 'eurostat');
    if (direct.length) map.set(w._id, { code: w._id, status: 'disponible', source: direct.map((s) => SOURCE_NAME[s] || s).join(', ') });
    else if (w.mirror === 1) map.set(w._id, { code: w._id, status: 'reconstitue', source: 'Déclarations de ses partenaires' });
  }
  for (const a of announced) if (!map.has(a.country) || map.get(a.country).status === 'reconstitue') map.set(a.country, { code: a.country, status: a.status, source: a.source, eta: a.eta, note: a.note });
  const list = [...map.values()].map((c) => ({ ...c, name: countryLabel(c.code) })).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  coverageCache = { at: Date.now(), data: list };
  return list;
}
export const clearCoverageCache = () => { coverageCache = { at: 0, data: null }; };

export default router;
