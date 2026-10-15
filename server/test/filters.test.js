import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMatch, parseFilters, FilterError } from '../src/services/filters.js';

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
