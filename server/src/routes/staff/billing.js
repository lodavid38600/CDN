import { Router } from 'express';
import mongoose from 'mongoose';
import { Invoice } from '../../models/Invoice.js';
import { Company } from '../../models/Company.js';
import { nextSeq } from '../../models/System.js';
import { PLANS, requirePerm } from '../../services/access.js';
import { audit } from '../../services/audit.js';
import { markOverdue } from '../../services/billing.js';

// Factures (commercial et administrateur).
const router = Router();
router.use(requirePerm('invoices.manage'));
const validId = (id) => mongoose.isValidObjectId(id);

router.get('/invoices', async (req, res) => {
  await markOverdue();
  const q = {};
  if (['emise', 'payee', 'en_retard', 'annulee'].includes(req.query.status)) q.status = req.query.status;
  if (validId(req.query.company)) q.company = req.query.company;
  if (req.query.from || req.query.to) {
    q.issueDate = {};
    if (req.query.from) q.issueDate.$gte = new Date(req.query.from);
    if (req.query.to) q.issueDate.$lte = new Date(`${req.query.to}T23:59:59`);
  }
  const invoices = await Invoice.find(q).sort({ issueDate: -1 }).limit(500).populate('company', 'name').lean();
  const sum = (s) => invoices.filter((i) => i.status === s).reduce((t, i) => t + i.totalTTC, 0);
  res.json({ invoices, totals: { emise: sum('emise'), en_retard: sum('en_retard'), payee: sum('payee') } });
});

router.get('/invoices/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'Facture introuvable' });
  const inv = await Invoice.findById(req.params.id).populate('company', 'name').lean();
  if (!inv) return res.status(404).json({ error: 'Facture introuvable' });
  res.json(inv);
});

// Émission : lignes libres, ou abonnement de la société sur N mois
router.post('/invoices', async (req, res) => {
  const b = req.body || {};
  if (!validId(b.company)) return res.status(400).json({ error: 'Société obligatoire' });
  const company = await Company.findById(b.company).lean();
  if (!company) return res.status(404).json({ error: 'Société introuvable' });
  let lines = Array.isArray(b.lines) ? b.lines.filter((l) => l && String(l.label || '').trim()).map((l) => ({ label: String(l.label).slice(0, 300), quantity: Math.max(0, Number(l.quantity) || 0), unitPrice: Number(l.unitPrice) || 0 })) : [];
  const issueDate = b.issueDate ? new Date(b.issueDate) : new Date();
  let periodFrom = b.periodFrom ? new Date(b.periodFrom) : undefined;
  let periodTo = b.periodTo ? new Date(b.periodTo) : undefined;
  if (!lines.length && b.months) {
    const months = Math.max(1, Math.min(36, Number(b.months)));
    const plan = PLANS[company.plan];
    const price = company.subscription?.price ?? plan.monthly;
    periodFrom ??= issueDate;
    periodTo ??= new Date(periodFrom.getFullYear(), periodFrom.getMonth() + months, periodFrom.getDate() - 1);
    lines = [{ label: `Abonnement ${plan.label} — ${months} mois`, quantity: months, unitPrice: price }];
  }
  if (!lines.length) return res.status(400).json({ error: 'Ajoutez au moins une ligne' });
  const year = issueDate.getFullYear();
  const inv = await Invoice.create({
    number: `F-${year}-${String(await nextSeq(`facture-${year}`)).padStart(4, '0')}`,
    company: company._id, issueDate, dueDate: new Date(issueDate.getTime() + (Number(b.dueDays) || 30) * 86400000),
    periodFrom, periodTo, lines, vatRate: b.vatRate === undefined ? 20 : Number(b.vatRate),
    billedTo: { name: company.name, legalName: company.legalName, address: company.address, vatNumber: company.vatNumber, siret: company.siret, billingEmail: company.billingEmail },
    createdBy: req.user._id,
  });
  await audit(req, { action: 'facture.emise', category: 'facture', company: company._id, target: inv.number, message: `Facture ${inv.number} émise pour ${company.name} (${inv.totalTTC.toFixed(2)} € TTC)` });
  res.status(201).json(inv);
});

router.put('/invoices/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'Facture introuvable' });
  const inv = await Invoice.findById(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Facture introuvable' });
  const status = req.body?.status;
  // Une facture émise ne se modifie pas : on l'encaisse ou on l'annule
  if (!['payee', 'annulee', 'emise'].includes(status)) return res.status(400).json({ error: 'Statut possible : payée, annulée ou émise' });
  if (inv.status === 'annulee') return res.status(409).json({ error: 'Facture annulée : émettez-en une nouvelle' });
  inv.status = status;
  inv.paidAt = status === 'payee' ? new Date(req.body?.paidAt || Date.now()) : undefined;
  await inv.save();
  await audit(req, { action: `facture.${status}`, category: 'facture', level: status === 'annulee' ? 'warning' : 'info', company: inv.company, target: inv.number, message: `Facture ${inv.number} : ${status === 'payee' ? 'payée' : status === 'annulee' ? 'annulée' : 'remise en attente de paiement'}` });
  res.json(inv);
});

export default router;
