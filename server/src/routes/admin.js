import { Router } from 'express';
import mongoose from 'mongoose';
import { JobRun, Rejected, Meta } from '../models/System.js';
import { NcLink } from '../models/NcLink.js';
import { Product } from '../models/Product.js';
import { TradeFlow } from '../models/TradeFlow.js';
import { WorldFlow } from '../models/WorldFlow.js';
import { BulkFile } from '../models/BulkFile.js';
import { Company } from '../models/Company.js';
import { User } from '../models/User.js';
import { Ticket, ChatThread } from '../models/Support.js';
import { Invoice } from '../models/Invoice.js';
import { AuditLog } from '../models/AuditLog.js';
import { News, Coverage } from '../models/Content.js';
import { getDataVersion } from '../services/dataVersion.js';
import { runUpdateLocked } from '../services/updateJob.js';
import { rebuildCubes } from '../services/cubes.js';
import { FEATURES, PERMISSIONS, PLANS, STAFF_ROLES, COMPANY_ROLES, requirePerm } from '../services/access.js';
import { audit } from '../services/audit.js';
import { markOverdue } from '../services/billing.js';
import { clearCoverageCache } from './home.js';
import { config } from '../config.js';
import accounts from './staff/accounts.js';
import support from './staff/support.js';
import billing from './staff/billing.js';

// Espace de l'équipe du SaaS. Chaque route exige une permission précise : un commercial ne voit
// que ce qui le concerne, un administrateur voit tout.
const router = Router();
router.use((req, res, next) => {
  if (req.access?.staffRole) return next();
  audit(req, { action: 'acces.refuse', category: 'securite', level: 'security', message: 'Tentative d\'accès à l\'espace d\'administration', details: { path: req.originalUrl } });
  return res.status(403).json({ error: 'Réservé à l\'équipe' });
});

// Référentiels (offres, fonctionnalités, rôles, équipe pour les assignations)
router.get('/meta', async (req, res) => {
  const staff = await User.find({ staffRole: { $ne: null }, active: true }, { name: 1, email: 1, staffRole: 1 }).lean();
  res.json({ plans: PLANS, features: FEATURES, permissions: PERMISSIONS, staffRoles: STAFF_ROLES, companyRoles: COMPANY_ROLES, staff });
});

// Tableau de bord de l'équipe
router.get('/overview', async (req, res) => {
  await markOverdue();
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 86400000);
  const [companies, byPlan, expiring, tickets, urgent, chat, overdue, due, signups, security] = await Promise.all([
    Company.countDocuments({ status: 'active' }),
    Company.aggregate([{ $group: { _id: '$plan', n: { $sum: 1 } } }]),
    Company.find({ 'subscription.end': { $gte: now, $lte: in30 } }, { name: 1, plan: 1, 'subscription.end': 1 }).sort({ 'subscription.end': 1 }).limit(10).lean(),
    Ticket.countDocuments({ status: { $in: ['ouvert', 'en_cours', 'attente_client'] } }),
    Ticket.countDocuments({ status: { $in: ['ouvert', 'en_cours'] }, priority: { $in: ['haute', 'urgente'] } }),
    ChatThread.aggregate([{ $group: { _id: null, n: { $sum: '$unreadStaff' } } }]),
    Invoice.aggregate([{ $match: { status: 'en_retard' } }, { $group: { _id: null, n: { $sum: 1 }, total: { $sum: '$totalTTC' } } }]),
    Invoice.aggregate([{ $match: { status: 'emise' } }, { $group: { _id: null, n: { $sum: 1 }, total: { $sum: '$totalTTC' } } }]),
    Company.find({ createdAt: { $gte: new Date(now.getTime() - 30 * 86400000) } }, { name: 1, plan: 1, createdAt: 1 }).sort({ createdAt: -1 }).limit(10).lean(),
    req.access.perms.has('logs.read') ? AuditLog.countDocuments({ level: 'security', at: { $gte: new Date(now.getTime() - 86400000) } }) : null,
  ]);
  const mrr = (await Company.find({ status: 'active' }, { plan: 1, 'subscription.price': 1, 'subscription.end': 1 }).lean())
    .filter((c) => !c.subscription?.end || c.subscription.end > now)
    .reduce((s, c) => s + (c.subscription?.price ?? PLANS[c.plan]?.monthly ?? 0), 0);
  res.json({
    companies, byPlan: Object.fromEntries(byPlan.map((p) => [p._id, p.n])), expiring, signups, mrr,
    tickets, urgentTickets: urgent, unreadChat: chat[0]?.n || 0,
    overdue: overdue[0] || { n: 0, total: 0 }, due: due[0] || { n: 0, total: 0 },
    securityEvents24h: security,
  });
});

