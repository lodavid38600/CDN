// Tests d'intégration : nécessitent un MongoDB accessible (MONGO_TEST_URL), sinon ignorés.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';

process.env.NODE_ENV = 'test';
const url = process.env.MONGO_TEST_URL || 'mongodb://127.0.0.1:27017/douane_saas_test';
const { createApp } = await import('../src/app.js');
const { Product } = await import('../src/models/Product.js');
const { TradeFlow } = await import('../src/models/TradeFlow.js');

let available = true;
try {
  await mongoose.connect(url, { serverSelectionTimeoutMS: 1500 });
} catch {
  available = false;
}
const it = (name, fn) => test(name, { skip: !available && 'MongoDB indisponible' }, fn);

const app = createApp();
let token;

before(async () => {
  if (!available) return;
  await mongoose.connection.dropDatabase();
  await Product.create({ code: '22042109', description: 'Vins AOP', chapter: '22', heading: '2204', section: 'IV' });
  const base = { product: '22042109', chapter: '22', section: 'IV', source: 'demo' };
  await TradeFlow.insertMany([
    { ...base, reporter: 'FR', partner: 'US', year: 2022, flow: 'export', valueEur: 100, quantityKg: 10 },
    { ...base, reporter: 'FR', partner: 'US', year: 2023, flow: 'export', valueEur: 150, quantityKg: 15 },
    { ...base, reporter: 'FR', partner: 'US', year: 2023, flow: 'import', valueEur: 20, quantityKg: 2 },
    { ...base, reporter: 'IT', partner: 'CN', year: 2023, flow: 'export', valueEur: 80, quantityKg: 8 },
  ]);
});

after(async () => {
  if (available) await mongoose.disconnect();
});

it('inscription puis accès protégé', async () => {
  await request(app).get('/api/stats/summary').expect(401);
  const res = await request(app).post('/api/auth/register').send({ email: 'a@b.fr', password: 'motdepasse' }).expect(201);
  token = res.body.token;
  await request(app).post('/api/auth/register').send({ email: 'a@b.fr', password: 'motdepasse' }).expect(409);
  await request(app).post('/api/auth/login').send({ email: 'a@b.fr', password: 'mauvais!' }).expect(401);
});

it('summary calcule totaux, solde et variation', async () => {
  const { body } = await request(app).get('/api/stats/summary').set('Authorization', `Bearer ${token}`).expect(200);
  assert.equal(body.exportEur, 330);
  assert.equal(body.importEur, 20);
  assert.equal(body.balanceEur, 310);
  assert.equal(body.latestYear, 2023);
  assert.equal(body.changeExport, (230 - 100) / 100);
});

it('timeseries et top filtrent par pays', async () => {
  const auth = { Authorization: `Bearer ${token}` };
  const ts = await request(app).get('/api/stats/timeseries?reporters=FR').set(auth).expect(200);
  assert.deepEqual(ts.body.map((r) => [r.year, r.exportEur]), [[2022, 100], [2023, 150]]);
  const top = await request(app).get('/api/stats/top?dimension=partner&flow=export').set(auth).expect(200);
  assert.deepEqual(top.body.map((r) => [r.key, r.label]), [['US', 'États-Unis'], ['CN', 'Chine']]);
});

it('trade pagine, enrichit et exporte en CSV', async () => {
  const auth = { Authorization: `Bearer ${token}` };
  const { body } = await request(app).get('/api/trade?flow=export&limit=2').set(auth).expect(200);
  assert.equal(body.total, 3);
  assert.equal(body.rows.length, 2);
  assert.equal(body.rows[0].valueEur, 150);
  assert.equal(body.rows[0].description, 'Vins AOP');
  const csv = await request(app).get('/api/trade/export.csv?year=2023').set(auth).expect(200);
  assert.equal(csv.text.trim().split('\n').length, 4);
  await request(app).get('/api/trade?flow=nope').set(auth).expect(400);
});

it('fiche produit et recherche', async () => {
  const auth = { Authorization: `Bearer ${token}` };
  const p = await request(app).get('/api/products/22042109').set(auth).expect(200);
  assert.deepEqual(p.body.years, [2022, 2023]);
  await request(app).get('/api/products/99999999').set(auth).expect(404);
  const s = await request(app).get('/api/products?q=vins').set(auth).expect(200);
  assert.equal(s.body.total, 1);
});
