import { Router } from 'express';
import mongoose from 'mongoose';
import { Company } from '../models/Company.js';
import { User } from '../models/User.js';
import { requirePerm } from '../services/access.js';
import { audit } from '../services/audit.js';
import { publicCompany, seatsLeft, tempPassword } from '../services/accounts.js';

// Espace « Ma société » : les responsables (owner) gèrent les informations et les membres.
const router = Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.use((req, res, next) => (req.company ? next() : res.status(404).json({ error: 'Aucune société rattachée à ce compte' })));

router.get('/', async (req, res) => {
  res.json({ company: publicCompany(req.company), seatsLeft: await seatsLeft(req.company) });
});

const EDITABLE = ['name', 'legalName', 'siret', 'vatNumber', 'billingEmail', 'phone'];
router.put('/', requirePerm('company.manage'), async (req, res) => {
  const set = {};
  for (const k of EDITABLE) if (typeof req.body?.[k] === 'string') set[k] = req.body[k].trim().slice(0, 200);
  if (req.body?.address && typeof req.body.address === 'object') {
    for (const k of ['line1', 'line2', 'postalCode', 'city', 'country']) if (typeof req.body.address[k] === 'string') set[`address.${k}`] = req.body.address[k].slice(0, 200);
  }
  if (set.name === '') return res.status(400).json({ error: 'Le nom de la société est obligatoire' });
  const company = await Company.findByIdAndUpdate(req.company._id, { $set: set }, { returnDocument: 'after', runValidators: true }).lean();
  await audit(req, { action: 'societe.infos.modifiees', category: 'societe', target: company.name, message: 'Informations de la société mises à jour', details: { fields: Object.keys(set) } });
  res.json({ company: publicCompany(company) });
});

// --- Membres
const memberView = (u) => ({ id: String(u._id), email: u.email, name: u.name, jobTitle: u.jobTitle, companyRole: u.companyRole, active: u.active, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt });

router.get('/members', async (req, res) => {
  const members = await User.find({ companyId: req.company._id }).sort({ companyRole: -1, name: 1 }).lean();
  // Un membre voit qui fait partie de sa société ; seuls les responsables voient le détail
  const full = req.access.perms.has('company.manage');
  res.json(members.map((u) => (full ? memberView(u) : { id: String(u._id), name: u.name || u.email, companyRole: u.companyRole })));
});

router.post('/members', requirePerm('company.manage'), async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Adresse e-mail invalide' });
  if (await User.exists({ email })) return res.status(409).json({ error: 'Cet e-mail est déjà utilisé' });
  if ((await seatsLeft(req.company)) <= 0) return res.status(409).json({ error: 'Toutes les places de votre offre sont utilisées : contactez votre commercial pour en ajouter.' });
  const password = tempPassword();
  const user = new User({
    email, name: String(req.body?.name || '').slice(0, 100), jobTitle: String(req.body?.jobTitle || '').slice(0, 120),
    companyId: req.company._id, companyRole: req.body?.companyRole === 'owner' ? 'owner' : 'member', mustChangePassword: true,
  });
  await user.setPassword(password);
  await user.save();
  await audit(req, { action: 'societe.membre.ajoute', category: 'societe', target: email, message: `Membre ajouté : ${email} (${user.companyRole === 'owner' ? 'responsable' : 'membre'})` });
  res.status(201).json({ member: memberView(user), temporaryPassword: password });
});

async function memberOf(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) { res.status(404).json({ error: 'Membre introuvable' }); return null; }
  const u = await User.findOne({ _id: req.params.id, companyId: req.company._id });
  if (!u) res.status(404).json({ error: 'Membre introuvable' });
  return u;
}

router.put('/members/:id', requirePerm('company.manage'), async (req, res) => {
  const u = await memberOf(req, res);
  if (!u) return;
  const self = String(u._id) === String(req.user._id);
  const changes = {};
  if (['owner', 'member'].includes(req.body?.companyRole) && req.body.companyRole !== u.companyRole) changes.companyRole = req.body.companyRole;
  if (typeof req.body?.active === 'boolean' && req.body.active !== u.active) changes.active = req.body.active;
  if (self && (changes.companyRole === 'member' || changes.active === false)) return res.status(400).json({ error: 'Vous ne pouvez pas retirer vos propres droits : demandez à un autre responsable.' });
  if (changes.active === true && (await seatsLeft(req.company)) <= 0) return res.status(409).json({ error: 'Aucune place disponible dans votre offre.' });
  if ((changes.companyRole === 'member' || changes.active === false) && u.companyRole === 'owner') {
    const owners = await User.countDocuments({ companyId: req.company._id, companyRole: 'owner', active: true });
    if (owners <= 1) return res.status(400).json({ error: 'La société doit garder au moins un responsable actif.' });
  }
  Object.assign(u, changes);
  for (const k of ['name', 'jobTitle']) if (typeof req.body?.[k] === 'string') u[k] = req.body[k].slice(0, 120);
  await u.save();
  await audit(req, { action: 'societe.membre.modifie', category: 'societe', target: u.email, message: `Membre modifié : ${u.email}`, details: changes });
  res.json({ member: memberView(u) });
});

router.post('/members/:id/reset-password', requirePerm('company.manage'), async (req, res) => {
  const u = await memberOf(req, res);
  if (!u) return;
  const password = tempPassword();
  await u.setPassword(password);
  u.mustChangePassword = true;
  await u.save();
  await audit(req, { action: 'societe.membre.mot-de-passe', category: 'societe', level: 'security', target: u.email, message: `Mot de passe réinitialisé pour ${u.email}` });
  res.json({ temporaryPassword: password });
});

export default router;