router.use(accounts);
router.use(support);
router.use(billing);

// --- Journal d'activité
const rx = (s) => new RegExp(String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
function logQuery(qs) {
  const q = {};
  if (qs.category) q.category = { $in: String(qs.category).split(',') };
  if (qs.level) q.level = { $in: String(qs.level).split(',') };
  if (mongoose.isValidObjectId(qs.company)) q.company = qs.company;
  if (qs.actor) q.actorEmail = rx(qs.actor);
  if (qs.q) q.$or = [{ message: rx(qs.q) }, { action: rx(qs.q) }, { target: rx(qs.q) }];
  if (qs.from || qs.to) {
    q.at = {};
    if (qs.from) q.at.$gte = new Date(qs.from);
    if (qs.to) q.at.$lte = new Date(`${qs.to}T23:59:59.999`);
  }
  return q;
}
router.get('/logs', requirePerm('logs.read'), async (req, res) => {
  const q = logQuery(req.query);
  const limit = Math.min(200, Math.max(10, Number(req.query.limit) || 50));
  const page = Math.max(1, Number(req.query.page) || 1);
  const [total, rows, categories] = await Promise.all([
    AuditLog.countDocuments(q),
    AuditLog.find(q).sort({ at: -1 }).skip((page - 1) * limit).limit(limit).populate('company', 'name').lean(),
    AuditLog.distinct('category'),
  ]);
  res.json({ total, page, pages: Math.ceil(total / limit), rows, categories });
});
router.get('/logs/export.csv', requirePerm('logs.read'), async (req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="journal.csv"');
  const cell = (v) => { const s = String(v ?? '').replace(/^([=+\-@])/, "'$1"); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  res.write('﻿date;niveau;categorie;action;utilisateur;societe;objet;message;ip\n');
  for await (const r of AuditLog.find(logQuery(req.query)).sort({ at: -1 }).limit(50000).populate('company', 'name').lean().cursor()) {
    res.write(`${[r.at.toISOString(), r.level, r.category, r.action, r.actorEmail, r.company?.name, r.target, r.message, r.ip].map(cell).join(';')}\n`);
  }
  res.end();
  audit(req, { action: 'journal.exporte', category: 'securite', message: 'Export du journal d\'activité', details: req.query });
});

// --- Administration du site : données
router.get('/status', requirePerm('site.manage'), async (req, res) => {
  const [version, runs, links, statuses, rejected, rejectedReasons, flows, world, suspect, bulkFiles, bulkCounts, cubes] = await Promise.all([
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
    Meta.findOne({ key: 'cubes' }).lean(),
  ]);
  res.json({
    version, autoUpdate: { ...config.autoUpdate, comtradeKey: config.autoUpdate.comtradeKey ? '••••' : '' },
    runs, links, codes: statuses, rejected, rejectedReasons, flows, world, suspectRows: suspect,
    bulk: { files: bulkFiles, counts: bulkCounts, from: config.bulk.from },
    cubes: cubes ? { version: cubes.version, ...cubes.info } : null,
  });
});

router.post('/update', requirePerm('site.manage'), async (req, res) => {
  const steps = Array.isArray(req.body?.steps) ? req.body.steps.map(String) : undefined;
  runUpdateLocked(steps ? { steps } : undefined).catch((e) => console.error(e));
  await audit(req, { action: 'donnees.mise-a-jour.lancee', category: 'donnees', message: `Mise à jour des données lancée${steps ? ` (${steps.join(', ')})` : ''}` });
  res.status(202).json({ started: true });
});

router.post('/cubes', requirePerm('site.manage'), async (req, res) => {
  rebuildCubes().catch((e) => console.error(e));
  await audit(req, { action: 'donnees.syntheses.reconstruites', category: 'donnees', message: 'Reconstruction des tables de synthèse lancée' });
  res.status(202).json({ started: true });
});

// --- Actualités (page d'accueil)
router.get('/news', requirePerm('site.manage'), async (req, res) => res.json(await News.find().sort({ publishedAt: -1 }).limit(200).lean()));
const newsBody = (b) => ({
  title: String(b.title || '').slice(0, 200), body: String(b.body || '').slice(0, 5000),
  kind: ['nouveaute', 'donnees', 'nomenclature', 'maintenance'].includes(b.kind) ? b.kind : 'nouveaute',
  published: b.published !== false, publishedAt: b.publishedAt ? new Date(b.publishedAt) : new Date(),
});
router.post('/news', requirePerm('site.manage'), async (req, res) => {
  const n = newsBody(req.body || {});
  if (!n.title) return res.status(400).json({ error: 'Titre obligatoire' });
  const doc = await News.create({ ...n, author: req.user._id });
  await audit(req, { action: 'site.actualite.creee', category: 'site', target: n.title, message: `Actualité publiée : ${n.title}` });
  res.status(201).json(doc);
});
router.put('/news/:id', requirePerm('site.manage'), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Actualité introuvable' });
  const doc = await News.findByIdAndUpdate(req.params.id, { $set: newsBody(req.body || {}) }, { returnDocument: 'after', runValidators: true });
  if (!doc) return res.status(404).json({ error: 'Actualité introuvable' });
  await audit(req, { action: 'site.actualite.modifiee', category: 'site', target: doc.title, message: `Actualité modifiée : ${doc.title}` });
  res.json(doc);
});
router.delete('/news/:id', requirePerm('site.manage'), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Actualité introuvable' });
  const doc = await News.findByIdAndDelete(req.params.id);
  if (doc) await audit(req, { action: 'site.actualite.supprimee', category: 'site', level: 'warning', target: doc.title, message: `Actualité supprimée : ${doc.title}` });
  res.json({ ok: true });
});

