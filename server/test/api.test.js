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
const { Nomenclature } = await import('../src/models/Nomenclature.js');
const { invalidateDataRange } = await import('../src/services/dataRange.js');

let available = true;
try {
  await mongoose.connect(url, { serverSelectionTimeoutMS: 1500 });
} catch {
  available = false;
}
const it = (name, fn) => test(name, { skip: !available && 'MongoDB indisponible' }, fn);

const app = createApp();
let token;
const auth = () => ({ Authorization: `Bearer ${token}` });

// 10 € par mois (12 kg) sauf mention contraire.
const monthly = (v = 10, n = 12) => Array.from({ length: 12 }, (_, i) => (i < n ? v : 0));
function flow(o) {
  const months = o.months || monthly();
  const monthsKg = months.map((v) => v * 1.2);
  return {
    product: '22042109', hs6: '220421', chapter: '22', section: 'IV', source: 'demo',
    valueEur: months.reduce((a, b) => a + b, 0), quantityKg: monthsKg.reduce((a, b) => a + b, 0),
    months, monthsKg, ...o,
  };
}

before(async () => {
  if (!available) return;
  await mongoose.connection.dropDatabase();
  await TradeFlow.syncIndexes();
  invalidateDataRange();
  await Product.create({ code: '22042109', description: 'Vins AOP', chapter: '22', heading: '2204', section: 'IV' });
  await Nomenclature.create({ code: '220421', level: 6, label: 'Vins en récipients ≤ 2 l' });
  await TradeFlow.insertMany([
    flow({ reporter: 'FR', partner: 'US', year: 2022, flow: 'export' }), // 120
    flow({ reporter: 'FR', partner: 'US', year: 2023, flow: 'export', months: monthly(20) }), // 240
    flow({ reporter: 'FR', partner: 'US', year: 2023, flow: 'import', months: monthly(2) }), // 24
    flow({ reporter: 'IT', partner: 'CN', year: 2023, flow: 'export', months: monthly(5) }), // 60
    flow({ reporter: 'IT', partner: 'CN', year: 2024, flow: 'export', months: monthly(5, 6) }), // 30, jan-juin
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

it('meta expose la dernière période disponible', async () => {
  const { body } = await request(app).get('/api/meta').set(auth()).expect(200);
  assert.equal(body.firstPeriod, '2022-01');
  assert.equal(body.lastPeriod, '2024-06');
});

it('summary sur une période au mois près (mars 2022 → janvier 2023)', async () => {
  const { body } = await request(app)
    .get('/api/stats/summary?reporters=FR&periodFrom=2022-03&periodTo=2023-01')
    .set(auth())
    .expect(200);
  assert.equal(body.exportEur, 10 * 10 + 20); // mars-déc 2022 + janvier 2023
  assert.equal(body.importEur, 2);
  assert.equal(body.period.months, 11);
  assert.equal(body.previous.from, '2021-03');
});

it('summary sans période : 12 derniers mois vs 12 précédents', async () => {
  const { body } = await request(app).get('/api/stats/summary').set(auth()).expect(200);
  assert.equal(body.exportEur, 120 + 240 + 60 + 30);
  assert.equal(body.reference.from, '2023-07');
  assert.equal(body.reference.to, '2024-06');
  assert.equal(body.reference.exportEur, 6 * 20 + 6 * 5 + 30);
});

it('timeseries mensuelle et annuelle', async () => {
  const m = await request(app).get('/api/stats/timeseries?granularity=month&periodFrom=2023-11&periodTo=2024-02').set(auth()).expect(200);
  assert.deepEqual(m.body.map((r) => [r.period, r.exportEur]), [['2023-11', 25], ['2023-12', 25], ['2024-01', 5], ['2024-02', 5]]);
  const y = await request(app).get('/api/stats/timeseries?reporters=IT').set(auth()).expect(200);
  assert.deepEqual(y.body.map((r) => [r.year, r.exportEur, r.months]), [[2022, 0, 12], [2023, 60, 12], [2024, 30, 6]]);
});

it('timeseries trimestrielle et prévision trimestrielle', async () => {
  const q = await request(app).get('/api/stats/timeseries?granularity=quarter&reporters=IT').set(auth()).expect(200);
  const last = q.body.slice(-3).map((r) => [r.period, r.exportEur, r.months]);
  assert.deepEqual(last, [['2023-T4', 15, 3], ['2024-T1', 15, 3], ['2024-T2', 15, 3]]);
  const fc = await request(app).get('/api/stats/forecast?granularity=quarter&horizon=2').set(auth()).expect(200);
  assert.deepEqual(fc.body.forecast.map((r) => r.period), ['2024-T3', '2024-T4']);
});

it('top par NC06 et par partenaire', async () => {
  const top = await request(app).get('/api/stats/top?dimension=partner&flow=export').set(auth()).expect(200);
  assert.deepEqual(top.body.map((r) => [r.key, r.label]), [['US', 'États-Unis'], ['CN', 'Chine']]);
  const hs6 = await request(app).get('/api/stats/top?dimension=hs6').set(auth()).expect(200);
  assert.equal(hs6.body[0].label, 'Vins en récipients ≤ 2 l');
});

it('prévision mensuelle', async () => {
  const { body } = await request(app).get('/api/stats/forecast?horizon=3').set(auth()).expect(200);
  assert.equal(body.forecast.length, 3);
  assert.equal(body.forecast[0].period, '2024-07');
  assert.ok(body.forecast.every((r) => r.exportLow <= r.export && r.export <= r.exportHigh));
});

it('trade pagine, enrichit et exporte en CSV', async () => {
  const { body } = await request(app).get('/api/trade?flow=export&limit=2').set(auth()).expect(200);
  assert.equal(body.total, 4);
  assert.equal(body.rows[0].valueEur, 240);
  assert.equal(body.rows[0].description, 'Vins AOP');
  const csv = await request(app).get('/api/trade/export.csv?year=2023').set(auth()).expect(200);
  assert.equal(csv.text.trim().split('\n').length, 4);
  await request(app).get('/api/trade?flow=nope').set(auth()).expect(400);
});

it('navigation dans la nomenclature', async () => {
  const ch = await request(app).get('/api/nomenclature/22').set(auth()).expect(200);
  assert.deepEqual(ch.body.children.map((c) => c.code), ['220421']);
  const hs = await request(app).get('/api/nomenclature/220421').set(auth()).expect(200);
  assert.deepEqual(hs.body.children.map((c) => c.code), ['22042109']);
  await request(app).get('/api/nomenclature/2204').set(auth()).expect(400);
  const p = await request(app).get('/api/products/22042109').set(auth()).expect(200);
  assert.deepEqual(p.body.years, [2022, 2023, 2024]);
});

it('rapports : création, ajout de blocs, isolation entre comptes', async () => {
  const created = await request(app).post('/api/reports').set(auth()).send({ title: 'Vins', blocks: [{ type: 'heading', text: 'Intro' }] }).expect(201);
  const id = created.body._id;
  await request(app).post(`/api/reports/${id}/blocks`).set(auth()).send({ blocks: [{ type: 'text', html: '<p>ok</p>' }] }).expect(200);
  const list = await request(app).get('/api/reports').set(auth()).expect(200);
  assert.equal(list.body[0].blockCount, 2);
  await request(app).put(`/api/reports/${id}`).set(auth()).send({ blocks: [{ type: 'evil' }] }).expect(400);

  const other = await request(app).post('/api/auth/register').send({ email: 'c@d.fr', password: 'motdepasse' }).expect(201);
  await request(app).get(`/api/reports/${id}`).set({ Authorization: `Bearer ${other.body.token}` }).expect(404);
  await request(app).delete(`/api/reports/${id}`).set(auth()).expect(204);
});
