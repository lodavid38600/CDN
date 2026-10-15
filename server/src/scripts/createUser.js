// Création (ou mise à jour) d'un compte, sans données de démonstration.
//   npm run user:create -- --email moi@exemple.fr --password "motdepasse" --admin --pro
import { parseArgs } from 'node:util';
import { connectDb, disconnectDb } from '../db.js';
import { User } from '../models/User.js';

const { values } = parseArgs({
  options: { email: { type: 'string' }, password: { type: 'string' }, name: { type: 'string' }, admin: { type: 'boolean' }, pro: { type: 'boolean' } },
});
const email = String(values.email || '').trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || String(values.password || '').length < 8) {
  console.error('Usage : npm run user:create -- --email moi@exemple.fr --password "8 caractères minimum" [--admin] [--pro]');
  process.exit(1);
}
await connectDb();
try {
  const user = (await User.findOne({ email })) || new User({ email, name: values.name || email.split('@')[0] });
  await user.setPassword(values.password);
  if (values.admin) user.role = 'admin';
  if (values.pro) user.plan = 'pro';
  await user.save();
  console.log(`✔ Compte ${email} prêt (rôle : ${user.role}, offre : ${user.plan})`);
} finally {
  await disconnectDb();
}
