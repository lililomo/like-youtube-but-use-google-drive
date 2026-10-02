import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { exec, query, queryOne } from '../../db.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { isVideoId } from '../../lib/ids.js';
import { parse } from '../../lib/validate.js';
import { requireAdmin } from '../../plugins/auth.js';
import { audit } from '../audit/service.js';
import { enqueueJob, jobEvents } from './queue.js';
import { cancelRunningJob, workerStats } from './worker.js';

const listQuery = z.object({
  status: z.enum(['queued', 'running', 'done', 'failed', 'cancelled']).optional(),
  type: z.enum(['probe', 'thumbnail', 'media', 'faststart', 'delete_assets', 'yt_import']).optional(),
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const idParams = z.object({ id: z.coerce.number().int().positive() });

export async function jobSummary() {
  const rows = await query<{ status: string; n: number }>('SELECT status, COUNT(*) AS n FROM jobs GROUP BY status');
  const by = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  return { queued: by.queued ?? 0, running: by.running ?? 0, failed: by.failed ?? 0, done: by.done ?? 0, worker: workerStats() };
}

/** Proses ulang: hanya thumbnail, atau semuanya (rendition lama dihapus lalu probe ulang). */
export async function enqueueReprocess(videoId: number, only: 'all' | 'thumbnail' | 'faststart' = 'all'): Promise<void> {
  if (only === 'thumbnail' || only === 'faststart') {
    await enqueueJob(only, { videoId });
    return;
  }
  await enqueueJob('delete_assets', { videoId, payload: { mode: 'renditions' }, priority: 0 });
  await enqueueJob('probe', { videoId, delayMs: 2000 });
}

export async function processingRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/admin/jobs', { preHandler: requireAdmin }, async (req) => {
    const q = parse(listQuery, req.query);
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.status) {
      where.push('j.status = ?');
      params.push(q.status);
    }
    if (q.type) {
      where.push('j.type = ?');
      params.push(q.type);
    }
    if (q.cursor) {
      where.push('j.id < ?');
      params.push(q.cursor);
    }
    const rows = await query<{
      id: number;
      type: string;
      status: string;
      attempts: number;
      max_attempts: number;
      progress: number;
      last_error: string | null;
      run_after: Date;
      locked_at: Date | null;
      finished_at: Date | null;
      created_at: Date;
      video_public_id: string | null;
      video_title: string | null;
    }>(
      `SELECT j.id, j.type, j.status, j.attempts, j.max_attempts, j.progress, j.last_error, j.run_after, j.locked_at, j.finished_at, j.created_at,
              v.public_id AS video_public_id, v.title AS video_title
         FROM jobs j LEFT JOIN videos v ON v.id = j.video_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY (j.status = 'running') DESC, j.id DESC LIMIT ?`,
      [...params, q.limit + 1],
    );
    const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
    const items = rows.slice(0, q.limit).map((r) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      attempts: r.attempts,
      maxAttempts: r.max_attempts,
      progress: r.progress,
      lastError: r.last_error,
      runAfter: iso(r.run_after),
      startedAt: iso(r.locked_at),
      finishedAt: iso(r.finished_at),
      createdAt: iso(r.created_at),
      video: r.video_public_id ? { id: r.video_public_id, title: r.video_title } : null,
    }));
    return { items, nextCursor: rows.length > q.limit ? String(items[items.length - 1]?.id) : null, summary: await jobSummary() };
  });

  app.post('/api/admin/jobs/:id/retry', { preHandler: requireAdmin }, async (req) => {
    const { id } = parse(idParams, req.params);
    const job = await queryOne<{ status: string; lane: 'light' | 'heavy' }>('SELECT status, lane FROM jobs WHERE id = ?', [id]);
    if (!job) throw notFound('Job tidak ditemukan');
    if (job.status === 'running' || job.status === 'queued') throw badRequest('Job masih berjalan/menunggu');
    await exec(
      "UPDATE jobs SET status = 'queued', attempts = 0, progress = 0, last_error = NULL, finished_at = NULL, run_after = UTC_TIMESTAMP() WHERE id = ?",
      [id],
    );
    jobEvents.emit('enqueued', job.lane);
    await audit(req, 'job.retry', { type: 'job', id });
    return { ok: true };
  });

  app.delete('/api/admin/jobs/:id', { preHandler: requireAdmin }, async (req) => {
    const { id } = parse(idParams, req.params);
    const job = await queryOne<{ status: string }>('SELECT status FROM jobs WHERE id = ?', [id]);
    if (!job) throw notFound('Job tidak ditemukan');
    if (job.status === 'running') cancelRunningJob(id);
    else if (job.status === 'queued') await exec("UPDATE jobs SET status = 'cancelled', finished_at = UTC_TIMESTAMP() WHERE id = ?", [id]);
    else await exec('DELETE FROM jobs WHERE id = ?', [id]);
    await audit(req, 'job.cancel', { type: 'job', id }, { status: job.status });
    return { ok: true };
  });

  app.post('/api/admin/videos/:id/reprocess', { preHandler: requireAdmin }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(z.object({ only: z.enum(['all', 'thumbnail', 'faststart']).default('all') }), req.body ?? {});
    if (!isVideoId(id)) throw notFound('Video tidak ditemukan');
    const v = await queryOne<{ id: number }>('SELECT id FROM videos WHERE public_id = ? AND deleted_at IS NULL', [id]);
    if (!v) throw notFound('Video tidak ditemukan');
    await enqueueReprocess(v.id, body.only);
    await audit(req, 'video.reprocess', { type: 'video', id }, body);
    return { ok: true };
  });
}
