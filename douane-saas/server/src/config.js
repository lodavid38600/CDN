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
  // Limites d'export CSV par offre.
  exportLimits: { free: 1000, pro: 100000 },
};
