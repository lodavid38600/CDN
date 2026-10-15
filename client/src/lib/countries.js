// Codes ISO 3166-1 numériques (identifiants de la carte world-atlas) des pays couverts.
export const ISO_NUMERIC = {
  AT: '040', BE: '056', BG: '100', CY: '196', CZ: '203', DE: '276', DK: '208', EE: '233', ES: '724', FI: '246',
  FR: '250', GR: '300', HR: '191', HU: '348', IE: '372', IT: '380', LT: '440', LU: '442', LV: '428', MT: '470',
  NL: '528', PL: '616', PT: '620', RO: '642', SE: '752', SI: '705', SK: '703',
  US: '840', CA: '124', MX: '484', BR: '076', AR: '032', CL: '152', CN: '156', JP: '392', KR: '410', IN: '356',
  TW: '158', VN: '704', SG: '702', TH: '764', ID: '360', GB: '826', CH: '756', NO: '578', TR: '792', UA: '804',
  RS: '688', MA: '504', DZ: '012', TN: '788', EG: '818', ZA: '710', NG: '566', SA: '682', AE: '784', IL: '376',
  AU: '036', NZ: '554',
};
export const ALPHA2_BY_NUMERIC = Object.fromEntries(Object.entries(ISO_NUMERIC).map(([a, n]) => [n, a]));

// Noms avec article, pour les phrases (« la France », « les États-Unis », « l'Allemagne »).
const ARTICLES = {
  AT: "l'Autriche", BE: 'la Belgique', BG: 'la Bulgarie', CY: 'Chypre', CZ: 'la Tchéquie', DE: "l'Allemagne", DK: 'le Danemark',
  EE: "l'Estonie", ES: "l'Espagne", FI: 'la Finlande', FR: 'la France', GR: 'la Grèce', HR: 'la Croatie', HU: 'la Hongrie',
  IE: "l'Irlande", IT: "l'Italie", LT: 'la Lituanie', LU: 'le Luxembourg', LV: 'la Lettonie', MT: 'Malte', NL: 'les Pays-Bas',
  PL: 'la Pologne', PT: 'le Portugal', RO: 'la Roumanie', SE: 'la Suède', SI: 'la Slovénie', SK: 'la Slovaquie',
  US: 'les États-Unis', CA: 'le Canada', MX: 'le Mexique', BR: 'le Brésil', AR: "l'Argentine", CL: 'le Chili', CN: 'la Chine',
  JP: 'le Japon', KR: 'la Corée du Sud', IN: "l'Inde", TW: 'Taïwan', VN: 'le Viêt Nam', SG: 'Singapour', TH: 'la Thaïlande',
  ID: "l'Indonésie", GB: 'le Royaume-Uni', CH: 'la Suisse', NO: 'la Norvège', TR: 'la Turquie', UA: "l'Ukraine", RS: 'la Serbie',
  MA: 'le Maroc', DZ: "l'Algérie", TN: 'la Tunisie', EG: "l'Égypte", ZA: "l'Afrique du Sud", NG: 'le Nigeria',
  SA: "l'Arabie saoudite", AE: 'les Émirats arabes unis', IL: 'Israël', AU: "l'Australie", NZ: 'la Nouvelle-Zélande',
};
export const withArticle = (code, fallback = code) => ARTICLES[code] || fallback;
/** « vers la France », « vers les États-Unis », « vers Israël » ; idem pour « depuis ». */
export const toward = (prep, code, fallback) => `${prep} ${withArticle(code, fallback)}`;
