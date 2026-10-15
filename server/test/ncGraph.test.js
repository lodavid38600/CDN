import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NcGraph, validateLinks, computeWeights, inferLinks, implicitSelfLinks, deriveHs6Links } from '../src/services/ncGraph.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const sumF = (arr) => arr.reduce((s, e) => s + e.fv, 0);

// Volumes fictifs : table (code, année, flux) -> { v, q }
const table = (rows) => (code, year, flow) => rows[`${code}|${year}|${flow}`] || null;

test('validation : formats, années, doublons, priorité des sources, lien vers soi isolé', () => {
  const { valid, rejected } = validateLinks([
    { from: '8517 12 00', to: '85171300', year: 2022 },
    { from: '85171200', to: '85171300', year: 2022, source: 'inferred' }, // doublon moins prioritaire
    { from: '851712', to: '85171300', year: 2022 }, // mauvais format
    { from: '85171200', to: '85171400', year: 1900 }, // année absurde
    { from: '85171200', to: 'abc', year: 2022 },
    { from: '11111111', to: '11111111', year: 2020 }, // vers soi, seul
    { from: '22222222', to: '33333333', year: 2020, source: 'pirate' },
    null,
  ]);
  assert.equal(valid.length, 1);
  assert.equal(valid[0].source, 'official');
  assert.equal(valid[0].from, '85171200');
  assert.equal(rejected.length, 6);
});

test('un lien déduit est écarté si un lien officiel existe pour le même code et la même année', () => {
  const { valid } = validateLinks([
    { from: '10000000', to: '10000001', year: 2020, source: 'official' },
    { from: '10000000', to: '10000002', year: 2020, source: 'inferred' },
  ]);
  assert.deepEqual(valid.map((l) => l.to), ['10000001']);
});

test('éclatement 1 → 2 : poids estimés sur les volumes et conservation de la masse', () => {
  const links = [{ from: 'A', to: 'B', year: 2022 }, { from: 'A', to: 'C', year: 2022 }].map((l) => ({ ...l, source: 'official' }));
  const t = table({ 'A|2021|export': { v: 100, q: 10 }, 'B|2022|export': { v: 80, q: 6 }, 'C|2022|export': { v: 20, q: 4 } });
  const w = computeWeights(links, t, ['export']);
  const g = new NcGraph(w);
  const conv = g.convert('A', 2019, 'export');
  assert.deepEqual(conv.map((c) => c.t), ['B', 'C']);
  close(conv[0].fv, 0.8);
  close(conv[1].fq, 0.4);
  close(sumF(conv), 1);
  // Les données des nouveaux codes restent inchangées
  assert.deepEqual(g.convert('B', 2023, 'export'), [{ t: 'B', fv: 1, fq: 1 }]);
  // Vue « ce qu'est devenu A » : A + la totalité de B et C (A est leur seule origine)
  const d = g.descendants('A', 'export');
  assert.deepEqual(d.map((x) => [x.code, x.from, x.f]), [['A', null, 1], ['B', 2022, 1], ['C', 2022, 1]]);
});

test('fusion 2 → 1 : attribution proportionnelle aux volumes antérieurs', () => {
  const links = [{ from: 'A', to: 'C', year: 2020 }, { from: 'B', to: 'C', year: 2020 }].map((l) => ({ ...l, source: 'official' }));
  const t = table({ 'A|2019|import': { v: 30, q: 1 }, 'B|2019|import': { v: 90, q: 3 }, 'C|2020|import': { v: 125, q: 4 } });
  const g = new NcGraph(computeWeights(links, t, ['import']));
  assert.deepEqual(g.convert('A', 2018, 'import'), [{ t: 'C', fv: 1, fq: 1 }]);
  const dA = g.descendants('A', 'import').find((x) => x.code === 'C');
  const dB = g.descendants('B', 'import').find((x) => x.code === 'C');
  close(dA.f, 0.25);
  close(dB.f, 0.75);
  close(dA.f + dB.f, 1);
});

