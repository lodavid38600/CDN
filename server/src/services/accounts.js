import crypto from 'node:crypto';
import { User } from '../models/User.js';
import { Company } from '../models/Company.js';
import { PLANS } from './access.js';

/** Coordonnées d'une société visibles par ses membres (jamais les notes internes). */
export function publicCompany(c) {
  if (!c) return null;
  const { notes, ...rest } = c.toObject ? c.toObject() : c;
  const plan = PLANS[rest.plan] || PLANS.essai;
  return { ...rest, id: String(rest._id), planLabel: plan.label, seats: rest.seats || plan.seats };
}

/** Mot de passe provisoire lisible (communiqué une seule fois, à changer à la première connexion). */
export const tempPassword = () => `${crypto.randomBytes(3).toString('hex')}-${crypto.randomBytes(3).toString('hex')}-${crypto.randomBytes(2).toString('hex')}`;

/** Nouvelle société cliente avec son responsable. */
export async function createCompanyWithOwner({ companyName, email, password, name = '', plan = 'essai', trialDays = PLANS.essai.days, createdBy }) {
  const now = new Date();
  const company = await Company.create({
    name: companyName || email.split('@')[1] || email,
    plan,
    billingEmail: email,
    subscription: { start: now, end: plan === 'essai' ? new Date(now.getTime() + trialDays * 86400000) : undefined },
    accountManager: createdBy?.staffRole === 'commercial' ? createdBy._id : undefined,
  });
  const user = new User({ email, name, companyId: company._id, companyRole: 'owner' });
  await user.setPassword(password);
  try {
    await user.save();
  } catch (e) {
    await Company.deleteOne({ _id: company._id }); // pas de société orpheline
    throw e;
  }
  return { company, user };
}

/**
 * Comptes créés avant les sociétés : chaque client reçoit sa société (dont il devient responsable,
 * offre conservée) ; l'ancien rôle « admin » devient administrateur de l'équipe. Idempotent.
 */
export async function migrateLegacyUsers() {
  let migrated = 0;
  for (const u of await User.find({ $or: [{ role: { $exists: true } }, { plan: { $exists: true } }, { company: { $exists: true } }] })) {
    if (u.role === 'admin' && !u.staffRole) u.staffRole = 'admin';
    if (!u.staffRole && !u.companyId) {
      const c = await Company.create({
        name: u.company || u.email.split('@')[1] || u.email,
        plan: u.plan === 'pro' ? 'pro' : 'essai',
        billingEmail: u.email,
        subscription: { start: u.createdAt || new Date() },
      });
      u.companyId = c._id;
      u.companyRole = 'owner';
    }
    u.set('role', undefined);
    u.set('plan', undefined);
    u.set('company', undefined);
    await u.save();
    migrated += 1;
  }
  return migrated;
}

/** Places restantes dans une société. */
export async function seatsLeft(company) {
  const used = await User.countDocuments({ companyId: company._id, active: true });
  return (company.seats || (PLANS[company.plan] || PLANS.essai).seats) - used;
}
