import { Router } from 'express';
import { Product } from '../models/Product.js';
import { Nomenclature } from '../models/Nomenclature.js';
import { CHAPTERS, sectionOfChapter, nomenclatureTree } from '../data/nomenclature.js';
import { FilterError } from '../services/filters.js';
import { chapterName, hs6Labels, sectionName } from '../services/labels.js';

const router = Router();

// Racine : sections et chapitres, avec le nombre de codes NC8 disponibles par chapitre.
router.get('/', async (req, res) => {
  const counts = await Product.aggregate([{ $group: { _id: '$chapter', n: { $sum: 1 } } }]);
  const byChapter = Object.fromEntries(counts.map((c) => [c._id, c.n]));
  res.json(
    nomenclatureTree().map((s) => ({
      ...s,
      chapters: s.chapters.map((c) => ({ ...c, productCount: byChapter[c.code] || 0 })),
    }))
  );
});

// Un nœud de la nomenclature (NC02, NC06 ou NC08) : libellé, parents et enfants.
router.get('/:code', async (req, res) => {
  const code = String(req.params.code).replace(/[\s.]/g, '');
  if (!/^(\d{2}|\d{6}|\d{8})$/.test(code)) throw new FilterError('Code attendu : NC02, NC06 ou NC08');
  const chapter = code.slice(0, 2);
  if (!CHAPTERS[chapter]) return res.status(404).json({ error: 'Chapitre inconnu' });
  const section = sectionOfChapter(chapter);

  const parents = [{ code: chapter, level: 2, label: chapterName(chapter) }];
  let label = chapterName(chapter);
  let children = [];

  if (code.length === 2) {
    const products = await Product.find({ chapter }, { code: 1 }).lean();
    const hs6 = [...new Set(products.map((p) => p.code.slice(0, 6)))].sort();
    const labels = await hs6Labels(hs6);
    const n = (h) => products.filter((p) => p.code.startsWith(h)).length;
    children = hs6.map((h) => ({ code: h, level: 6, label: labels[h] || h, productCount: n(h) }));
  } else {
    const hs6 = code.slice(0, 6);
    const labels = await hs6Labels([hs6]);
    parents.push({ code: hs6, level: 6, label: labels[hs6] || hs6 });
    if (code.length === 6) {
      label = labels[hs6] || hs6;
      const products = await Product.find({ code: { $regex: `^${hs6}` } }, { _id: 0, code: 1, description: 1 }).sort({ code: 1 }).lean();
      if (!products.length) return res.status(404).json({ error: 'Sous-position sans code NC disponible' });
      children = products.map((p) => ({ code: p.code, level: 8, label: p.description }));
    } else {
      const product = await Product.findOne({ code }).lean();
      if (!product) return res.status(404).json({ error: 'Code NC introuvable' });
      label = product.description;
      const siblings = await Product.find({ code: { $regex: `^${hs6}` } }, { _id: 0, code: 1, description: 1 }).sort({ code: 1 }).lean();
      children = siblings.map((p) => ({ code: p.code, level: 8, label: p.description, current: p.code === code }));
      const heading = await Nomenclature.findOne({ code: code.slice(0, 4) }).lean();
      if (heading) parents.splice(1, 0, { code: heading.code, level: 4, label: heading.label });
    }
  }

  res.json({
    code, level: code.length, label, chapter, section,
    chapterLabel: chapterName(chapter), sectionLabel: sectionName(section),
    parents: parents.filter((p) => p.code !== code),
    children,
  });
});

export default router;
