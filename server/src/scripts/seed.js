// Génère un jeu de données de démonstration réaliste (codes NC réels, montants simulés)
// et un compte de démonstration. Les données Eurostat réelles s'importent via import:eurostat.
//
//   npm run seed                          (remplace les données de démo)
//   npm run seed -- --from 2015-01 --to 2026-06

import { parseArgs } from 'node:util';
import { connectDb, disconnectDb } from '../db.js';
import { EU_COUNTRIES, EXTRA_EU_COUNTRIES } from '../data/countries.js';
import { sectionOfChapter } from '../data/nomenclature.js';
import { DEMO_PRODUCTS, HS6_LABELS, SEASONALITY, DEMO_EXTRA_CODES, NC_CHANGES } from '../data/demoProducts.js';
import { WorldFlow } from '../models/WorldFlow.js';
import { NcLink } from '../models/NcLink.js';
import { checkFlow } from '../services/quality.js';
import { syncNomenclature } from '../services/ncSync.js';
import { syncWorld } from '../services/worldSync.js';
import { bumpDataVersion } from '../services/dataVersion.js';
import { ANNUAL_FALLBACK } from '../connectors/fx.js';
import { CHAPTERS } from '../data/nomenclature.js';
import { Nomenclature } from '../models/Nomenclature.js';
import { Product } from '../models/Product.js';
import { TradeFlow } from '../models/TradeFlow.js';
import { User } from '../models/User.js';

const { values: args } = parseArgs({
  options: { from: { type: 'string', default: '2015-01' }, to: { type: 'string', default: '2026-06' } },
});
const [fromYear] = args.from.split('-').map(Number);
const [toYear, lastMonth] = args.to.split('-').map(Number);

// Générateur pseudo-aléatoire déterministe (mulberry32) : même seed => mêmes données.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20241014);
const pickN = (arr, n) => [...arr].sort(() => rand() - 0.5).slice(0, n);

// Poids économiques approximatifs des déclarants UE et des partenaires.
const REPORTER_WEIGHT = { DE: 26, NL: 14, FR: 12, IT: 11, BE: 9, ES: 7, IE: 6, PL: 5, AT: 3.5, SE: 3, CZ: 3, DK: 2.5, HU: 2, FI: 1.6, PT: 1.5, SK: 1.4, RO: 1.4, GR: 1.2, SI: 1, BG: 0.8, LU: 0.6, LT: 0.7, HR: 0.5, LV: 0.3, EE: 0.3, CY: 0.2, MT: 0.15 };
const PARTNER_WEIGHT = { US: 22, CN: 21, GB: 14, CH: 9, TR: 5, JP: 4, KR: 3.5, NO: 4, IN: 3, BR: 2.5, TW: 2.2, VN: 2, SG: 2, MX: 1.8, CA: 2, AE: 2, SA: 1.6, MA: 1.4, ZA: 1.3, AU: 1.5, IL: 1.2, DZ: 1.2, UA: 1.5, EG: 1, TH: 1.1, ID: 1, TN: 0.9, RS: 0.9, AR: 0.7, CL: 0.7, NG: 0.8, NZ: 0.4 };

// Pays UE spécialisés sur certains produits (toujours présents, poids renforcé).
const SPECIALISTS = {
  '22042109': ['FR', 'IT', 'ES', 'PT', 'DE'], '22041011': ['FR'], '15091020': ['ES', 'IT', 'GR', 'PT'],
  '87032319': ['DE', 'BE', 'SK', 'CZ', 'ES', 'FR', 'IT'], '87038010': ['DE', 'BE', 'SE', 'FR'],
  '88024000': ['FR', 'DE'], '88073000': ['FR', 'DE', 'ES'], '84862000': ['NL', 'DE'],
  '30021500': ['IE', 'BE', 'DE', 'NL'], '30024100': ['BE', 'DE', 'IE', 'NL'], '30049000': ['DE', 'IE', 'BE', 'FR', 'IT', 'DK'],
  '33030010': ['FR', 'IT', 'ES'], '42022100': ['IT', 'FR'], '04069021': ['IE', 'NL'], '02032955': ['ES', 'DE', 'DK', 'NL'],
  '10019900': ['FR', 'RO', 'BG', 'DE'], '22030001': ['NL', 'BE', 'DE', 'IE'], '27090090': ['NL', 'DE', 'IT', 'ES', 'FR'],
  '27111100': ['FR', 'ES', 'NL', 'BE', 'IT'], '27112100': ['DE', 'IT', 'AT', 'SK'], '09011100': ['DE', 'BE', 'IT'],
  '18010000': ['NL', 'BE', 'DE', 'FR'], '08039010': ['BE', 'NL', 'DE', 'IT'], '85171300': ['NL', 'DE', 'FR', 'IT'],
};

