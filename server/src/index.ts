import { buildApp } from './app.js';
import { config } from './config.js';
import { closeDb } from './db.js';
import { startMaintenance } from './modules/maintenance/tasks.js';
import { startSyncScheduler, stopSyncScheduler } from './modules/sync/service.js';
import { startWorker, stopWorker } from './modules/processing/worker.js';
import { flushViews, startViewFlusher } from './modules/videos/public.js';

const app = await buildApp();

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'menghentikan aplikasi');
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  try {
    stopSyncScheduler();
    await stopWorker();
    await flushViews();
    await app.close();
    await closeDb();
  } finally {
    process.exit(0);
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => app.log.error({ reason }, 'unhandledRejection'));
process.on('uncaughtException', (err) => {
  app.log.fatal({ err }, 'uncaughtException');
  process.exit(1);
});

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (err) {
  app.log.fatal({ err }, 'gagal listen');
  process.exit(1);
}

startViewFlusher();
if (!config.DISABLE_WORKER) {
  await startWorker(app.log.child({ mod: 'worker' }));
}
if (!config.DISABLE_SCHEDULER) {
  startSyncScheduler(app.log.child({ mod: 'sync' }));
  startMaintenance(app.log.child({ mod: 'maintenance' }));
}
