// Codes pays au format Eurostat Comext (ISO 3166-1 alpha-2, sauf Grèce = "GR").

export const EU_COUNTRIES = [
  ['AT', 'Autriche'], ['BE', 'Belgique'], ['BG', 'Bulgarie'], ['CY', 'Chypre'],
  ['CZ', 'Tchéquie'], ['DE', 'Allemagne'], ['DK', 'Danemark'], ['EE', 'Estonie'],
  ['ES', 'Espagne'], ['FI', 'Finlande'], ['FR', 'France'], ['GR', 'Grèce'],
  ['HR', 'Croatie'], ['HU', 'Hongrie'], ['IE', 'Irlande'], ['IT', 'Italie'],
  ['LT', 'Lituanie'], ['LU', 'Luxembourg'], ['LV', 'Lettonie'], ['MT', 'Malte'],
  ['NL', 'Pays-Bas'], ['PL', 'Pologne'], ['PT', 'Portugal'], ['RO', 'Roumanie'],
  ['SE', 'Suède'], ['SI', 'Slovénie'], ['SK', 'Slovaquie'],
].map(([code, name]) => ({ code, name, eu: true, region: 'Union européenne' }));

// Principaux partenaires hors UE (extra-UE).
export const EXTRA_EU_COUNTRIES = [
  ['US', 'États-Unis', 'Amérique du Nord'], ['CA', 'Canada', 'Amérique du Nord'],
  ['MX', 'Mexique', 'Amérique latine'], ['BR', 'Brésil', 'Amérique latine'],
  ['AR', 'Argentine', 'Amérique latine'], ['CL', 'Chili', 'Amérique latine'],
  ['CN', 'Chine', 'Asie'], ['JP', 'Japon', 'Asie'], ['KR', 'Corée du Sud', 'Asie'],
  ['IN', 'Inde', 'Asie'], ['TW', 'Taïwan', 'Asie'], ['VN', 'Viêt Nam', 'Asie'],
  ['SG', 'Singapour', 'Asie'], ['TH', 'Thaïlande', 'Asie'], ['ID', 'Indonésie', 'Asie'],
  ['GB', 'Royaume-Uni', 'Europe hors UE'], ['CH', 'Suisse', 'Europe hors UE'],
  ['NO', 'Norvège', 'Europe hors UE'], ['TR', 'Turquie', 'Europe hors UE'],
  ['UA', 'Ukraine', 'Europe hors UE'], ['RS', 'Serbie', 'Europe hors UE'],
  ['MA', 'Maroc', 'Afrique'], ['DZ', 'Algérie', 'Afrique'], ['TN', 'Tunisie', 'Afrique'],
  ['EG', 'Égypte', 'Afrique'], ['ZA', 'Afrique du Sud', 'Afrique'], ['NG', 'Nigeria', 'Afrique'],
  ['SA', 'Arabie saoudite', 'Moyen-Orient'], ['AE', 'Émirats arabes unis', 'Moyen-Orient'],
  ['IL', 'Israël', 'Moyen-Orient'], ['AU', 'Australie', 'Océanie'], ['NZ', 'Nouvelle-Zélande', 'Océanie'],
].map(([code, name, region]) => ({ code, name, eu: false, region }));

export const ALL_COUNTRIES = [...EU_COUNTRIES, ...EXTRA_EU_COUNTRIES];

export const EU_CODES = new Set(EU_COUNTRIES.map((c) => c.code));