// Positionnement prix propre à chaque pays et produit (gamme, qualité, mix) : ±35 %,
// déterministe pour que les analyses de prix restent stables d'un seed à l'autre.
function hash(str) {
  let h = 2166136261;
  for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}
const priceFactor = (country, product) => 0.7 + 0.7 * hash(`${country}|${product}`);
const partnerPrice = (country, product) => 0.9 + 0.2 * hash(`p|${country}|${product}`);

// Chocs macro-économiques simplifiés (indice du commerce par année).
const MACRO = { 2015: 0.86, 2016: 0.87, 2017: 0.92, 2018: 0.96, 2019: 0.97, 2020: 0.87, 2021: 1.0, 2022: 1.16, 2023: 1.08, 2024: 1.06, 2025: 1.08, 2026: 1.1 };

// Profil mensuel (moyenne 1) : saisonnalité du produit, creux d'août dans l'industrie,
// choc du confinement au printemps 2020.
function monthProfile(code, chapter, year) {
  const [peak, amp] = SEASONALITY[code] || [1 + Math.floor(rand() * 12), 0.06];
  const industrial = Number(chapter) >= 84 && Number(chapter) <= 90;
  const raw = Array.from({ length: 12 }, (_, i) => {
    let f = 1 + amp * Math.cos((2 * Math.PI * (i + 1 - peak)) / 12);
    if (industrial && i === 7) f *= 0.78;
    if (year === 2020 && (i === 3 || i === 4)) f *= 0.7;
    return f;
  });
  const mean = raw.reduce((a, b) => a + b, 0) / 12;
  return raw.map((f) => f / mean);
}

function yearFactor(year, chapter, product) {
  let f = MACRO[year] ?? 1;
  if (chapter === '27' && year === 2022) f *= 1.8; // flambée énergétique
  if (chapter === '27' && year === 2023) f *= 1.2;
  if (chapter === '30' && (year === 2021 || year === 2022)) f *= 1.35; // vaccins
  if (product === '87038010') f *= Math.pow(1.45, year - 2015) / 30; // essor des VE
  if (product === '85414300') f *= year >= 2021 ? 1.4 : 0.8; // solaire
  return f;
}

