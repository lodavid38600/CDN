// Libellés de la nomenclature (CSV, Excel) et recherche des produits par mots.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';

process.env.NODE_ENV = 'test';
const url = (process.env.MONGO_TEST_URL || 'mongodb://127.0.0.1:27017/douane_saas_test').replace(/\/[^/]*$/, '/douane_saas_libelles');
const { Product } = await import('../src/models/Product.js');
const { Nomenclature } = await import('../src/models/Nomenclature.js');
const { importLabels, searchProducts, extractLabels, readTable, normalize } = await import('../src/services/cnLabels.js');

let available = true;
try {
  await mongoose.connect(url, { serverSelectionTimeoutMS: 1500 });
} catch {
  available = false;
}
const it = (name, fn) => test(name, { skip: !available && 'MongoDB indisponible' }, fn);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lib-'));

before(async () => {
  if (!available) return;
  await mongoose.connection.dropDatabase();
  for (const code of ['22042109', '22042106', '07041000', '85171300', '03028990']) {
    await Product.create({ code, description: `Code NC ${code}`, chapter: code.slice(0, 2), heading: code.slice(0, 4), section: 'I' });
  }
});
after(async () => {
  if (available) { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('texte normalisé : sans accents ni ponctuation', () => {
  assert.equal(normalize('Choux-fleurs ÉTÉ, brocolis'), 'choux fleurs ete brocolis');
});

test('CSV Excel (Windows-1252, « ; », guillemets) : colonne « autosuffisant » préférée', () => {
  const csv = 'Code NC8;Libellé officiel;Libellé autosuffisant\r\n"2204 21 09";"-- autres";"Vins de qualité AOP, en récipients ≤ 2 l"\r\n0704 10 00;Choux-fleurs;"Choux-fleurs et brocolis, frais"\r\n';
  const f = path.join(tmp, 'nc8.csv');
  fs.writeFileSync(f, Buffer.from(csv.replace('≤', '<='), 'latin1'));
  const labels = extractLabels(readTable(f));
  assert.equal(labels.get('22042109'), 'Vins de qualité AOP, en récipients <= 2 l');
  assert.equal(labels.get('07041000'), 'Choux-fleurs et brocolis, frais');
});

it('classeur Excel .xlsx : libellés importés, recherche par mots', async () => {
  // Classeur minimal (texte partagé + feuille), comme ceux de la douane
  const dir = fs.mkdtempSync(path.join(tmp, 'x-'));
  fs.mkdirSync(path.join(dir, 'xl', 'worksheets'), { recursive: true });
  const strings = ['Code', 'Libellé', '22042106', 'Vins mousseux AOP, récipients ≤ 2 l', '8517 13 00', 'Smartphones (téléphones intelligents)', '0302', 'Poissons frais ou réfrigérés', '85171300'];
  fs.writeFileSync(path.join(dir, 'xl', 'sharedStrings.xml'), `<?xml version="1.0"?><sst>${strings.map((s) => `<si><t>${s.replace(/&/g, '&amp;')}</t></si>`).join('')}</sst>`);
  const row = (n, a, b) => `<row r="${n}"><c r="A${n}" t="s"><v>${a}</v></c><c r="B${n}" t="s"><v>${b}</v></c></row>`;
  fs.writeFileSync(path.join(dir, 'xl', 'worksheets', 'sheet1.xml'), `<?xml version="1.0"?><worksheet><sheetData>${row(1, 0, 1)}${row(2, 2, 3)}${row(3, 4, 5)}${row(4, 6, 7)}</sheetData></worksheet>`);
  fs.writeFileSync(path.join(dir, 'xl', 'workbook.xml'), '<workbook/>');
  const za = createRequire(import.meta.url)('7zip-bin').path7za;
  fs.chmodSync(za, 0o755);
  const file = path.join(tmp, 'nc8.xlsx');
  execFileSync(za, ['a', '-tzip', file, '.'], { cwd: dir, stdio: 'ignore' });
  const r = await importLabels(file);
  assert.equal(r.byLevel[8], 2);
  assert.equal(r.byLevel[4], 1);
  assert.equal((await Product.findOne({ code: '85171300' })).description, 'Smartphones (téléphones intelligents)');
  assert.equal((await Nomenclature.findOne({ code: '0302' })).label, 'Poissons frais ou réfrigérés');
  // Recherche : mots dans n'importe quel ordre, accents ignorés, libellés des niveaux parents inclus
  assert.deepEqual((await searchProducts('telephones intelligents')).map((p) => p.code), ['85171300']);
  assert.deepEqual((await searchProducts('AOP mousseux')).map((p) => p.code), ['22042106']);
  assert.ok((await searchProducts('poissons')).some((p) => p.code === '03028990'), 'libellé de la position 0302');
  assert.deepEqual((await searchProducts('2204')).map((p) => p.code), ['22042106', '22042109']);
  assert.deepEqual(await searchProducts('zzzz'), []);
});

it('fichier sans codes : erreur claire', async () => {
  const f = path.join(tmp, 'vide.csv');
  fs.writeFileSync(f, 'nom;prix\npomme;3\n');
  await assert.rejects(importLabels(f), /Aucune colonne de codes NC/);
  const xls = path.join(tmp, 'ancien.xls');
  fs.writeFileSync(xls, Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0]));
  await assert.rejects(importLabels(xls), /\.xlsx ou en CSV/);
});
