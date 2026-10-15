import { Router } from 'express';
import mongoose from 'mongoose';
import { Company } from '../../models/Company.js';
import { User } from '../../models/User.js';
import { Invoice } from '../../models/Invoice.js';
import { Ticket } from '../../models/Support.js';
import { FEATURES, PLANS, requirePerm } from '../../services/access.js';
import { audit } from '../../services/audit.js';
import { createCompanyWithOwner, publicCompany, seatsLeft, tempPassword } from '../../services/accounts.js';

// Sociétés clientes, comptes et abonnements (commercial et administrateur).
const router = Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const rx = (s) => new RegExp(String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
const validId = (id) => mongoose.isValidObjectId(id);

// --- Sociétés
router.get('/companies', requirePerm('companies.manage'), async (req, res) => {
  const q = {};
  if (req.query.q) q.$or = [{ name: rx(req.query.q) }, { legalName: rx(req.query.q) }, { siret: rx(req.query.q) }, { billingEmail: rx(req.query.q) }];
  if (PLANS[req.query.plan]) q.plan = req.query.plan;
  if (req.query.status === 'suspended' || req.query.status === 'active') q.status = req.query.status;
  if (req.query.status === 'expiring') q['subscription.end'] = { $gte: new Date(), $lte: new Date(Date.now() + 30 * 86400000) };
  if (req.query.status === 'expired') q['subscription.end'] = { $lt: new Date() };
  const companies = await Company.find(q).sort({ createdAt: -1 }).limit(500).populate('accountManager', 'name email').lean();
  const counts = new Map((await User.aggregate([{ $match: { companyId: { $in: companies.map((c) => c._id) } } }, { $group: { _id: '$companyId', n: { $sum: { $cond: ['$active', 1, 0] } } } }])).map((r) => [String(r._id), r.n]));
  res.json(companies.map((c) => ({ ...publicCompany(c), notes: c.notes, accountManager: c.accountManager, members: counts.get(String(c._id)) || 0 })));
});

router.post('/companies', requirePerm('companies.manage'), async (req, res) => {
  const b = req.body || {};
  const email = String(b.ownerEmail || '').trim().toLowerCase();
  if (!String(b.name || '').trim()) return res.status(400).json({ error: 'Nom de la société obligatoire' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'E-mail du responsable invalide' });
  if (await User.exists({ email })) return res.status(409).json({ error: 'Cet e-mail est déjà utilisé' });
  const plan = PLANS[b.plan] ? b.plan : 'essai';
  const password = tempPassword();
  const { company, user } = await createCompanyWithOwner({ companyName: String(b.name).trim(), email, password, name: String(b.ownerName || ''), plan, trialDays: Number(b.trialDays) || PLANS.essai.days, createdBy: req.user });
  user.mustChangePassword = true;
  await user.save();
  await audit(req, { action: 'societe.creee', category: 'societe', company: company._id, target: company.name, message: `Société ${company.name} créée (offre ${PLANS[plan].label}), responsable ${email}` });
  res.status(201).json({ company: publicCompany(company), owner: user.toPublic(), temporaryPassword: password });
});

router.get('/companies/:id', requirePerm('companies.manage'), async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'Société introuvable' });
  const company = await Company.findById(req.params.id).populate('accountManager', 'name email').lean();
  if (!company) return res.status(404).json({ error: 'Société introuvable' });
  const [members, invoices, tickets] = await Promise.all([
    User.find({ companyId: company._id }).sort({ companyRole: -1, name: 1 }).lean(),
    Invoice.find({ company: company._id }).sort({ issueDate: -1 }).limit(24).lean(),
    Ticket.find({ company: company._id }, { messages: 0 }).sort({ lastActivityAt: -1 }).limit(20).lean(),
  ]);
  res.json({
    company: { ...publicCompany(company), notes: company.notes, accountManager: company.accountManager },
    seatsLeft: await seatsLeft(company),
    members: members.map((u) => ({ ...new User(u).toPublic() })),
    invoices, tickets,
  });
});

