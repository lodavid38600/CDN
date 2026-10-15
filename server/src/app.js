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

  app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 50, standardHeaders: true, legacyHeaders: false }), authRoutes);
  app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));
  app.use('/api/meta', requireAuth, metaRoutes);
  app.use('/api/stats', requireAuth, ...(config.env === 'test' ? [] : [statsCache()]), statsRoutes);
  app.use('/api/trade', requireAuth, tradeRoutes);
  app.use('/api/products', requireAuth, productRoutes);
  app.use('/api/nomenclature', requireAuth, nomenclatureRoutes);
  app.use('/api/reports', requireAuth, reportRoutes);
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
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Erreur interne' : err.message });
  });

  return app;
}
