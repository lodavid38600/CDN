import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMatch, parseFilters, FilterError, valueStages, shiftPeriod } from '../src/services/filters.js';

test('parse et construit un filtre complet', () => {
  const f = parseFilters({ yearFrom: '2019', yearTo: '2023', flow: 'export', reporters: 'fr,DE', partners: 'US', sections: 'iv', chapters: '2,84', product: '2204' });
  assert.deepEqual(buildMatch(f), {
    year: { $gte: 2019, $lte: 2023 },
    flow: 'export',
    reporter: { $in: ['FR', 'DE'] },
    partner: { $in: ['US'] },
    section: { $in: ['IV'] },
    chapter: { $in: ['02', '84'] },
    product: { $regex: '^2204' },
  });
});

test('période au mois près', () => {
  const f = parseFilters({ periodFrom: '2018-03', periodTo: '2019-01' });
  assert.deepEqual([f.from, f.to], [{ y: 2018, m: 3 }, { y: 2019, m: 1 }]);
  assert.deepEqual(buildMatch(f), { year: { $gte: 2018, $lte: 2019 } });
  assert.equal(valueStages(f).length, 1);
  assert.equal(valueStages(parseFilters({ yearFrom: '2018', yearTo: '2019' })).length, 0);
  assert.throws(() => parseFilters({ periodFrom: '2018-13' }), FilterError);
  assert.deepEqual(shiftPeriod({ y: 2018, m: 3 }, -12), { y: 2017, m: 3 });
  assert.deepEqual(shiftPeriod({ y: 2018, m: 1 }, -1), { y: 2017, m: 12 });
});

test('les préfixes NC06 et NC02 utilisent les champs dédiés', () => {
  assert.deepEqual(buildMatch(parseFilters({ product: '220421' })), { hs6: '220421' });
  assert.deepEqual(buildMatch(parseFilters({ product: '22' })), { chapter: '22' });
});

test('un code NC8 complet est une égalité stricte', () => {
  assert.equal(buildMatch(parseFilters({ product: '2204.21.09' })).product, '22042109');
});

test('omit ignore le flux', () => {
  assert.deepEqual(buildMatch(parseFilters({ flow: 'import' }), { omit: ['flow'] }), {});
});

test('rejette les valeurs invalides', () => {
  assert.throws(() => parseFilters({ flow: 'x' }), FilterError);
  assert.throws(() => parseFilters({ reporters: 'FR,$ne' }), FilterError);
  assert.throws(() => parseFilters({ product: '22a' }), FilterError);
  assert.throws(() => parseFilters({ yearFrom: '2024', yearTo: '2020' }), FilterError);
  assert.throws(() => parseFilters({ chapters: '.*' }), FilterError);
});
