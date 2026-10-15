import { Router } from 'express';
import express from 'express';
import { Dashboard } from '../models/Dashboard.js';

// Tableau de bord personnel (un par utilisateur).
const router = Router();
// Les graphiques figés embarquent leurs chiffres : limite plus large que le reste de l'API.
router.use(express.json({ limit: '2mb' }));

const MAX_WIDGETS = 40;
const MAX_SNAPSHOT = 300 * 1024;
const TYPES = new Set(['trend', 'rank', 'kpi']);
const DIMENSIONS = new Set(['partner', 'reporter', 'product', 'chapter']);
const MEASURES = new Set(['value', 'quantity', 'price']);
const GRANULARITIES = new Set(['month', 'quarter', 'year']);
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const COUNTRY = /^[A-Z0-9]{2}$/;

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const str = (v, max) => String(v ?? '').slice(0, max);
const countries = (v) => (Array.isArray(v) ? v : []).map(String).filter((c) => COUNTRY.test(c)).slice(0, 30);

/** Graphique validé : seuls les champs connus sont gardés. */
export function sanitizeWidget(w) {
  if (!w || typeof w !== 'object') throw bad('Graphique invalide');
  if (!TYPES.has(w.type)) throw bad(`Type de graphique invalide : ${w.type}`);
  const p = w.params || {};
  const product = str(p.product, 8);
  if (product && !/^\d{2,8}$/.test(product)) throw bad('Code produit invalide');
  const out = {
    id: str(w.id, 24) || Math.random().toString(36).slice(2, 10),
    type: w.type,
    title: str(w.title, 160) || 'Graphique',
    size: w.size === 'full' ? 'full' : 'half',
    params: {
      product,
      reporters: countries(p.reporters),
      partners: countries(p.partners),
      flow: ['import', 'export'].includes(p.flow) ? p.flow : '',
      measure: MEASURES.has(p.measure) ? p.measure : 'value',
      granularity: GRANULARITIES.has(p.granularity) ? p.granularity : 'month',
      dimension: DIMENSIONS.has(p.dimension) ? p.dimension : 'partner',
      limit: Math.min(25, Math.max(3, Number.parseInt(p.limit, 10) || 10)),
    },
    mode: w.mode === 'fixed' ? 'fixed' : 'live',
    createdAt: w.createdAt && !Number.isNaN(Date.parse(w.createdAt)) ? new Date(w.createdAt) : new Date(),
  };
  if (out.mode === 'live') {
    // Période glissante : les N derniers mois disponibles (0 = tout l'historique)
    out.months = [0, 3, 6, 12, 24, 36, 60].includes(Number(w.months)) ? Number(w.months) : 12;
  } else {
    if (!PERIOD.test(w.from || '') || !PERIOD.test(w.to || '') || w.from > w.to) throw bad('Période figée invalide (AAAA-MM)');
    out.from = w.from;
    out.to = w.to;
    if (w.snapshot !== undefined) {
      const json = JSON.stringify(w.snapshot);
      if (json.length > MAX_SNAPSHOT) throw bad('Graphique figé trop volumineux');
      out.snapshot = JSON.parse(json);
      out.frozenAt = w.frozenAt && !Number.isNaN(Date.parse(w.frozenAt)) ? new Date(w.frozenAt) : new Date();
    }
  }
  return out;
}

async function load(owner) {
  return (await Dashboard.findOne({ owner }).lean()) || { widgets: [] };
}

router.get('/', async (req, res) => {
  res.json({ widgets: (await load(req.user._id)).widgets });
});

// Remplace la liste (ordre, tailles, titres, suppressions)
router.put('/', async (req, res) => {
  const list = req.body?.widgets;
  if (!Array.isArray(list) || list.length > MAX_WIDGETS) throw bad(`widgets doit être une liste de ${MAX_WIDGETS} graphiques au plus`);
  const widgets = list.map(sanitizeWidget);
  const ids = new Set(widgets.map((w) => w.id));
  if (ids.size !== widgets.length) throw bad('Identifiants de graphiques en double');
  await Dashboard.updateOne({ owner: req.user._id }, { $set: { widgets } }, { upsert: true });
  res.json({ widgets });
});

// Ajoute un graphique à la fin
router.post('/widgets', async (req, res) => {
  const widget = sanitizeWidget(req.body);
  const { widgets } = await load(req.user._id);
  if (widgets.length >= MAX_WIDGETS) throw bad(`${MAX_WIDGETS} graphiques au plus par tableau de bord`);
  if (widgets.some((w) => w.id === widget.id)) widget.id = Math.random().toString(36).slice(2, 10);
  await Dashboard.updateOne({ owner: req.user._id }, { $push: { widgets: widget } }, { upsert: true });
  res.status(201).json(widget);
});

router.delete('/widgets/:id', async (req, res) => {
  await Dashboard.updateOne({ owner: req.user._id }, { $pull: { widgets: { id: req.params.id } } });
  res.status(204).end();
});

export default router;