const INFO_FIELDS = ['name', 'legalName', 'siret', 'vatNumber', 'billingEmail', 'phone', 'notes'];
router.put('/companies/:id', requirePerm('companies.manage'), async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'Société introuvable' });
  const company = await Company.findById(req.params.id);
  if (!company) return res.status(404).json({ error: 'Société introuvable' });
  const b = req.body || {};
  const before = { plan: company.plan, status: company.status, featuresAdd: [...company.featuresAdd], featuresRemove: [...company.featuresRemove], seats: company.seats, end: company.subscription?.end };
  for (const k of INFO_FIELDS) if (typeof b[k] === 'string') company[k] = b[k].trim();
  if (b.address && typeof b.address === 'object') for (const k of ['line1', 'line2', 'postalCode', 'city', 'country']) if (typeof b.address[k] === 'string') company.address[k] = b.address[k];
  if (b.accountManager !== undefined) {
    company.accountManager = validId(b.accountManager) && (await User.exists({ _id: b.accountManager, staffRole: { $ne: null } })) ? b.accountManager : undefined;
  }
  // Offre, fonctionnalités, places, statut et échéance : droits « abonnements »
  const sub = ['plan', 'featuresAdd', 'featuresRemove', 'seats', 'exportLimit', 'status', 'subscription'].filter((k) => b[k] !== undefined);
  if (sub.length) {
    if (!req.access.perms.has('subscriptions.manage')) return res.status(403).json({ error: 'Modification d\'abonnement non autorisée' });
    if (b.plan !== undefined) { if (!PLANS[b.plan]) return res.status(400).json({ error: 'Offre inconnue' }); company.plan = b.plan; }
    const feats = (v) => (Array.isArray(v) ? [...new Set(v.filter((f) => FEATURES[f]))] : undefined);
    if (b.featuresAdd !== undefined) company.featuresAdd = feats(b.featuresAdd) || [];
    if (b.featuresRemove !== undefined) company.featuresRemove = feats(b.featuresRemove) || [];
    if (b.seats !== undefined) company.seats = b.seats === null || b.seats === '' ? undefined : Math.max(1, Math.min(1000, Number(b.seats) || 1));
    if (b.exportLimit !== undefined) company.exportLimit = b.exportLimit === null || b.exportLimit === '' ? undefined : Math.max(0, Number(b.exportLimit) || 0);
    if (b.status !== undefined) { if (!['active', 'suspended'].includes(b.status)) return res.status(400).json({ error: 'Statut inconnu' }); company.status = b.status; }
    if (b.subscription && typeof b.subscription === 'object') {
      const d = (v) => (v ? new Date(v) : undefined);
      for (const k of ['start', 'end']) if (b.subscription[k] !== undefined) company.subscription[k] = d(b.subscription[k]);
      if (['mensuel', 'annuel'].includes(b.subscription.billing)) company.subscription.billing = b.subscription.billing;
      if (b.subscription.price !== undefined) company.subscription.price = b.subscription.price === '' || b.subscription.price === null ? undefined : Number(b.subscription.price);
    }
  }
  await company.save();
  const after = { plan: company.plan, status: company.status, featuresAdd: company.featuresAdd, featuresRemove: company.featuresRemove, seats: company.seats, end: company.subscription?.end };
  if (sub.length) {
    await audit(req, { action: 'societe.abonnement.modifie', category: 'abonnement', level: 'warning', company: company._id, target: company.name, message: `Abonnement de ${company.name} modifié`, details: { before, after } });
  } else {
    await audit(req, { action: 'societe.infos.modifiees', category: 'societe', company: company._id, target: company.name, message: `Informations de ${company.name} modifiées` });
  }
  res.json({ company: { ...publicCompany(company), notes: company.notes } });
});

// --- Utilisateurs (clients et équipe)
router.get('/users', requirePerm('users.manage'), async (req, res) => {
  const q = {};
  if (req.query.q) q.$or = [{ email: rx(req.query.q) }, { name: rx(req.query.q) }];
  if (req.query.type === 'staff') q.staffRole = { $ne: null };
  if (req.query.type === 'clients') q.staffRole = null;
  if (validId(req.query.company)) q.companyId = req.query.company;
  if (req.query.active === 'false') q.active = false;
  const users = await User.find(q).sort({ createdAt: -1 }).limit(500).populate('companyId', 'name').lean();
  res.json(users.map((u) => ({ ...new User(u).toPublic(), companyName: u.companyId?.name || null })));
});