// --- Couverture annoncée (pays en cours / prévus)
router.get('/coverage', requirePerm('site.manage'), async (req, res) => res.json(await Coverage.find().sort({ status: 1, country: 1 }).lean()));
router.put('/coverage/:country', requirePerm('site.manage'), async (req, res) => {
  const country = String(req.params.country).toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return res.status(400).json({ error: 'Code pays à 2 lettres' });
  const b = req.body || {};
  const doc = await Coverage.findOneAndUpdate({ country }, { $set: {
    status: b.status === 'en_cours' ? 'en_cours' : 'prevu', source: String(b.source || '').slice(0, 120), eta: String(b.eta || '').slice(0, 40), note: String(b.note || '').slice(0, 300),
  } }, { upsert: true, returnDocument: 'after', runValidators: true });
  clearCoverageCache();
  await audit(req, { action: 'site.couverture.modifiee', category: 'site', target: country, message: `Couverture annoncée : ${country} (${doc.status})` });
  res.json(doc);
});
router.delete('/coverage/:country', requirePerm('site.manage'), async (req, res) => {
  await Coverage.deleteOne({ country: String(req.params.country).toUpperCase() });
  clearCoverageCache();
  await audit(req, { action: 'site.couverture.retiree', category: 'site', target: req.params.country, message: `Pays retiré de la couverture annoncée : ${req.params.country}` });
  res.json({ ok: true });
});

// --- Bandeau d'information (maintenance…)
router.put('/settings', requirePerm('site.manage'), async (req, res) => {
  const banner = String(req.body?.banner || '').trim().slice(0, 300) || null;
  await Meta.updateOne({ key: 'site' }, { $set: { 'info.banner': banner } }, { upsert: true });
  await audit(req, { action: 'site.bandeau', category: 'site', message: banner ? `Bandeau publié : ${banner}` : 'Bandeau retiré' });
  res.json({ banner });
});

export default router;
