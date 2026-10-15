import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { config } from './config.js';
import { requireAuth } from './middleware/auth.js';
import { statsCache } from './middleware/cache.js';
import authRoutes from './routes/auth.js';
import metaRoutes from './routes/meta.js';
import statsRoutes from './routes/stats.js';
import tradeRoutes from './routes/trade.js';
import productRoutes from './routes/products.js';
import nomenclatureRoutes from './routes/nomenclature.js';
import reportRoutes from './routes/reports.js';
import adminRoutes from './routes/admin.js';
import homeRoutes from './routes/home.js';
import companyRoutes from './routes/company.js';
import supportRoutes from './routes/support.js';
import invoiceRoutes from './routes/invoices.js';
import { requireFeature } from './services/access.js';
import { audit } from './services/audit.js';

// Fonctionnalités de l'offre exigées par certaines analyses (le reste demande « explore »)
function analysisFeatures(req, res, next) {
  if (req.query.source === 'world') return requireFeature('world')(req, res, next);
  if (req.path.startsWith('/forecast')) return requireFeature('forecast')(req, res, next);
  if (req.path.startsWith('/prices')) return requireFeature('prices')(req, res, next);
  if (req.path.endsWith('.csv')) return requireFeature('export')(req, res, next);
  return next();
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin.split(','), credentials: false }));
  // Le routeur des rapports accepte des corps plus volumineux (images) : il gère son propre parseur.
  const smallJson = express.json({ limit: '100kb' });
  app.use((req, res, next) => (req.path.startsWith('/api/reports') ? next() : smallJson(req, res, next)));
  if (config.env !== 'test') app.use(morgan('dev'));

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', db: mongoose.connection.readyState === 1 ? 'up' : 'down' });
  });

  // Limite stricte sur les tentatives de connexion et d'inscription uniquement (pas sur la session)
  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 50, standardHeaders: true, legacyHeaders: false });
  app.use(['/api/auth/login', '/api/auth/register'], authLimiter);
  app.use('/api/auth', authRoutes);
  // Par adresse IP : une société entière peut partager la même adresse (réseau d'entreprise)
  app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 1000, standardHeaders: true, legacyHeaders: false }));
  const explore = [requireAuth, requireFeature('explore'), analysisFeatures];
  app.use('/api/home', requireAuth, homeRoutes);
  app.use('/api/company', requireAuth, companyRoutes);
  app.use('/api/support', requireAuth, supportRoutes);
  app.use('/api/invoices', requireAuth, invoiceRoutes);
  app.use('/api/meta', ...explore, metaRoutes);
  app.use('/api/stats', ...explore, ...(config.env === 'test' ? [] : [statsCache()]), statsRoutes);
  app.use('/api/trade', ...explore, tradeRoutes);
  app.use('/api/products', ...explore, productRoutes);
  app.use('/api/nomenclature', ...explore, nomenclatureRoutes);
  app.use('/api/reports', requireAuth, requireFeature('reports'), reportRoutes);
  app.use('/api/admin', requireAuth, adminRoutes);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Route inconnue' }));

  // En production, le client Vue compilé est servi par Express.
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) {
      console.error(err);
      audit(req, { action: 'erreur.serveur', category: 'systeme', level: 'error', message: `Erreur interne sur ${req.method} ${req.originalUrl}`, details: { error: String(err.message).slice(0, 500) } });
    }
    res.status(status).json({ error: status >= 500 ? 'Erreur interne' : err.message });
  });

  return app;
}
