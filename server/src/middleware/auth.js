import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { User } from '../models/User.js';
import { Company } from '../models/Company.js';
import { accessOf } from '../services/access.js';

export function signToken(user) {
  return jwt.sign({ sub: user._id.toString() }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

/** Authentifie la requête et calcule les droits effectifs (hérités de la société). */
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentification requise' });
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    return res.status(401).json({ error: 'Session expirée, reconnectez-vous' });
  }
  try {
    const user = await User.findById(payload.sub);
    // Compte désactivé : la session s'arrête immédiatement, même avec un jeton encore valide
    if (!user || !user.active) return res.status(401).json({ error: 'Compte inexistant ou désactivé' });
    const company = user.companyId ? await Company.findById(user.companyId).lean() : null;
    req.user = user;
    req.company = company;
    req.access = accessOf(user, company);
    next();
  } catch (e) {
    next(e);
  }
}
