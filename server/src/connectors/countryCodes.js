// Correspondances de codes pays utilisées par les sources étrangères.
import { ALL_COUNTRIES } from '../data/countries.js';

// ISO 3166-1 numérique (UN Comtrade utilise des variantes : France 251, États-Unis 842,
// Suisse 757, Norvège 579, Inde 699, Italie 381).
const ISO_NUMERIC = {
  AT: 40, BE: 56, BG: 100, CY: 196, CZ: 203, DE: 276, DK: 208, EE: 233, ES: 724, FI: 246, FR: 250, GR: 300,
  HR: 191, HU: 348, IE: 372, IT: 380, LT: 440, LU: 442, LV: 428, MT: 470, NL: 528, PL: 616, PT: 620, RO: 642,
  SE: 752, SI: 705, SK: 703, US: 840, CA: 124, MX: 484, BR: 76, AR: 32, CL: 152, CN: 156, JP: 392, KR: 410,
  IN: 356, TW: 490, VN: 704, SG: 702, TH: 764, ID: 360, GB: 826, CH: 756, NO: 578, TR: 792, UA: 804, RS: 688,
  MA: 504, DZ: 12, TN: 788, EG: 818, ZA: 710, NG: 566, SA: 682, AE: 784, IL: 376, AU: 36, NZ: 554,
};
const COMTRADE_OVERRIDES = { FR: 251, US: 842, CH: 757, NO: 579, IN: 699, IT: 381 };

export const M49_BY_ISO = { ...ISO_NUMERIC, ...COMTRADE_OVERRIDES };
export const ISO_BY_M49 = Object.fromEntries([
  ...Object.entries(ISO_NUMERIC).map(([iso, n]) => [n, iso]),
  ...Object.entries(COMTRADE_OVERRIDES).map(([iso, n]) => [n, iso]),
]);

// Noms anglais (US Census Bureau publie des noms, pas des codes ISO).
const EN = {
  AT: ['Austria'], BE: ['Belgium'], BG: ['Bulgaria'], CY: ['Cyprus'], CZ: ['Czech Republic', 'Czechia'], DE: ['Germany'],
  DK: ['Denmark'], EE: ['Estonia'], ES: ['Spain'], FI: ['Finland'], FR: ['France'], GR: ['Greece'], HR: ['Croatia'],
  HU: ['Hungary'], IE: ['Ireland'], IT: ['Italy'], LT: ['Lithuania'], LU: ['Luxembourg'], LV: ['Latvia'], MT: ['Malta'],
  NL: ['Netherlands'], PL: ['Poland'], PT: ['Portugal'], RO: ['Romania'], SE: ['Sweden'], SI: ['Slovenia'], SK: ['Slovakia'],
  US: ['United States'], CA: ['Canada'], MX: ['Mexico'], BR: ['Brazil'], AR: ['Argentina'], CL: ['Chile'], CN: ['China'],
  JP: ['Japan'], KR: ['Korea, South', 'South Korea', 'Korea, Republic of'], IN: ['India'], TW: ['Taiwan'],
  VN: ['Vietnam', 'Viet Nam'], SG: ['Singapore'], TH: ['Thailand'], ID: ['Indonesia'], GB: ['United Kingdom'],
  CH: ['Switzerland'], NO: ['Norway'], TR: ['Turkey', 'Turkiye', 'Türkiye'], UA: ['Ukraine'], RS: ['Serbia'],
  MA: ['Morocco'], DZ: ['Algeria'], TN: ['Tunisia'], EG: ['Egypt'], ZA: ['South Africa'], NG: ['Nigeria'],
  SA: ['Saudi Arabia'], AE: ['United Arab Emirates'], IL: ['Israel'], AU: ['Australia'], NZ: ['New Zealand'],
};
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
const BY_NAME = new Map(Object.entries(EN).flatMap(([iso, names]) => names.map((n) => [norm(n), iso])));
export const isoFromEnglishName = (name) => BY_NAME.get(norm(name)) || null;

export const KNOWN = new Set(ALL_COUNTRIES.map((c) => c.code));