async function main() {
  await connectDb();

  const products = [...DEMO_PRODUCTS.map(([code, description]) => [code, description]), ...Object.entries(DEMO_EXTRA_CODES)].map(([code, description]) => ({
    code, description, chapter: code.slice(0, 2), heading: code.slice(0, 4), section: sectionOfChapter(code.slice(0, 2)),
  }));
  await Product.bulkWrite(products.map((p) => ({ updateOne: { filter: { code: p.code }, update: { $set: p }, upsert: true } })));
  const labels = [
    ...Object.entries(CHAPTERS).map(([code, label]) => ({ code, level: 2, label })),
    ...Object.entries(HS6_LABELS).map(([code, label]) => ({ code, level: 6, label })),
    ...products.map((p) => ({ code: p.code, level: 8, label: p.description })),
  ];
  await Nomenclature.bulkWrite(labels.map((n) => ({ updateOne: { filter: { code: n.code }, update: { $set: n }, upsert: true } })));
  await TradeFlow.deleteMany({ source: 'demo' });
  await WorldFlow.deleteMany({ $or: [{ demo: true }, { mirror: true }, { source: 'eurostat' }] });
  await Promise.all([TradeFlow.syncIndexes(), WorldFlow.syncIndexes(), NcLink.syncIndexes()]);

  const docs = [];
  // Changement de nomenclature : avant l'année du changement, le volume est déclaré sous
  // l'ancien code ; après, il est réparti entre les nouveaux codes (prix différents).
  const PRICE_FACTOR = { '85171400': 0.3, '85414200': 0.65 };
  const emit = (doc) => {
    const change = NC_CHANGES.find((c) => c.head === doc.product);
    if (!change) return docs.push(doc);
    if (doc.year < change.year) return docs.push({ ...doc, product: change.from, hs6: change.from.slice(0, 6) });
    const entries = Object.entries(change.to);
    const raw = entries.map(([, w]) => w * (0.94 + rand() * 0.12));
    const sum = raw.reduce((a, b) => a + b, 0);
    entries.forEach(([code], k) => {
      const share = raw[k] / sum;
      const pf = PRICE_FACTOR[code] || 1;
      const months = doc.months.map((v) => Math.round(v * share));
      const monthsKg = doc.monthsKg.map((q) => Math.round((q * share) / pf));
      if (months.some((v) => v > 0)) docs.push({ ...doc, product: code, hs6: code.slice(0, 6), months, monthsKg });
    });
  };
  for (const [code, , baseM, exportShare, pricePerKg] of DEMO_PRODUCTS) {
    const chapter = code.slice(0, 2);
    const section = sectionOfChapter(chapter);
    const specialists = SPECIALISTS[code] || [];
    const reporters = [
      ...EU_COUNTRIES.filter((c) => specialists.includes(c.code)),
      ...pickN(EU_COUNTRIES.filter((c) => !specialists.includes(c.code)), 4 + Math.floor(rand() * 6)),
    ];
    // Les grands partenaires sont toujours présents, complétés par un échantillon d'autres pays.
    const MAJOR = ['US', 'CN', 'GB', 'CH'];
    const partners = [
      ...EXTRA_EU_COUNTRIES.filter((c) => MAJOR.includes(c.code)),
      ...pickN(EXTRA_EU_COUNTRIES.filter((c) => !MAJOR.includes(c.code)), 4 + Math.floor(rand() * 8)),
    ];
    const partnerTotal = partners.reduce((a, p) => a + PARTNER_WEIGHT[p.code], 0);
    // Les spécialistes pèsent selon leur rang (le premier domine), les autres selon leur poids économique.
    const rw = (c) => (specialists.includes(c) ? 40 / (specialists.indexOf(c) + 1) : REPORTER_WEIGHT[c] * 0.5);
    const repTotal = reporters.reduce((a, r) => a + rw(r.code), 0);

    for (const r of reporters) {
      // Spécialisation : certains pays pèsent plus que leur poids sur un produit donné.
      const specialization = specialists.includes(r.code) ? 0.9 + rand() * 0.2 : 0.4 + rand() * 1.2;
      for (const p of partners) {
        const share = (rw(r.code) / repTotal) * (PARTNER_WEIGHT[p.code] / partnerTotal) * specialization;
        const bias = 0.6 + rand() * 0.8;
        for (let year = fromYear; year <= toYear; year++) {
          const yf = yearFactor(year, chapter, code);
          const nMonths = year === toYear ? lastMonth : 12;
          const profile = monthProfile(code, chapter, year);
          for (const flow of ['import', 'export']) {
            const flowShare = flow === 'export' ? exportShare : 1 - exportShare;
            const noise = 0.85 + rand() * 0.3;
            const annual = baseM * 0.6e6 * share * flowShare * bias * yf * noise;
            if (annual < 12000) continue; // secret statistique / valeurs négligeables
            const price = pricePerKg * priceFactor(r.code, code) * partnerPrice(p.code, code) * (0.93 + rand() * 0.14) * (MACRO[year] ?? 1);
            const months = Array(12).fill(0);
            const monthsKg = Array(12).fill(0);
            for (let i = 0; i < nMonths; i++) {
              const v = Math.round((annual / 12) * profile[i] * (0.88 + rand() * 0.24));
              months[i] = v;
              monthsKg[i] = Math.round(v / (price * (0.96 + rand() * 0.08)));
            }
            emit({
              reporter: r.code, partner: p.code, product: code, hs6: code.slice(0, 6), chapter, section, year, flow,
              months, monthsKg, source: 'demo',
            });
          }
        }
      }
    }
  }

  // Mêmes contrôles de qualité que pour les données réelles
  const valid = [];
  for (const d of docs) {
    const res = checkFlow(d, { level: 8 });
    if (res.ok) valid.push({ ...res.doc, tc: [res.doc.product] });
  }
  for (let i = 0; i < valid.length; i += 5000) {
    await TradeFlow.insertMany(valid.slice(i, i + 5000), { ordered: false });
  }
  console.log(`✔ UE : ${products.length} codes NC, ${valid.length} lignes annuelles avec détail mensuel (${args.from} → ${args.to}), ${docs.length - valid.length} rejetées`);

  const world = await seedWorld(valid);
  console.log(`✔ Monde : ${world} lignes déclarées par des pays hors UE`);

  console.log('  synchronisation de la nomenclature NC8…');
  const nc = await syncNomenclature({ level: 8 });
  console.log(`✔ NC8 : ${nc.official} liens officiels, ${nc.inferred || 0} déduits, ${nc.implicit || 0} implicites, ${nc.changedCodes} codes modifiés`);
  console.log('  construction du jeu mondial (UE + miroirs + SH6)…');
  const w = await syncWorld();
  console.log(`✔ Miroirs : ${w.mirror.mirroredCountries.join(', ')} ; SH6 : ${w.nc.official} liens`);
  await bumpDataVersion({ lastImport: new Date(), seed: true });

  const email = 'demo@douane-saas.eu';
  let demo = await User.findOne({ email });
  if (!demo) demo = new User({ email, name: 'Compte démo', company: 'Démo SAS', plan: 'pro' });
  demo.role = 'admin';
  await demo.setPassword('demo12345');
  await demo.save();

  console.log(`✔ Compte démo : ${email} / demo12345`);
  await disconnectDb();
}

