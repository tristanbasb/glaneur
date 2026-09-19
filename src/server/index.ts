import { buildApp } from './app.js';
import { applyInitialPassword } from './auth.js';
import { config } from './config.js';
import { browserPath, closeBrowser } from './core/browser.js';
import { startScheduler, stopScheduler } from './core/scheduler.js';
import { db } from './db.js';
import { log } from './util.js';

applyInitialPassword();

const app = await buildApp();
await app.listen({ port: config.port, host: config.host });

const shownHost = config.host === '0.0.0.0' || config.host === '::' ? 'localhost' : config.host;
log.info(`Glaneur ${config.version} à l’écoute sur http://${shownHost}:${config.port}`);
log.info(`Données : ${config.dataDir}`);
const chromium = browserPath();
log.info(chromium ? `Rendu JavaScript : ${chromium}` : 'Rendu JavaScript indisponible (Chromium introuvable)');
if (config.authMode === 'none') log.warn('Authentification désactivée (GLANEUR_AUTH=none) : protégez l’accès autrement.');

startScheduler();

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log.info(`Arrêt (${signal})…`);
  stopScheduler();
  await app.close().catch(() => undefined);
  await closeBrowser();
  db.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
