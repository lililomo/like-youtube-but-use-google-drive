import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import { config } from '../../config.js';
import { exec } from '../../db.js';

/** Pembersihan berkala (SPEC §8.5): sesi kedaluwarsa, oauth state, upload kedaluwarsa, file tmp lama. */
async function hourly(log: FastifyBaseLogger): Promise<void> {
  try {
    await exec('DELETE FROM sessions WHERE expires_at < UTC_TIMESTAMP()');
    await exec('DELETE FROM oauth_states WHERE expires_at < UTC_TIMESTAMP()');
    await exec("UPDATE uploads SET status = 'expired' WHERE status = 'uploading' AND expires_at < UTC_TIMESTAMP()");
    await exec("DELETE FROM jobs WHERE status IN ('done','cancelled') AND finished_at < UTC_TIMESTAMP() - INTERVAL 14 DAY");
  } catch (err) {
    log.warn({ err }, 'pembersihan DB gagal');
  }
}

async function cleanTmp(log: FastifyBaseLogger): Promise<void> {
  const dir = join(config.STORAGE_DIR, 'tmp');
  try {
    for (const name of await readdir(dir)) {
      const p = join(dir, name);
      const s = await stat(p);
      if (Date.now() - s.mtimeMs > 24 * 3600 * 1000) await rm(p, { recursive: true, force: true });
    }
  } catch (err) {
    log.warn({ err }, 'pembersihan tmp gagal');
  }
}

export function startMaintenance(log: FastifyBaseLogger): void {
  setTimeout(() => void hourly(log), 30_000).unref();
  setInterval(() => void hourly(log), 3600_000).unref();
  setInterval(() => void cleanTmp(log), 6 * 3600_000).unref();
}
