// Droits d'accès : héritage des droits de la société, isolation entre sociétés, rôles de
// l'équipe (commercial, administrateur), journal. Nécessitent MongoDB, sinon ignorés.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';

process.env.NODE_ENV = 'test';
const url = (process.env.MONGO_TEST_URL || 'mongodb://127.0.0.1:27017/douane_saas_test').replace(/\/[^/]*$/, '/douane_saas_acces');
const { createApp } = await import('../src/app.js');
const { User } = await import('../src/models/User.js');
const { Company } = await import('../src/models/Company.js');
const { AuditLog } = await import('../src/models/AuditLog.js');
const { Invoice } = await import('../src/models/Invoice.js');
const { migrateLegacyUsers } = await import('../src/services/accounts.js');

let available = true;
try {
  await mongoose.connect(url, { serverSelectionTimeoutMS: 1500 });
} catch {
  available = false;
}
const it = (name, fn) => test(name, { skip: !available && 'MongoDB indisponible' }, fn);
const app = createApp();
const T = {}; // jetons
const as = (who) => ({ Authorization: `Bearer ${T[who]}` });
const login = async (who, email, password = 'motdepasse') => {
  T[who] = (await request(app).post('/api/auth/login').send({ email, password }).expect(200)).body.token;
};
const staff = async (who, email, staffRole) => {
  const u = new User({ email, name: who, staffRole });
  await u.setPassword('motdepasse');
  await u.save();
  await login(who, email);
  return u;
};
let A; let B; let memberId;

