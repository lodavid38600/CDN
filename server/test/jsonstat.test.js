import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cells, toTradeFlows } from '../src/services/jsonstat.js';
import { EU_CODES } from '../src/data/countries.js';

// Réponse JSON-stat 2.0 réduite, au format de l'API Comext.
const dataset = {
  version: '2.0', class: 'dataset',
  id: ['freq', 'reporter', 'partner', 'product', 'flow', 'indicators', 'time'],
  size: [1, 1, 2, 1, 2, 2, 1],
  dimension: {
    freq: { category: { index: { A: 0 } } },
    reporter: { category: { index: { FR: 0 } } },
    partner: { category: { index: { US: 0, DE: 1 } } },
    product: { category: { index: { 22042109: 0 }, label: { 22042109: 'Vins AOP' } } },
    flow: { category: { index: { 1: 0, 2: 1 } } },
    indicators: { category: { index: { VALUE_IN_EUROS: 0, QUANTITY_IN_100KG: 1 } } },
    time: { category: { index: { 2023: 0 } } },
  },
  // index = ((partner*1 + product)*2 + flow)*2 + indicator
  value: { 0: 100, 1: 5, 2: 900, 3: 30, 6: 7 },
};

test('cells décode les index plats', () => {
  const all = [...cells(dataset)];
  assert.equal(all.length, 5);
  assert.deepEqual(
    { partner: all[2].partner, flow: all[2].flow, indicators: all[2].indicators, value: all[2].value },
    { partner: 'US', flow: '2', indicators: 'VALUE_IN_EUROS', value: 900 }
  );
});

test('toTradeFlows agrège valeurs et quantités, ignore les partenaires UE', () => {
  const { flows, products } = toTradeFlows(dataset, { euCodes: EU_CODES });
  assert.equal(flows.length, 2);
  const imp = flows.find((f) => f.flow === 'import');
  const exp = flows.find((f) => f.flow === 'export');
  assert.equal(imp.valueEur, 100);
  assert.equal(imp.quantityKg, 500);
  assert.equal(exp.valueEur, 900);
  assert.equal(exp.quantityKg, 3000);
  assert.equal(exp.section, 'IV');
  assert.equal(exp.year, 2023);
  assert.deepEqual(products, [{ code: '22042109', description: 'Vins AOP', chapter: '22', heading: '2204', section: 'IV' }]);
});
