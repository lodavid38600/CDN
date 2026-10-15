import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describePrices, weightedQuantile } from '../src/services/priceStats.js';

test('prix moyen = valeur totale / quantité totale, médiane pondérée par les volumes', () => {
  const s = describePrices([
    { v: 100, q: 100 }, // 1 €/kg sur 100 kg
    { v: 900, q: 300 }, // 3 €/kg sur 300 kg
    { v: 50, q: 10 }, // 5 €/kg sur 10 kg
  ]);
  assert.ok(Math.abs(s.mean - 1050 / 410) < 1e-4);
  assert.equal(s.median, 3); // la majorité des tonnes s'échange à 3 €/kg
  assert.equal(s.min, 1);
  assert.equal(s.max, 5);
  assert.equal(s.observations, 3);
});

test('observations inutilisables ignorées (valeur ou quantité nulle, NaN)', () => {
  assert.equal(describePrices([{ v: 0, q: 10 }, { v: 10, q: 0 }, { v: NaN, q: 1 }]), null);
  assert.equal(describePrices([]), null);
});

test('valeurs aberrantes écartées des bornes et des quantiles, mais comptées', () => {
  const obs = Array.from({ length: 20 }, (_, i) => ({ v: 10 + i * 0.1, q: 10 })); // ~1 €/kg
  obs.push({ v: 1e6, q: 1 }); // 1 000 000 €/kg : erreur de saisie
  const s = describePrices(obs);
  assert.equal(s.outliers, 1);
  assert.ok(s.max < 3);
  assert.ok(s.median > 1 && s.median < 1.3);
});

test('quantile pondéré : palier exact', () => {
  const sorted = [{ p: 1, w: 1 }, { p: 2, w: 1 }];
  assert.equal(weightedQuantile(sorted, 0.5), 1.5);
});
