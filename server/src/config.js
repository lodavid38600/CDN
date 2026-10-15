import 'dotenv/config';

const env = process.env.NODE_ENV || 'development';

if (env === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET doit être défini en production');
}

export const config = {
  env,
  port: Number(process.env.PORT) || 4000,
  mongoUrl: process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/douane_saas',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-a-changer',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  eurostatBaseUrl:
    process.env.EUROSTAT_BASE_URL ||
    'https://ec.europa.eu/eurostat/api/comext/dissemination/statistics/1.0/data',
  eurostatDataset: process.env.EUROSTAT_DATASET || 'DS-045409',
  // Fichiers « bulk » Eurostat (Comext) : source principale de la base de données
  bulk: {
    // {name} est remplacé par le nom du fichier
    fileUrl: process.env.EUROSTAT_BULK_FILE_URL || 'https://ec.europa.eu/eurostat/api/dissemination/files/?file=comext%2FCOMEXT_DATA%2FPRODUCTS%2F{name}',
    // Noms essayés pour chaque mois, dans l'ordre ({YYYYMM} = période)
    patterns: (process.env.EUROSTAT_BULK_PATTERNS || 'full_v2_{YYYYMM}.7z,full{YYYYMM}.7z').split(',').map((s) => s.trim()),
    from: process.env.EUROSTAT_BULK_FROM || '2015-01',
    dir: process.env.EUROSTAT_BULK_DIR || 'data/bulk',
    keepFiles: process.env.EUROSTAT_BULK_KEEP === 'true',
    labelsUrl: process.env.EUROSTAT_CN_LABELS_URL || '',
  },
  // Mise à jour automatique (désactivée par défaut, voir README)
  autoUpdate: {
    enabled: process.env.AUTO_UPDATE === 'true',
    intervalHours: Number(process.env.UPDATE_INTERVAL_HOURS) || 24,
    months: Number(process.env.UPDATE_MONTHS) || 24, // fenêtre ré-importée (les révisions sont prises en compte)
    eurostatBulk: process.env.UPDATE_EUROSTAT_BULK !== 'false',
    // L'API Eurostat n'est qu'un secours (quotas) : désactivée par défaut
    eurostat: process.env.UPDATE_EUROSTAT_API === 'true',
    worldSources: (process.env.WORLD_SOURCES || '').split(',').map((s) => s.trim()).filter(Boolean),
    comtradeKey: process.env.COMTRADE_API_KEY || '',
    comtradeReporters: (process.env.COMTRADE_REPORTERS || 'CN,JP,KR,IN,BR,CA,AU,TR,MX,ZA,CH').split(',').map((s) => s.trim()).filter(Boolean),
    correspondenceUrls: (process.env.NC_CORRESPONDENCE_URLS || '').split(',').map((s) => s.trim()).filter(Boolean),
  },
  // Inscription en libre-service (sinon, comptes créés par l'équipe commerciale)
  signupEnabled: process.env.SIGNUP_ENABLED !== 'false',
};
