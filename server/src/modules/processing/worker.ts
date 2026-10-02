import type { FastifyBaseLogger } from 'fastify';
import type { RowDataPacket } from 'mysql2';
import { exec, pool } from '../../db.js';
import { killAllChildren } from '../../lib/ffmpeg.js';
import { DeferJob, FatalJobError, HANDLERS, onJobFailed, type JobContext } from './handlers.js';
import { jobEvents, type JobType, type Lane } from './queue.js';

const CONCURRENCY: Record<Lane, number> = { light: 2, heavy: 1 };
const running: Record<Lane, number> = { light: 0, heavy: 0 };
const controllers = new Map<number, AbortController>();
let stopping = false;
let timer: ReturnType<typeof setInterval> | undefined;
let log: FastifyBaseLogger;

interface JobRow extends RowDataPacket {
  id: number;
  type: JobType;
  lane: Lane;
  video_id: number | null;
  payload: string | Record<string, unknown> | null;
  attempts: number;
  max_attempts: number;
}

async function pick(lane: Lane): Promise<JobRow | null> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<JobRow[]>(
      `SELECT id, type, lane, video_id, payload, attempts, max_attempts FROM jobs
        WHERE status = 'queued' AND lane = ? AND run_after <= UTC_TIMESTAMP()
        ORDER BY priority, id LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [lane],
    );
    const job = rows[0];
    if (!job) {
      await conn.commit();
      return null;
    }
    await conn.query("UPDATE jobs SET status = 'running', locked_at = UTC_TIMESTAMP(), attempts = attempts + 1, progress = 0 WHERE id = ?", [job.id]);
    await conn.commit();
    job.attempts += 1;
    return job;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

async function execute(job: JobRow): Promise<void> {
  const ac = new AbortController();
  controllers.set(job.id, ac);
  let lastWrite = 0;
  const payload = typeof job.payload === 'string' ? (JSON.parse(job.payload) as Record<string, unknown>) : job.payload;
  const ctx: JobContext = {
    job: { id: job.id, type: job.type, video_id: job.video_id, payload, attempts: job.attempts, max_attempts: job.max_attempts },
    signal: ac.signal,
    setProgress: (pct) => {
      const now = Date.now();
      if (now - lastWrite < 2000 && pct < 100) return;
      lastWrite = now;
      void exec('UPDATE jobs SET progress = ? WHERE id = ?', [Math.max(0, Math.min(100, Math.round(pct))), job.id]).catch(() => {});
    },
    log: log.child({ job: job.id, type: job.type, video: job.video_id }),
  };
  const started = Date.now();
  try {
    const handler = HANDLERS[job.type];
    if (!handler) throw new FatalJobError(`tipe job tidak dikenal: ${job.type}`);
    await handler(ctx);
    await exec("UPDATE jobs SET status = 'done', progress = 100, finished_at = UTC_TIMESTAMP(), last_error = NULL WHERE id = ?", [job.id]);
    ctx.log.info({ ms: Date.now() - started }, 'job selesai');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (stopping && ac.signal.aborted) {
      // Shutdown: kembalikan ke antrean tanpa menghitung percobaan.
      await exec("UPDATE jobs SET status = 'queued', attempts = GREATEST(attempts - 1, 0), locked_at = NULL WHERE id = ?", [job.id]);
    } else if (err instanceof DeferJob) {
      await exec("UPDATE jobs SET status = 'queued', attempts = GREATEST(attempts - 1, 0), locked_at = NULL, last_error = ?, run_after = ? WHERE id = ?", [
        message,
        new Date(Date.now() + err.delayMs),
        job.id,
      ]);
      ctx.log.warn({ delayMs: err.delayMs }, message);
    } else if (ac.signal.aborted) {
      await exec("UPDATE jobs SET status = 'cancelled', finished_at = UTC_TIMESTAMP(), last_error = 'dibatalkan admin' WHERE id = ?", [job.id]);
    } else if (err instanceof FatalJobError || job.attempts >= job.max_attempts) {
      await exec("UPDATE jobs SET status = 'failed', finished_at = UTC_TIMESTAMP(), last_error = ? WHERE id = ?", [message.slice(0, 4000), job.id]);
      ctx.log.warn({ err: message }, 'job gagal permanen');
      await onJobFailed(job.type, job.video_id, message).catch(() => {});
    } else {
      const backoffMin = 2 ** job.attempts;
      await exec("UPDATE jobs SET status = 'queued', locked_at = NULL, last_error = ?, run_after = ? WHERE id = ?", [
        message.slice(0, 4000),
        new Date(Date.now() + backoffMin * 60_000),
        job.id,
      ]);
      ctx.log.warn({ err: message, retryInMin: backoffMin }, 'job gagal, dicoba lagi');
    }
  } finally {
    controllers.delete(job.id);
  }
}

async function fill(lane: Lane): Promise<void> {
  while (!stopping && running[lane] < CONCURRENCY[lane]) {
    let job: JobRow | null;
    try {
      job = await pick(lane);
    } catch (err) {
      log.warn({ err }, 'gagal mengambil job');
      return;
    }
    if (!job) return;
    running[lane]++;
    void execute(job).finally(() => {
      running[lane]--;
      void fill(lane);
    });
  }
}

/** Batalkan job yang sedang berjalan (admin). */
export function cancelRunningJob(id: number): boolean {
  const ac = controllers.get(id);
  if (!ac) return false;
  ac.abort();
  return true;
}

export function workerStats() {
  return { running: { ...running }, concurrency: CONCURRENCY };
}

export async function startWorker(logger: FastifyBaseLogger): Promise<void> {
  log = logger;
  // Job "running" sisa proses sebelumnya → antre ulang.
  await exec("UPDATE jobs SET status = 'queued', locked_at = NULL WHERE status = 'running'");
  jobEvents.on('enqueued', (lane: Lane) => void fill(lane));
  timer = setInterval(() => {
    void fill('light');
    void fill('heavy');
  }, 3000);
  timer.unref();
  void fill('light');
  void fill('heavy');
}

export async function stopWorker(): Promise<void> {
  stopping = true;
  if (timer) clearInterval(timer);
  for (const ac of controllers.values()) ac.abort();
  killAllChildren('SIGTERM');
  const deadline = Date.now() + 5000;
  while (controllers.size && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
}
