// Création d'un compte, sans données de démonstration.
//   npm run user:create -- --email moi@exemple.fr --password "motdepasse" --admin        administrateur (équipe)
//   npm run user:create -- --email c@exemple.fr --password "motdepasse" --commercial     commercial (équipe)
//   npm run user:create -- --email client@societe.fr --password "motdepasse" --company "Société SA" --plan pro
//                                                                                       client responsable de sa société
import { parseArgs } from 'node:util';
import { connectDb, disconnectDb } from '../db.js';
import { User } from '../models/User.js';
import { Company } from '../models/Company.js';
import { PLANS } from '../services/access.js';
import { migrateLegacyUsers } from '../services/accounts.js';

const { values } = parseArgs({
  options: {
    email: { type: 'string' }, password: { type: 'string' }, name: { type: 'string' },
    admin: { type: 'boolean' }, commercial: { type: 'boolean' }, company: { type: 'string' }, plan: { type: 'string' },
  },
});
const email = String(values.email || '').trim().toLowerCase();
const staffRole = values.admin ? 'admin' : values.commercial ? 'commercial' : null;
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || String(values.password || '').length < 8 || (!staffRole && !values.company)) {
  console.error('Usage : npm run user:create -- --email moi@exemple.fr --password "8 caractères minimum" (--admin | --commercial | --company "Nom" [--plan essai|essentiel|pro|entreprise])');
  process.exit(1);
}
await connectDb();
try {
  await migrateLegacyUsers();
  const user = (await User.findOne({ email })) || new User({ email, name: values.name || email.split('@')[0] });
  await user.setPassword(values.password);
  user.active = true;
  if (staffRole) {
    user.staffRole = staffRole;
    user.companyId = undefined;
  } else {
    const plan = PLANS[values.plan] ? values.plan : 'essai';
    const company = (await Company.findOne({ name: values.company })) || await Company.create({ name: values.company, plan, billingEmail: email, subscription: { start: new Date() } });
    user.staffRole = null;
    user.companyId = company._id;
    user.companyRole = 'owner';
  }
  await user.save();
  console.log(`✔ Compte ${email} prêt (${staffRole ? `équipe : ${staffRole}` : `responsable de « ${values.company} »`})`);
} finally {
  await disconnectDb();
}
