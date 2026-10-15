import { Router } from 'express';
import { User } from '../models/User.js';
import { requireAuth, signToken } from '../middleware/auth.js';
import { createCompanyWithOwner, publicCompany } from '../services/accounts.js';
import { publicAccess } from '../services/access.js';
import { audit } from '../services/audit.js';
import { config } from '../config.js';

const router = Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Inscription en libre-service : crée la société (offre d'essai) et son responsable.
router.post('/register', async (req, res) => {
  if (!config.signupEnabled) return res.status(403).json({ error: 'Les inscriptions se font auprès de notre équipe commerciale.' });
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const name = String(req.body?.name || '').slice(0, 100);
  const companyName = String(req.body?.company || '').trim().slice(0, 160);
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Adresse e-mail invalide' });
  if (password.length < 8) return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères' });
  if (await User.exists({ email })) return res.status(409).json({ error: 'Cet e-mail est déjà utilisé' });
  const { user, company } = await createCompanyWithOwner({ companyName, email, password, name });
  await audit(null, { action: 'compte.inscription', category: 'auth', actor: user, company: company._id, message: `Inscription de ${email} (société ${company.name}, essai)` });
  res.status(201).json({ token: signToken(user), user: user.toPublic() });
});

router.post('/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const user = await User.findOne({ email });
  if (!user || !(await user.checkPassword(password))) {
    await audit(req, { action: 'connexion.echec', category: 'auth', level: 'security', company: user?.companyId ?? null, message: `Échec de connexion pour ${email || '(vide)'}`, details: { email } });
    return res.status(401).json({ error: 'Identifiants incorrects' });
  }
  if (!user.active) {
    await audit(req, { action: 'connexion.compte-desactive', category: 'auth', level: 'security', actor: user, message: `Tentative de connexion d'un compte désactivé (${email})` });
    return res.status(403).json({ error: 'Ce compte est désactivé. Contactez le responsable de votre société.' });
  }
  user.lastLoginAt = new Date();
  await user.save();
  await audit(req, { action: 'connexion.reussie', category: 'auth', actor: user, message: `Connexion de ${email}` });
  res.json({ token: signToken(user), user: user.toPublic() });
});

// Profil, société et droits effectifs (l'interface affiche ou masque pages et boutons en conséquence ;
// le serveur vérifie de son côté chaque requête).
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user.toPublic(), company: publicCompany(req.company), access: publicAccess(req.access) });
});

router.put('/me', requireAuth, async (req, res) => {
  for (const k of ['name', 'jobTitle', 'phone']) if (typeof req.body?.[k] === 'string') req.user[k] = req.body[k].slice(0, 120);
  await req.user.save();
  await audit(req, { action: 'profil.modifie', category: 'compte', message: 'Profil mis à jour' });
  res.json({ user: req.user.toPublic() });
});

router.put('/me/password', requireAuth, async (req, res) => {
  const { current = '', next = '' } = req.body || {};
  if (!(await req.user.checkPassword(String(current)))) return res.status(400).json({ error: 'Mot de passe actuel incorrect' });
  if (String(next).length < 8) return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 8 caractères' });
  await req.user.setPassword(String(next));
  req.user.mustChangePassword = false;
  await req.user.save();
  await audit(req, { action: 'mot-de-passe.modifie', category: 'compte', level: 'security', message: 'Mot de passe modifié' });
  res.json({ ok: true });
});

export default router;
