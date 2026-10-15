// Mise à jour complète des données, exécutée par le planificateur (ou à la demande) :
//   1. tables de correspondance NC publiées (téléchargement) ;
//   2. Eurostat : fichiers bulk Comext (nouveaux mois + fichiers révisés) — l'API n'est
//      utilisée qu'en complément optionnel (UPDATE_EUROSTAT_API=true) ;
//   3. sources nationales et UN Comtrade configurées ;
//   4. synchronisation de la nomenclature NC8, puis du jeu mondial (UE, miroirs, SH6) ;
//   5. nouvelle version des données (vide les caches de toutes les instances).
// Chaque étape est isolée : une source indisponible ne bloque jamais les autres.
import { config } from '../config.js';
import { Product } from '../models/Product.js';
import { JobRun } from '../models/System.js';
import { importEurostat, monthRange } from './eurostat.js';
import { syncBulk } from './eurostatBulk.js';
import { downloadCorrespondences, syncNomenclature } from './ncSync.js';
import { syncWorld } from './worldSync.js';
import { bumpDataVersion } from './dataVersion.js';
import { withLock } from './lock.js';
import { updateWorldSources } from '../connectors/index.js';

export async function runUpdate({ steps = ['correspondences', 'eurostat-bulk', 'eurostat', 'world-sources', 'sync'], now = new Date() } = {}) {
  const run = await JobRun.create({ name: 'mise-a-jour' });
  const report = {};
  let failures = 0;
  const step = async (name, fn) => {
    if (!steps.includes(name)) return;
    const t0 = Date.now();
    try {
      report[name] = { ok: true, ms: 0, ...(await fn()) };
    } catch (e) {
      failures += 1;
      report[name] = { ok: false, error: e.message };
    }
    report[name].ms = Date.now() - t0;
  };
  const cfg = config.autoUpdate;
  const to = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const fromDate = new Date(now.getFullYear(), now.getMonth() - cfg.months + 1, 1);
  const months = monthRange(`${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}`, to);

  await step('correspondences', async () => ({ downloads: await downloadCorrespondences(cfg.correspondenceUrls) }));
  // Les fichiers inchangés ne sont ni téléchargés ni retraités : seul un HEAD par mois est envoyé
  await step('eurostat-bulk', async () => (cfg.eurostatBulk ? syncBulk({ to }) : { skipped: true }));
  await step('eurostat', async () => {
    if (!cfg.eurostat) return { skipped: true };
    const products = await Product.distinct('code', { status: { $ne: 'obsolete' } });
    return importEurostat({ products, months });
  });
  await step('world-sources', async () => {
    if (!cfg.worldSources.length) return { skipped: true };
    const hs6 = [...new Set((await Product.distinct('code', { status: { $ne: 'obsolete' } })).map((c) => c.slice(0, 6)))];
    return updateWorldSources({ sources: cfg.worldSources, hs6, periods: months.map((m) => m.replace('-', '')), comtradeKey: cfg.comtradeKey, comtradeReporters: cfg.comtradeReporters });
  });
  await step('sync', async () => ({ nc8: await syncNomenclature({ level: 8 }), world: await syncWorld() }));
  const version = await bumpDataVersion({ lastUpdate: new Date(), lastUpdateStatus: failures ? 'partial' : 'success' });

  run.status = failures === 0 ? 'success' : failures >= Object.keys(report).length ? 'failed' : 'partial';
  run.endedAt = new Date();
  run.report = { ...report, version };
  await run.save();
  return run.toObject();
}

/** Mise à jour sous verrou : jamais deux exécutions simultanées, même sur plusieurs serveurs. */
export function runUpdateLocked(opts) {
  return withLock('mise-a-jour', 6 * 60 * 60 * 1000, () => runUpdate(opts));
}
