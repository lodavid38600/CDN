import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forecast } from '../src/services/forecast.js';

test('Holt-Winters retrouve tendance et saisonnalité', () => {
  const f = (i) => 100 + 2 * i + 20 * Math.cos((2 * Math.PI * i) / 12);
  const y = Array.from({ length: 48 }, (_, i) => f(i));
  const r = forecast(y, { horizon: 6 });
  assert.equal(r.method, 'Holt-Winters saisonnier');
  r.values.forEach((v, h) => assert.ok(Math.abs(v - f(48 + h)) / f(48 + h) < 0.03, `h=${h} ${v} vs ${f(48 + h)}`));
  r.values.forEach((v, h) => assert.ok(r.lower[h] <= v && v <= r.upper[h]));
});

test('Holt amorti pour une série courte, jamais négatif', () => {
  const r = forecast([10, 12, 13, 15, 16, 18, 19], { horizon: 3, season: 1 });
  assert.equal(r.method, 'Holt (tendance amortie)');
  assert.ok(r.values[0] > 19 && r.values[2] > r.values[0]);
  const down = forecast([100, 60, 30, 10, 2], { horizon: 5, season: 1 });
  assert.ok(down.values.every((v) => v >= 0) && down.lower.every((v) => v >= 0));
});

test('historique insuffisant', () => {
  assert.equal(forecast([1, 2]).values.length, 0);
});