test('chaîne A → B (2017) → C + D (2022) et données sur plusieurs fenêtres', () => {
  const links = [
    { from: 'A', to: 'B', year: 2017 },
    { from: 'B', to: 'C', year: 2022 },
    { from: 'B', to: 'D', year: 2022 },
  ].map((l) => ({ ...l, source: 'official' }));
  const t = table({ 'A|2016|export': { v: 50, q: 5 }, 'B|2017|export': { v: 60, q: 6 }, 'B|2021|export': { v: 100, q: 10 }, 'C|2022|export': { v: 30, q: 3 }, 'D|2022|export': { v: 90, q: 9 } });
  const g = new NcGraph(computeWeights(links, t, ['export']));
  const a = g.convert('A', 2015, 'export');
  assert.deepEqual(a.map((x) => x.t), ['C', 'D']);
  close(a[0].fv, 0.25);
  close(sumF(a), 1);
  const b = g.convert('B', 2019, 'export');
  close(b.find((x) => x.t === 'D').fv, 0.75);
  const d = g.descendants('A', 'export');
  assert.deepEqual(d.map((x) => x.code).sort(), ['A', 'B', 'C', 'D']);
});

test('éclatement n → n (A, B → C, D)', () => {
  const links = [
    { from: 'A', to: 'C', year: 2020 }, { from: 'A', to: 'D', year: 2020 },
    { from: 'B', to: 'D', year: 2020 },
  ].map((l) => ({ ...l, source: 'official' }));
  const t = table({ 'A|2019|export': { v: 100, q: 1 }, 'B|2019|export': { v: 100, q: 1 }, 'C|2020|export': { v: 50, q: 1 }, 'D|2020|export': { v: 150, q: 1 } });
  const g = new NcGraph(computeWeights(links, t, ['export']));
  const a = g.convert('A', 2019, 'export');
  close(sumF(a), 1);
  close(sumF(g.convert('B', 2019, 'export')), 1);
  // Somme des attributions pour D = 1
  const aD = g.descendants('A', 'export').find((x) => x.code === 'D').f;
  const bD = g.descendants('B', 'export').find((x) => x.code === 'D').f;
  close(aD + bD, 1);
});

test('code réutilisé plus tard pour un autre produit : les nouvelles données ne sont pas converties', () => {
  const links = [{ from: 'A', to: 'B', year: 2017, source: 'official' }];
  const g = new NcGraph(links, { isCurrent: (c) => c === 'A' || c === 'B' });
  assert.deepEqual(g.convert('A', 2016, 'export'), [{ t: 'B', fv: 1, fq: 1 }]);
  assert.deepEqual(g.convert('A', 2023, 'export'), [{ t: 'A', fv: 1, fq: 1 }]);
  assert.equal(g.isObsolete('A'), false);
});

test('donnée tardive d\'un code supprimé : rattachée à son successeur', () => {
  const g = new NcGraph([{ from: 'A', to: 'B', year: 2017, source: 'official' }], { isCurrent: (c) => c === 'B' });
  assert.deepEqual(g.convert('A', 2018, 'export'), [{ t: 'B', fv: 1, fq: 1 }]);
  assert.equal(g.isObsolete('A'), true);
});

test('permutation de codes la même année et aller-retour dans le temps : aucune boucle infinie', () => {
  const g = new NcGraph([
    { from: 'A', to: 'B', year: 2020, source: 'official' },
    { from: 'B', to: 'A', year: 2020, source: 'official' },
    { from: 'B', to: 'C', year: 2021, source: 'official' },
    { from: 'C', to: 'B', year: 2023, source: 'official' },
  ], { isCurrent: () => false });
  assert.deepEqual(g.convert('A', 2019, 'export').map((x) => x.t), ['B']);
  assert.deepEqual(g.convert('B', 2019, 'export').map((x) => x.t), ['A']);
  assert.deepEqual(g.convert('B', 2020, 'export').map((x) => x.t), ['B']);
  assert.ok(Array.isArray(g.descendants('A', 'export')));
});

test('volumes absents l\'année du changement : répartition égale, marquée estimée', () => {
  const links = [{ from: 'A', to: 'B', year: 2020 }, { from: 'A', to: 'C', year: 2020 }].map((l) => ({ ...l, source: 'official' }));
  const w = computeWeights(links, () => null, ['export']);
  assert.ok(w.every((l) => l.estimated));
  const conv = new NcGraph(w).convert('A', 2019, 'export');
  close(conv[0].fv, 0.5);
});

