import { Router } from 'express';
import { JobRun, Rejected } from '../models/System.js';
import { NcLink } from '../models/NcLink.js';
import { Product } from '../models/Product.js';
import { TradeFlow } from '../models/TradeFlow.js';
import { WorldFlow } from '../models/WorldFlow.js';
import { BulkFile } from '../models/BulkFile.js';
import { getDataVersion } from '../services/dataVersion.js';
import { runUpdateLocked } from '../services/updateJob.js';
import { config } from '../config.js';

const router = Router();

router.use((req, res, next) => (req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Réservé aux administrateurs' })));

// État de santé des données : fraîcheur, dernières mises à jour, codes NC, quarantaine.
router.get('/status', async (req, res) => {
  const [version, runs, links, statuses, rejected, rejectedReasons, flows, world, suspect, bulkFiles, bulkCounts] = await Promise.all([
    getDataVersion({ maxAgeMs: 0 }),
    JobRun.find().sort({ startedAt: -1 }).limit(10).lean(),
    NcLink.aggregate([{ $group: { _id: { level: '$level', source: '$source' }, n: { $sum: 1 } } }]),
    Product.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    Rejected.countDocuments(),
    Rejected.aggregate([{ $unwind: '$reasons' }, { $group: { _id: '$reasons', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 10 }]),
    TradeFlow.estimatedDocumentCount(),
    WorldFlow.aggregate([{ $group: { _id: '$source', n: { $sum: 1 } } }]),
    TradeFlow.countDocuments({ quality: { $exists: true } }),
    BulkFile.find({}, { name: 1, period: 1, status: 1, processedAt: 1, error: 1, 'stats.kept': 1, 'stats.rejected': 1 }).sort({ period: -1 }).limit(24).lean(),
    BulkFile.aggregate([{ $group: { _id: '$status', n: { $sum: 1 }, last: { $max: '$period' } } }]),
  ]);
  res.json({
    version, autoUpdate: { ...config.autoUpdate, comtradeKey: config.autoUpdate.comtradeKey ? '••••' : '' },
    runs, links, codes: statuses, rejected, rejectedReasons, flows, world, suspectRows: suspect,
    bulk: { files: bulkFiles, counts: bulkCounts, from: config.bulk.from },
  });
});

// Lancement manuel d'une mise à jour (en arrière-plan).
router.post('/update', async (req, res) => {
  const steps = Array.isArray(req.body?.steps) ? req.body.steps.map(String) : undefined;
  runUpdateLocked(steps ? { steps } : undefined).catch((e) => console.error(e));
  res.status(202).json({ started: true });
});

export default router;
