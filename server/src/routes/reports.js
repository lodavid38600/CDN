import { Router } from 'express';
import express from 'express';
import mongoose from 'mongoose';
import { Report } from '../models/Report.js';

const router = Router();
// Les rapports peuvent contenir des images (cartes, captures) : limite plus large.
router.use(express.json({ limit: '8mb' }));

const BLOCK_TYPES = new Set(['heading', 'text', 'kpis', 'chart', 'table', 'image', 'divider']);

function sanitize(body = {}) {
  const out = {};
  if (body.title !== undefined) out.title = String(body.title).slice(0, 200);
  if (body.subtitle !== undefined) out.subtitle = String(body.subtitle).slice(0, 400);
  if (body.blocks !== undefined) {
    if (!Array.isArray(body.blocks) || body.blocks.length > 200) {
      const err = new Error('blocks doit être une liste de 200 blocs au plus');
      err.status = 400;
      throw err;
    }
    out.blocks = body.blocks.map((b) => {
      if (!b || typeof b !== 'object' || !BLOCK_TYPES.has(b.type)) {
        const err = new Error(`Type de bloc invalide : ${b?.type}`);
        err.status = 400;
        throw err;
      }
      return b;
    });
  }
  return out;
}

async function findOwned(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(404).json({ error: 'Rapport introuvable' });
    return null;
  }
  const report = await Report.findOne({ _id: req.params.id, owner: req.user._id });
  if (!report) res.status(404).json({ error: 'Rapport introuvable' });
  return report;
}

router.get('/', async (req, res) => {
  const reports = await Report.find({ owner: req.user._id }, { title: 1, subtitle: 1, updatedAt: 1, createdAt: 1, blocks: { $slice: 0 } })
    .sort({ updatedAt: -1 })
    .lean();
  const counts = await Report.aggregate([
    { $match: { owner: req.user._id } },
    { $project: { n: { $size: '$blocks' } } },
  ]);
  const n = Object.fromEntries(counts.map((c) => [c._id.toString(), c.n]));
  res.json(reports.map(({ blocks, ...r }) => ({ ...r, id: r._id.toString(), blockCount: n[r._id.toString()] || 0 })));
});

router.post('/', async (req, res) => {
  const report = await Report.create({ ...sanitize(req.body), owner: req.user._id });
  res.status(201).json(report.toJSON());
});

router.get('/:id', async (req, res) => {
  const report = await findOwned(req, res);
  if (report) res.json(report.toJSON());
});

router.put('/:id', async (req, res) => {
  const report = await findOwned(req, res);
  if (!report) return;
  Object.assign(report, sanitize(req.body));
  report.markModified('blocks');
  await report.save();
  res.json(report.toJSON());
});

// Ajoute des blocs à la fin d'un rapport existant.
router.post('/:id/blocks', async (req, res) => {
  const report = await findOwned(req, res);
  if (!report) return;
  const { blocks } = sanitize({ blocks: req.body?.blocks || [] });
  report.blocks.push(...blocks);
  report.markModified('blocks');
  await report.save();
  res.json(report.toJSON());
});

router.delete('/:id', async (req, res) => {
  const report = await findOwned(req, res);
  if (!report) return;
  await report.deleteOne();
  res.status(204).end();
});

export default router;