router.post('/users', requirePerm('users.manage'), async (req, res) => {
  const b = req.body || {};
  const email = String(b.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Adresse e-mail invalide' });
  if (await User.exists({ email })) return res.status(409).json({ error: 'Cet e-mail est déjà utilisé' });
  const user = new User({ email, name: String(b.name || '').slice(0, 100), jobTitle: String(b.jobTitle || '').slice(0, 120), mustChangePassword: true });
  if (b.staffRole) {
    if (!req.access.perms.has('staff.manage')) return res.status(403).json({ error: 'Seul un administrateur peut créer un compte de l\'équipe' });
    if (!['admin', 'commercial'].includes(b.staffRole)) return res.status(400).json({ error: 'Rôle inconnu' });
    user.staffRole = b.staffRole;
  } else {
    if (!validId(b.companyId)) return res.status(400).json({ error: 'Société obligatoire' });
    const company = await Company.findById(b.companyId).lean();
    if (!company) return res.status(404).json({ error: 'Société introuvable' });
    if ((await seatsLeft(company)) <= 0 && !b.overrideSeats) return res.status(409).json({ error: 'Toutes les places de l\'offre sont utilisées' });
    user.companyId = company._id;
    user.companyRole = b.companyRole === 'owner' ? 'owner' : 'member';
  }
  const password = tempPassword();
  await user.setPassword(password);
  await user.save();
  await audit(req, { action: 'utilisateur.cree', category: 'compte', company: user.companyId ?? null, target: email, message: `Compte créé : ${email}${user.staffRole ? ` (équipe, ${user.staffRole})` : ''}` });
  res.status(201).json({ user: user.toPublic(), temporaryPassword: password });
});

async function userFor(req, res) {
  if (!validId(req.params.id)) { res.status(404).json({ error: 'Utilisateur introuvable' }); return null; }
  const u = await User.findById(req.params.id);
  if (!u) { res.status(404).json({ error: 'Utilisateur introuvable' }); return null; }
  // Les comptes de l'équipe ne sont modifiables que par un administrateur
  if (u.staffRole && !req.access.perms.has('staff.manage')) { res.status(403).json({ error: 'Compte de l\'équipe : réservé aux administrateurs' }); return null; }
  return u;
}

router.put('/users/:id', requirePerm('users.manage'), async (req, res) => {
  const u = await userFor(req, res);
  if (!u) return;
  const b = req.body || {};
  const self = String(u._id) === String(req.user._id);
  const changes = {};
  for (const k of ['name', 'jobTitle', 'phone']) if (typeof b[k] === 'string') u[k] = b[k].slice(0, 120);
  if (typeof b.active === 'boolean' && b.active !== u.active) {
    if (self && !b.active) return res.status(400).json({ error: 'Vous ne pouvez pas désactiver votre propre compte' });
    changes.active = u.active = b.active;
  }
  if (['owner', 'member'].includes(b.companyRole) && !u.staffRole && b.companyRole !== u.companyRole) changes.companyRole = u.companyRole = b.companyRole;
  if (b.staffRole !== undefined && u.staffRole && b.staffRole !== u.staffRole) {
    if (!req.access.perms.has('staff.manage') || !['admin', 'commercial'].includes(b.staffRole)) return res.status(403).json({ error: 'Changement de rôle non autorisé' });
    if (self) return res.status(400).json({ error: 'Vous ne pouvez pas changer votre propre rôle' });
    changes.staffRole = u.staffRole = b.staffRole;
  }
  if (b.companyId !== undefined && !u.staffRole && validId(b.companyId) && String(b.companyId) !== String(u.companyId)) {
    if (!(await Company.exists({ _id: b.companyId }))) return res.status(404).json({ error: 'Société introuvable' });
    changes.companyId = u.companyId = b.companyId;
  }
  await u.save();
  await audit(req, { action: 'utilisateur.modifie', category: 'compte', level: Object.keys(changes).length ? 'warning' : 'info', company: u.companyId ?? null, target: u.email, message: `Compte modifié : ${u.email}`, details: changes });
  res.json({ user: u.toPublic() });
});

router.post('/users/:id/reset-password', requirePerm('users.manage'), async (req, res) => {
  const u = await userFor(req, res);
  if (!u) return;
  const password = tempPassword();
  await u.setPassword(password);
  u.mustChangePassword = true;
  await u.save();
  await audit(req, { action: 'utilisateur.mot-de-passe', category: 'compte', level: 'security', company: u.companyId ?? null, target: u.email, message: `Mot de passe réinitialisé pour ${u.email}` });
  res.json({ temporaryPassword: password });
});

export default router;
