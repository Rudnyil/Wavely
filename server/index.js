import path from 'node:path';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { buildApp } from './app.js';

let config;
try {
  config = loadConfig();
} catch (e) {
  console.error(`Configuration error: ${e.message}`);
  process.exit(1);
}

const db = openDb(path.join(config.dataDir, 'wavely.db'));
const app = await buildApp({ config, db, logger: { level: config.logLevel } });

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'shutting down');
  const force = setTimeout(() => process.exit(1), 10000);
  force.unref();
  try {
    await app.close();
    db.close();
    process.exit(0);
  } catch (e) {
    app.log.error(e);
    process.exit(1);
  }
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`${config.instanceName} is running. Registration: ${config.registration}. Data: ${config.dataDir}`);
} catch (e) {
  app.log.error(e);
  process.exit(1);
}