before(async () => {
  if (!available) return;
  await mongoose.connection.dropDatabase();
  await Promise.all([User.syncIndexes(), Invoice.syncIndexes()]);
  // Deux sociétés clientes (inscription en libre-service = responsable, offre d'essai)
  T.ownerA = (await request(app).post('/api/auth/register').send({ email: 'owner@a.fr', password: 'motdepasse', company: 'Société A' }).expect(201)).body.token;
  T.ownerB = (await request(app).post('/api/auth/register').send({ email: 'owner@b.fr', password: 'motdepasse', company: 'Société B' }).expect(201)).body.token;
  A = (await request(app).get('/api/auth/me').set(as('ownerA'))).body.company;
  B = (await request(app).get('/api/auth/me').set(as('ownerB'))).body.company;
  await staff('admin', 'admin@saas.fr', 'admin');
  await staff('sales', 'sales@saas.fr', 'commercial');
});
after(async () => {
  if (available) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

it('les droits sont hérités de l\'offre de la société', async () => {
  const me = (await request(app).get('/api/auth/me').set(as('ownerA')).expect(200)).body;
  assert.equal(me.access.plan, 'essai');
  assert.ok(me.access.features.includes('prices'));
  assert.ok(!me.access.features.includes('forecast'));
  assert.ok(me.access.perms.includes('company.manage'));
  assert.equal(me.company.notes, undefined, 'notes internes jamais envoyées au client');
  await request(app).get('/api/stats/forecast').set(as('ownerA')).expect(403);
  await request(app).get('/api/stats/summary?source=world').set(as('ownerA')).expect(403);
  await request(app).get('/api/trade/export.csv').set(as('ownerA')).expect(403);
  // Passage à l'offre Pro par le commercial : les droits suivent immédiatement
  await request(app).put(`/api/admin/companies/${A.id}`).set(as('sales')).send({ plan: 'pro' }).expect(200);
  await request(app).get('/api/stats/forecast').set(as('ownerA')).expect(200);
  // Fonctionnalité retirée au cas par cas
  await request(app).put(`/api/admin/companies/${A.id}`).set(as('sales')).send({ featuresRemove: ['forecast'] }).expect(200);
  await request(app).get('/api/stats/forecast').set(as('ownerA')).expect(403);
  await request(app).put(`/api/admin/companies/${A.id}`).set(as('sales')).send({ featuresRemove: [] }).expect(200);
});

it('abonnement échu ou société suspendue : données bloquées, accueil et support accessibles', async () => {
  await Company.updateOne({ _id: B.id }, { 'subscription.end': new Date(Date.now() - 86400000) });
  const r = await request(app).get('/api/stats/summary').set(as('ownerB')).expect(402);
  assert.equal(r.body.code, 'expired');
  await request(app).get('/api/home').set(as('ownerB')).expect(200);
  await request(app).post('/api/support/tickets').set(as('ownerB')).send({ subject: 'Renouvellement', body: 'Bonjour' }).expect(201);
  await Company.updateOne({ _id: B.id }, { 'subscription.end': null, status: 'suspended' });
  assert.equal((await request(app).get('/api/stats/summary').set(as('ownerB')).expect(402)).body.code, 'suspended');
  await Company.updateOne({ _id: B.id }, { status: 'active' });
  await request(app).get('/api/stats/summary').set(as('ownerB')).expect(200);
});

it('responsable : gère les membres dans la limite des places ; membre : ne gère rien', async () => {
  const r = await request(app).post('/api/company/members').set(as('ownerA')).send({ email: 'membre@a.fr', name: 'Membre' }).expect(201);
  memberId = r.body.member.id;
  assert.ok(r.body.temporaryPassword.length >= 12);
  await login('memberA', 'membre@a.fr', r.body.temporaryPassword);
  assert.equal((await request(app).get('/api/auth/me').set(as('memberA'))).body.user.mustChangePassword, true);
  await request(app).put('/api/company').set(as('memberA')).send({ name: 'Piratage' }).expect(403);
  await request(app).post('/api/company/members').set(as('memberA')).send({ email: 'x@a.fr' }).expect(403);
  await request(app).get('/api/invoices').set(as('memberA')).expect(403);
  // Liste des membres : visible, mais sans e-mails pour un simple membre
  const list = (await request(app).get('/api/company/members').set(as('memberA')).expect(200)).body;
  assert.ok(list.every((m) => m.email === undefined));
  // Places : Pro = 10 ; on les ramène à 2 (responsable + membre) → plus d'ajout possible
  await request(app).put(`/api/admin/companies/${A.id}`).set(as('sales')).send({ seats: 2 }).expect(200);
  await request(app).post('/api/company/members').set(as('ownerA')).send({ email: 'trop@a.fr' }).expect(409);
  // Le dernier responsable ne peut pas se retirer ses droits
  const ownerId = (await request(app).get('/api/auth/me').set(as('ownerA'))).body.user.id;
  await request(app).put(`/api/company/members/${ownerId}`).set(as('ownerA')).send({ companyRole: 'member' }).expect(400);
  await request(app).put('/api/company').set(as('ownerA')).send({ legalName: 'Société A SAS', address: { city: 'Lyon' } }).expect(200);
});

it('compte désactivé : la session s\'arrête immédiatement', async () => {
  await request(app).put(`/api/company/members/${memberId}`).set(as('ownerA')).send({ active: false }).expect(200);
  await request(app).get('/api/home').set(as('memberA')).expect(401);
  await request(app).post('/api/auth/login').send({ email: 'membre@a.fr', password: 'x' }).expect(401);
  await request(app).put(`/api/company/members/${memberId}`).set(as('ownerA')).send({ active: true }).expect(200);
  await request(app).get('/api/home').set(as('memberA')).expect(200);
});

it('isolation entre sociétés : tickets, membres, factures', async () => {
  const tA = (await request(app).post('/api/support/tickets').set(as('ownerA')).send({ subject: 'Question A', body: 'Bonjour', category: 'donnees' }).expect(201)).body;
  const tM = (await request(app).post('/api/support/tickets').set(as('memberA')).send({ subject: 'Question du membre', body: 'Bonjour' }).expect(201)).body;
  await request(app).get(`/api/support/tickets/${tA.id}`).set(as('ownerB')).expect(404);
  await request(app).post(`/api/support/tickets/${tA.id}/messages`).set(as('ownerB')).send({ body: 'intrus' }).expect(404);
  // Le membre ne voit que ses tickets ; le responsable voit ceux de toute la société
  const mine = (await request(app).get('/api/support/tickets').set(as('memberA')).expect(200)).body;
  assert.deepEqual(mine.map((t) => t.id), [tM.id]);
  assert.equal((await request(app).get('/api/support/tickets').set(as('ownerA')).expect(200)).body.length, 2);
  await request(app).put(`/api/company/members/${memberId}`).set(as('ownerB')).send({ active: false }).expect(404);
  // Facture de A invisible pour B
  const inv = (await request(app).post('/api/admin/invoices').set(as('sales')).send({ company: A.id, months: 3 }).expect(201)).body;
  assert.equal(inv.totalHT, 3 * 149);
  assert.equal(inv.totalTTC, Math.round(3 * 149 * 1.2 * 100) / 100);
  assert.match(inv.number, /^F-\d{4}-0001$/);
  await request(app).get(`/api/invoices/${inv._id}`).set(as('ownerB')).expect(404);
  assert.equal((await request(app).get('/api/invoices').set(as('ownerA')).expect(200)).body.length, 1);
  // Chat : chaque société a son fil
  await request(app).post('/api/support/chat').set(as('ownerA')).send({ body: 'Bonjour de A' }).expect(201);
  assert.equal((await request(app).get('/api/support/chat').set(as('ownerB')).expect(200)).body.length, 0);
});

it('notes internes de l\'équipe jamais visibles du client', async () => {
  const [t] = (await request(app).get('/api/admin/tickets?q=Question A').set(as('sales')).expect(200)).body;
  await request(app).post(`/api/admin/tickets/${t._id}/messages`).set(as('sales')).send({ body: 'Client à relancer', internal: true }).expect(200);
  await request(app).post(`/api/admin/tickets/${t._id}/messages`).set(as('sales')).send({ body: 'Nous regardons.' }).expect(200);
  const seen = (await request(app).get(`/api/support/tickets/${t._id}`).set(as('ownerA')).expect(200)).body;
  assert.ok(seen.messages.some((m) => m.body === 'Nous regardons.'));
  assert.ok(!seen.messages.some((m) => m.body === 'Client à relancer'));
  assert.equal(seen.status, 'en_cours');
});

it('espace équipe : client refusé, commercial limité, administrateur complet', async () => {
  await request(app).get('/api/admin/companies').set(as('ownerA')).expect(403);
  await request(app).get('/api/admin/overview').set(as('memberA')).expect(403);
  // Commercial : comptes, abonnements, factures, support ; pas le journal ni l'administration du site
  await request(app).get('/api/admin/companies').set(as('sales')).expect(200);
  await request(app).get('/api/admin/logs').set(as('sales')).expect(403);
  await request(app).get('/api/admin/status').set(as('sales')).expect(403);
  await request(app).post('/api/admin/news').set(as('sales')).send({ title: 'x' }).expect(403);
  await request(app).post('/api/admin/users').set(as('sales')).send({ email: 'nouvel-admin@saas.fr', staffRole: 'admin' }).expect(403);
  const adminId = (await User.findOne({ email: 'admin@saas.fr' }))._id;
  await request(app).put(`/api/admin/users/${adminId}`).set(as('sales')).send({ active: false }).expect(403);
  // Administrateur : tout
  await request(app).get('/api/admin/logs').set(as('admin')).expect(200);
  await request(app).get('/api/admin/status').set(as('admin')).expect(200);
  const created = (await request(app).post('/api/admin/users').set(as('admin')).send({ email: 'c2@saas.fr', staffRole: 'commercial' }).expect(201)).body;
  assert.ok(created.temporaryPassword);
  // Le commercial crée une société et son responsable
  const c = (await request(app).post('/api/admin/companies').set(as('sales')).send({ name: 'Société C', ownerEmail: 'owner@c.fr', plan: 'essentiel' }).expect(201)).body;
  await login('ownerC', 'owner@c.fr', c.temporaryPassword);
  assert.equal((await request(app).get('/api/auth/me').set(as('ownerC'))).body.access.plan, 'essentiel');
});

it('journal : connexions, refus d\'accès, abonnements ; filtrable', async () => {
  await request(app).post('/api/auth/login').send({ email: 'owner@a.fr', password: 'mauvais' }).expect(401);
  const sec = (await request(app).get('/api/admin/logs?level=security').set(as('admin')).expect(200)).body;
  assert.ok(sec.rows.some((r) => r.action === 'connexion.echec'));
  assert.ok(sec.rows.some((r) => r.action === 'acces.refuse'));
  const sub = (await request(app).get(`/api/admin/logs?category=abonnement&company=${A.id}`).set(as('admin')).expect(200)).body;
  assert.ok(sub.rows.length >= 3 && sub.rows.every((r) => r.category === 'abonnement' && String(r.company._id) === A.id));
  assert.ok(await AuditLog.exists({ action: 'facture.emise' }));
  const csv = await request(app).get('/api/admin/logs/export.csv?category=auth').set(as('admin')).expect(200);
  assert.match(csv.text, /connexion\.echec/);
});

it('anciens comptes (avant les sociétés) : migration automatique', async () => {
  await mongoose.connection.collection('users').insertMany([
    { email: 'ancien@x.fr', passwordHash: 'x', plan: 'pro', role: 'user', company: 'Ancienne SARL' },
    { email: 'ancien-admin@x.fr', passwordHash: 'x', plan: 'free', role: 'admin' },
  ]);
  assert.equal(await migrateLegacyUsers(), 2);
  const u = await User.findOne({ email: 'ancien@x.fr' }).populate('companyId').lean();
  assert.equal(u.companyId.name, 'Ancienne SARL');
  assert.equal(u.companyId.plan, 'pro');
  assert.equal(u.companyRole, 'owner');
  assert.equal((await User.findOne({ email: 'ancien-admin@x.fr' })).staffRole, 'admin');
  assert.equal(await migrateLegacyUsers(), 0, 'idempotent');
});

it('limite des connexions : la session elle-même n\'est jamais bloquée', async () => {
  for (let i = 0; i < 60; i++) await request(app).get('/api/auth/me').set(as('ownerA')).expect(200);
});