// Sources des pays hors UE simulées (mêmes devises et mêmes particularités que les vraies sources)
const WORLD_REPORTERS = {
  US: { source: 'us-census', currency: 'USD', kgFactor: 0.82, quality: ['poids-partiel'] },
  GB: { source: 'uk-hmrc', currency: 'GBP' },
  NO: { source: 'ssb', currency: 'NOK' },
  CH: { source: 'comtrade', currency: 'USD' }, JP: { source: 'comtrade', currency: 'USD' },
  KR: { source: 'comtrade', currency: 'USD' }, IN: { source: 'comtrade', currency: 'USD' },
  BR: { source: 'comtrade', currency: 'USD' }, CA: { source: 'comtrade', currency: 'USD' },
  AU: { source: 'comtrade', currency: 'USD' }, TR: { source: 'comtrade', currency: 'USD' },
  MX: { source: 'comtrade', currency: 'USD' }, ZA: { source: 'comtrade', currency: 'USD' },
};
const PRIORITY = { 'us-census': 3, 'uk-hmrc': 3, ssb: 3, comtrade: 2 };
const fxAnnual = (cur, y) => ANNUAL_FALLBACK[cur]?.[y] ?? ANNUAL_FALLBACK[cur]?.[2024] ?? 1;

/**
 * Données déclarées par des pays hors UE :
 *  - leur commerce avec l'UE, cohérent avec les déclarations européennes (écarts CAF/FAB,
 *    délais, devises), ce qui permet les comparaisons miroir ;
 *  - leur commerce entre eux (États-Unis ↔ Chine, Japon ↔ Corée…), absent d'Eurostat.
 */
