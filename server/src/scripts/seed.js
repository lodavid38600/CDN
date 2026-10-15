// Génère un jeu de données de démonstration réaliste (codes NC réels, montants simulés)
// et un compte de démonstration. Les données Eurostat réelles s'importent via import:eurostat.
//
//   npm run seed                 (remplace les données de démo)
//   npm run seed -- --years 2015-2024

import { parseArgs } from 'node:util';
import { connectDb, disconnectDb } from '../db.js';
import { EU_COUNTRIES, EXTRA_EU_COUNTRIES } from '../data/countries.js';
import { sectionOfChapter } from '../data/nomenclature.js';
import { DEMO_PRODUCTS } from '../data/demoProducts.js';
import { Product } from '../models/Product.js';
import { TradeFlow } from '../models/TradeFlow.js';
import { User } from '../models/User.js';

const { values: args } = parseArgs({ options: { years: { type: 'string', default: '2015-2024' } } });
const [fromYear, toYear] = args.years.split('-').map(Number);

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
  '18010000': ['NL', 'BE', 'DE', 'FR'], '08030019': ['BE', 'NL', 'DE', 'IT'], '85171300': ['NL', 'DE', 'FR', 'IT'],
};

// Chocs macro-économiques simplifiés (indice du commerce par année).
const MACRO = { 2015: 0.86, 2016: 0.87, 2017: 0.92, 2018: 0.96, 2019: 0.97, 2020: 0.87, 2021: 1.0, 2022: 1.16, 2023: 1.08, 2024: 1.06, 2025: 1.08 };

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

  const products = DEMO_PRODUCTS.map(([code, description]) => ({
    code, description, chapter: code.slice(0, 2), heading: code.slice(0, 4), section: sectionOfChapter(code.slice(0, 2)),
  }));
  await Product.bulkWrite(products.map((p) => ({ updateOne: { filter: { code: p.code }, update: { $set: p }, upsert: true } })));
  await TradeFlow.deleteMany({ source: 'demo' });

  const docs = [];
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
          for (const flow of ['import', 'export']) {
            const flowShare = flow === 'export' ? exportShare : 1 - exportShare;
            const noise = 0.85 + rand() * 0.3;
            const valueEur = Math.round(baseM * 0.6e6 * share * flowShare * bias * yf * noise);
            if (valueEur < 1000) continue; // secret statistique / valeurs négligeables
            const price = pricePerKg * (0.9 + rand() * 0.2) * (MACRO[year] ?? 1);
            docs.push({
              reporter: r.code, partner: p.code, product: code, chapter, section, year, flow,
              valueEur, quantityKg: Math.round(valueEur / price), source: 'demo',
            });
          }
        }
      }
    }
  }

  for (let i = 0; i < docs.length; i += 5000) {
    await TradeFlow.insertMany(docs.slice(i, i + 5000), { ordered: false });
  }

  const email = 'demo@douane-saas.eu';
  let demo = await User.findOne({ email });
  if (!demo) demo = new User({ email, name: 'Compte démo', company: 'Démo SAS', plan: 'pro' });
  await demo.setPassword('demo12345');
  await demo.save();

  console.log(`✔ ${products.length} codes NC, ${docs.length} flux (${fromYear}-${toYear})`);
  console.log(`✔ Compte démo : ${email} / demo12345`);
  await disconnectDb();
}

main().catch(async (err) => {
  console.error(err);
  await disconnectDb();
  process.exit(1);
});
