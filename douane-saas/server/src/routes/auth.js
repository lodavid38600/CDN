import { Router } from 'express';
import { User } from '../models/User.js';
import { requireAuth, signToken } from '../middleware/auth.js';

const router = Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/register', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const name = String(req.body?.name || '').slice(0, 100);
  const company = String(req.body?.company || '').slice(0, 100);
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Adresse e-mail invalide' });
  if (password.length < 8) {
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères' });
  }
  if (await User.exists({ email })) return res.status(409).json({ error: 'Cet e-mail est déjà utilisé' });

  const user = new User({ email, name, company });
  await user.setPassword(password);
  await user.save();
  res.status(201).json({ token: signToken(user), user: user.toPublic() });
});

router.post('/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const user = await User.findOne({ email });
  if (!user || !(await user.checkPassword(password))) {
    return res.status(401).json({ error: 'Identifiants incorrects' });
  }
  res.json({ token: signToken(user), user: user.toPublic() });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user.toPublic() });
});

export default router;