async function seedWorld(euDocs) {
  const out = [];
  const push = (d, cfg) => {
    const rate = fxAnnual(cfg.currency, d.year);
    const valueOrig = d.months.reduce((a, b) => a + b, 0) * rate;
    const res = checkFlow({ ...d, currency: cfg.currency, valueOrig: Math.round(valueOrig), source: cfg.source, priority: PRIORITY[cfg.source], mirror: false, demo: true, quality: cfg.quality }, { level: 6 });
    if (res.ok) out.push({ ...res.doc, tc: [res.doc.product] });
  };
  // 1. Commerce avec l'UE, vu par le partenaire
  const agg = new Map();
  for (const d of euDocs) {
    if (!WORLD_REPORTERS[d.partner]) continue;
    const key = `${d.partner}|${d.reporter}|${d.hs6}|${d.year}|${d.flow}`;
    const e = agg.get(key) || { reporter: d.partner, partner: d.reporter, product: d.hs6, year: d.year, flow: d.flow === 'export' ? 'import' : 'export', months: Array(12).fill(0), monthsKg: Array(12).fill(0) };
    for (let i = 0; i < 12; i++) {
      e.months[i] += d.months[i];
      e.monthsKg[i] += d.monthsKg[i];
    }
    agg.set(key, e);
  }
  for (const e of agg.values()) {
    const cfg = WORLD_REPORTERS[e.reporter];
    const cif = e.flow === 'import' ? 1.05 : 0.97; // importations valorisées CAF, exportations FAB
    const lvl = 0.92 + rand() * 0.16;
    const months = e.months.map((v) => Math.round(v * cif * lvl * (0.95 + rand() * 0.1)));
    const monthsKg = e.monthsKg.map((q) => Math.round(q * (cfg.kgFactor || 1) * (0.97 + rand() * 0.06)));
    push({ ...e, months, monthsKg }, cfg);
  }
  // 2. Commerce entre pays hors UE (inconnu d'Eurostat)
  const nonEu = EXTRA_EU_COUNTRIES.map((c) => c.code);
  for (const [code, , baseM, , pricePerKg] of DEMO_PRODUCTS) {
    const chapter = code.slice(0, 2);
    const reporters = pickN(Object.keys(WORLD_REPORTERS), 5);
    for (const rep of reporters) {
      const partners = pickN(['CN', ...nonEu.filter((c) => c !== rep && c !== 'CN')], 4).filter((c) => c !== rep);
      for (const partner of partners) {
        // Poids moyen ≈ 1 ; racine pour éviter que deux grands pays n'écrasent tout
        const w = (Math.sqrt(PARTNER_WEIGHT[partner] * PARTNER_WEIGHT[rep]) / 4.4) * (0.5 + rand());
        for (let year = fromYear; year <= toYear; year++) {
          const nMonths = year === toYear ? lastMonth : 12;
          const profile = monthProfile(code, chapter, year);
          for (const flow of ['import', 'export']) {
            // Commerce hors UE ≈ 30 % du commerce extra-UE du produit, réparti sur ~40 flux
            const annual = ((baseM * 1e6 * 0.3) / 40) * 0.25 * w * yearFactor(year, chapter, code) * (0.85 + rand() * 0.3);
            if (annual < 50000) continue;
            const price = pricePerKg * (0.85 + rand() * 0.3);
            const months = Array(12).fill(0);
            const monthsKg = Array(12).fill(0);
            for (let i = 0; i < nMonths; i++) {
              months[i] = Math.round((annual / 12) * profile[i] * (0.9 + rand() * 0.2));
              monthsKg[i] = Math.round(months[i] / price);
            }
            const change = NC_CHANGES.find((c) => c.head === code);
            const hs = change && year < change.year ? change.from.slice(0, 6) : code.slice(0, 6);
            push({ reporter: rep, partner, product: hs, year, flow, months, monthsKg }, WORLD_REPORTERS[rep]);
          }
        }
      }
    }
  }
  // Dédoublonnage (même pays, partenaire, produit, année, flux) puis insertion
  const unique = new Map();
  for (const d of out) unique.set(`${d.reporter}|${d.partner}|${d.product}|${d.year}|${d.flow}`, d);
  const rows = [...unique.values()];
  for (let i = 0; i < rows.length; i += 5000) await WorldFlow.insertMany(rows.slice(i, i + 5000), { ordered: false });
  return rows.length;
}

main().catch(async (err) => {
  console.error(err);
  await disconnectDb();
  process.exit(1);
});
