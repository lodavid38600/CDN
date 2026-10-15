import { Router } from 'express';
import mongoose from 'mongoose';
import { Invoice } from '../models/Invoice.js';
import { requirePerm } from '../services/access.js';
import { markOverdue } from '../services/billing.js';

// Factures de sa société (responsables uniquement).
const router = Router();
router.use(requirePerm('invoices.read'));

router.get('/', async (req, res) => {
  await markOverdue();
  res.json(await Invoice.find({ company: req.company._id }).sort({ issueDate: -1 }).lean());
});

router.get('/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Facture introuvable' });
  const inv = await Invoice.findOne({ _id: req.params.id, company: req.company._id }).lean();
  if (!inv) return res.status(404).json({ error: 'Facture introuvable' });
  res.json(inv);
});

export default router;
