import { EventEmitter } from 'node:events';
import { exec, queryOne, type Db, pool } from '../../db.js';

export type JobType = 'probe' | 'thumbnail' | 'media' | 'delete_assets';
export type Lane = 'light' | 'heavy';

const DEFAULTS: Record<JobType, { lane: Lane; priority: number; maxAttempts: number }> = {
  probe: { lane: 'light', priority: 1, maxAttempts: 4 },
  thumbnail: { lane: 'light', priority: 2, maxAttempts: 3 },
  media: { lane: 'heavy', priority: 5, maxAttempts: 3 },
  delete_assets: { lane: 'light', priority: 8, maxAttempts: 5 },
};

/** Membangunkan worker saat ada job baru. */
export const jobEvents = new EventEmitter();

export interface EnqueueOptions {
  videoId?: number | null;
  payload?: Record<string, unknown> | null;
  priority?: number;
  /** Lewati bila sudah ada job sejenis (queued/running) untuk video yang sama. Default true. */
  dedupe?: boolean;
  delayMs?: number;
  db?: Db;
}

export async function enqueueJob(type: JobType, opts: EnqueueOptions = {}): Promise<number | null> {
  const d = DEFAULTS[type];
  const db = opts.db ?? pool;
  if ((opts.dedupe ?? true) && opts.videoId != null) {
    const existing = await queryOne<{ id: number }>(
      "SELECT id FROM jobs WHERE type = ? AND video_id = ? AND status IN ('queued','running') LIMIT 1",
      [type, opts.videoId],
      db,
    );
    if (existing) return null;
  }
  const res = await exec(
    'INSERT INTO jobs (type, lane, video_id, payload, priority, max_attempts, run_after) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [
      type,
      d.lane,
      opts.videoId ?? null,
      opts.payload ? JSON.stringify(opts.payload) : null,
      opts.priority ?? d.priority,
      d.maxAttempts,
      new Date(Date.now() + (opts.delayMs ?? 0)),
    ],
    db,
  );
  jobEvents.emit('enqueued', d.lane);
  return res.insertId;
}