test('éclatement partiel : l\'ancien code continue (lien implicite vers lui-même)', () => {
  const links = [{ from: 'A', to: 'B', year: 2020, source: 'official' }];
  const years = new Map([['A', [2018, 2019, 2020, 2021]], ['B', [2020, 2021]]]);
  const implicit = implicitSelfLinks(links, years);
  assert.deepEqual(implicit.map((l) => [l.from, l.to, l.year]), [['A', 'A', 2020]]);
  const t = table({ 'A|2019|export': { v: 100, q: 10 }, 'A|2020|export': { v: 70, q: 7 }, 'B|2020|export': { v: 30, q: 3 } });
  const g = new NcGraph(computeWeights([...links, ...implicit], t, ['export']), { isCurrent: () => true });
  const conv = g.convert('A', 2019, 'export');
  close(conv.find((x) => x.t === 'A').fv, 0.7);
  close(conv.find((x) => x.t === 'B').fv, 0.3);
  assert.deepEqual(g.convert('A', 2021, 'export'), [{ t: 'A', fv: 1, fq: 1 }]);
});

test('fusion dans un code existant : sa masse propre est prise en compte', () => {
  const links = [{ from: 'A', to: 'B', year: 2020, source: 'official' }];
  const years = new Map([['A', [2018, 2019]], ['B', [2018, 2019, 2020]]]);
  const all = [...links, ...implicitSelfLinks(links, years)];
  const t = table({ 'A|2019|export': { v: 25, q: 1 }, 'B|2019|export': { v: 75, q: 3 }, 'B|2020|export': { v: 100, q: 4 } });
  const g = new NcGraph(computeWeights(all, t, ['export']), { isCurrent: (c) => c === 'B' });
  close(g.descendants('A', 'export').find((x) => x.code === 'B').f, 0.25);
  assert.deepEqual(g.convert('B', 2018, 'export'), [{ t: 'B', fv: 1, fq: 1 }]);
});

test('déduction des liens manquants (même sous-position), orphelins signalés', () => {
  const years = new Map([
    ['85171200', [2018, 2019, 2020, 2021]],
    ['85171300', [2022, 2023, 2024]],
    ['85171400', [2022, 2023, 2024]],
    ['22042109', [2018, 2019, 2020, 2021, 2022, 2023, 2024]],
    ['99999999', [2018, 2019]], // disparaît sans successeur plausible
    ['12345678', [2020, 2021, 2022, 2023, 2024]],
  ]);
  const { inferred, orphans } = inferLinks(years, [], { level: 8, lastYear: 2024 });
  assert.deepEqual(inferred.map((l) => `${l.from}>${l.to}@${l.year}`).sort(), ['85171200>85171300@2022', '85171200>85171400@2022']);
  assert.deepEqual(orphans.map((o) => o.code), ['99999999']);
  // Pas de déduction quand un lien officiel existe déjà
  const again = inferLinks(years, [{ from: '85171200', to: '85171300', year: 2022 }], { level: 8, lastYear: 2024 });
  assert.equal(again.inferred.length, 0);
});

test('liens SH6 dérivés des liens NC8', () => {
  const hs = deriveHs6Links([
    { from: '85171200', to: '85171300', year: 2022, source: 'official' },
    { from: '85171200', to: '85171400', year: 2022, source: 'official' },
    { from: '22042109', to: '22042110', year: 2022, source: 'official' }, // même SH6 : ignoré
  ]);
  assert.deepEqual(hs.map((l) => `${l.from}>${l.to}`), ['851712>851713', '851712>851714']);
});

test('conservation de la masse sur un graphe aléatoire', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const codes = Array.from({ length: 12 }, (_, i) => `C${i}`);
  const links = [];
  for (let i = 0; i < 25; i++) {
    const from = codes[Math.floor(rnd() * 12)];
    const to = codes[Math.floor(rnd() * 12)];
    links.push({ from, to, year: 2016 + Math.floor(rnd() * 8), source: 'official' });
  }
  const { valid } = validateLinks(links.map((l) => ({ ...l, from: l.from.replace('C', '1000000'), to: l.to.replace('C', '1000000') })).map((l) => ({ ...l, from: l.from.slice(-8).padStart(8, '1'), to: l.to.slice(-8).padStart(8, '1') })));
  const rows = {};
  for (const c of new Set(valid.flatMap((l) => [l.from, l.to]))) for (let y = 2014; y <= 2025; y++) rows[`${c}|${y}|export`] = { v: rnd() * 100, q: rnd() * 10 };
  const g = new NcGraph(computeWeights(valid, table(rows), ['export']), { isCurrent: () => false });
  for (const c of new Set(valid.map((l) => l.from))) {
    for (let y = 2014; y <= 2025; y++) close(sumF(g.convert(c, y, 'export')), 1, 1e-9);
  }
});
