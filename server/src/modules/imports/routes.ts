import type { FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { exec, query, queryOne } from '../../db.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { parse } from '../../lib/validate.js';
import { requireAdmin } from '../../plugins/auth.js';
import { audit } from '../audit/service.js';
import { enqueueJob, jobEvents } from '../processing/queue.js';
import { cancelRunningJob } from '../processing/worker.js';
import { settings } from '../settings/service.js';
import { thumbUrls } from '../videos/model.js';
import { canonicalUrl, parseYoutubeId, splitLinks } from './url.js';
import { MAX_HEIGHT, updateYtdlp, ytdlpPath, ytdlpVersion } from './ytdlp.js';

const MAX_PER_BATCH = 100;

interface Row {
  id: number;
  url: string;
  yt_id: string;
  title: string | null;
  channel: string | null;
  duration_sec: number | null;
  phase: string;
  format_note: string | null;
  size_bytes: number | null;
  visibility: 'public' | 'private';
  created_at: Date;
  finished_at: Date | null;
  job_id: number | null;
  job_status: string | null;
  job_progress: number | null;
  job_error: string | null;
  job_attempts: number | null;
  job_max: number | null;
  job_run_after: Date | null;
  v_public_id: string | null;
  v_title: string | null;
  v_status: string | null;
  v_thumb_key: string | null;
  v_deleted: Date | null;
  category_name: string | null;
}

/** Status tampilan: dari job (sumber kebenaran) + tahap yang sedang berjalan. */
function displayStatus(r: Row): string {
  if (r.phase === 'done') return 'done';
  switch (r.job_status) {
    case 'running':
      return r.phase === 'uploading' ? 'uploading' : 'downloading';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'done':
      return 'done';
    default:
      return 'queued';
  }
}

function present(r: Row) {
  const status = displayStatus(r);
  return {
    id: r.id,
    url: r.url,
    ytId: r.yt_id,
    title: r.title,
    channel: r.channel,
    durationSec: r.duration_sec,
    quality: r.format_note,
    sizeBytes: r.size_bytes != null ? Number(r.size_bytes) : null,
    visibility: r.visibility,
    category: r.category_name,
    status,
    progress: status === 'downloading' || status === 'uploading' ? (r.job_progress ?? 0) : status === 'done' ? 100 : 0,
    error: status === 'failed' || (status === 'queued' && r.job_error) ? r.job_error : null,
    attempts: r.job_attempts ?? 0,
    maxAttempts: r.job_max ?? 0,
    retryAt: status === 'queued' && r.job_run_after && r.job_run_after.getTime() > Date.now() ? r.job_run_after.toISOString() : null,
    createdAt: r.created_at.toISOString(),
    finishedAt: r.finished_at?.toISOString() ?? null,
    video:
      r.v_public_id && !r.v_deleted
        ? { id: r.v_public_id, title: r.v_title, status: r.v_status, thumb: thumbUrls({ public_id: r.v_public_id, thumb_key: r.v_thumb_key })?.sd ?? null }
        : null,
  };
}

const SELECT = `SELECT i.id, i.url, i.yt_id, i.title, i.channel, i.duration_sec, i.phase, i.format_note, i.size_bytes, i.visibility,
                       i.created_at, i.finished_at, i.job_id,
                       j.status AS job_status, j.progress AS job_progress, j.last_error AS job_error, j.attempts AS job_attempts,
                       j.max_attempts AS job_max, j.run_after AS job_run_after,
                       v.public_id AS v_public_id, v.title AS v_title, v.status AS v_status, v.thumb_key AS v_thumb_key, v.deleted_at AS v_deleted,
                       c.name AS category_name
                  FROM youtube_imports i
                  LEFT JOIN jobs j ON j.id = i.job_id
                  LEFT JOIN videos v ON v.id = i.video_id
                  LEFT JOIN categories c ON c.id = i.category_id`;

const listQuery = z.object({
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
const addBody = z.object({
  urls: z.string().max(50_000),
  visibility: z.enum(['public', 'private']).optional(),
  categoryId: z.number().int().positive().nullable().optional(),
  /** Impor ulang walau video YouTube yang sama sudah pernah diimpor. */
  force: z.boolean().optional(),
});
const idParams = z.object({ id: z.coerce.number().int().positive() });

async function loadRow(id: number): Promise<Row> {
  const r = await queryOne<Row>(`${SELECT} WHERE i.id = ?`, [id]);
  if (!r) throw notFound('Data impor tidak ditemukan');
  return r;
}

export async function importRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/admin/imports', { preHandler: requireAdmin }, async (req) => {
    const q = parse(listQuery, req.query);
    const rows = await query<Row>(`${SELECT} ${q.cursor ? 'WHERE i.id < ?' : ''} ORDER BY i.id DESC LIMIT ?`, q.cursor ? [q.cursor, q.limit + 1] : [q.limit + 1]);
    const items = rows.slice(0, q.limit).map(present);
    const counts = await query<{ s: string; n: number }>(
      `SELECT CASE WHEN i.phase = 'done' THEN 'done' WHEN j.status IN ('failed','cancelled') THEN j.status
                   WHEN j.status = 'running' THEN 'running' ELSE 'queued' END AS s, COUNT(*) AS n
         FROM youtube_imports i LEFT JOIN jobs j ON j.id = i.job_id GROUP BY s`,
    );
    const summary = Object.fromEntries(['queued', 'running', 'done', 'failed', 'cancelled'].map((k) => [k, Number(counts.find((c) => c.s === k)?.n ?? 0)]));
    return { items, nextCursor: rows.length > q.limit ? String(items.at(-1)!.id) : null, summary, maxHeight: MAX_HEIGHT };
  });

  app.post('/api/admin/imports', { preHandler: requireAdmin }, async (req, reply) => {
    const body = parse(addBody, req.body);
    if (!settings.get('drive.root_folder_id')) throw conflict('Folder Google Drive belum diatur (Studio → Pengaturan → Google Drive)');
    const links = splitLinks(body.urls);
    if (!links.length) throw badRequest('Masukkan minimal satu link YouTube');
    if (links.length > MAX_PER_BATCH) throw badRequest(`Maksimal ${MAX_PER_BATCH} link sekali tambah`);
    if (body.categoryId != null) {
      const cat = await queryOne('SELECT id FROM categories WHERE id = ? AND missing_at IS NULL', [body.categoryId]);
      if (!cat) throw badRequest('Kategori tidak ditemukan');
    }
    const visibility = body.visibility ?? settings.get('upload.default_visibility');
    const skipped: { input: string; reason: string }[] = [];
    const ids: string[] = [];
    for (const input of links) {
      const id = parseYoutubeId(input);
      if (!id) skipped.push({ input, reason: 'Bukan link video YouTube (playlist/channel belum didukung)' });
      else if (ids.includes(id)) skipped.push({ input, reason: 'Ganda di daftar ini' });
      else ids.push(id);
    }
    let added = 0;
    for (const id of ids) {
      if (!body.force) {
        const prev = await queryOne<{ phase: string; job_status: string | null; v_deleted: Date | null; video_id: number | null }>(
          `SELECT i.phase, j.status AS job_status, v.deleted_at AS v_deleted, i.video_id
             FROM youtube_imports i LEFT JOIN jobs j ON j.id = i.job_id LEFT JOIN videos v ON v.id = i.video_id
            WHERE i.yt_id = ? ORDER BY i.id DESC LIMIT 1`,
          [id],
        );
        if (prev && prev.phase !== 'done' && (prev.job_status === 'queued' || prev.job_status === 'running')) {
          skipped.push({ input: id, reason: 'Sudah ada di antrean' });
          continue;
        }
        if (prev && prev.phase === 'done' && prev.video_id && !prev.v_deleted) {
          skipped.push({ input: id, reason: 'Sudah pernah diimpor' });
          continue;
        }
      }
      const res = await exec('INSERT INTO youtube_imports (url, yt_id, visibility, category_id, created_by) VALUES (?, ?, ?, ?, ?)', [
        canonicalUrl(id),
        id,
        visibility,
        body.categoryId ?? null,
        req.viewer.userId,
      ]);
      const jobId = await enqueueJob('yt_import', { payload: { importId: res.insertId } });
      await exec('UPDATE youtube_imports SET job_id = ? WHERE id = ?', [jobId, res.insertId]);
      added++;
    }
    if (added) await audit(req, 'import.add', null, { count: added, visibility, categoryId: body.categoryId ?? null });
    reply.code(added ? 201 : 200);
    return { added, skipped };
  });

  app.post('/api/admin/imports/:id/retry', { preHandler: requireAdmin }, async (req) => {
    const { id } = parse(idParams, req.params);
    const r = await loadRow(id);
    const status = displayStatus(r);
    if (status !== 'failed' && status !== 'cancelled') throw badRequest('Hanya impor yang gagal/dibatalkan yang bisa dicoba lagi');
    await exec("UPDATE youtube_imports SET phase = 'queued' WHERE id = ?", [id]);
    if (r.job_id && r.job_status) {
      await exec(
        "UPDATE jobs SET status = 'queued', attempts = 0, progress = 0, last_error = NULL, finished_at = NULL, run_after = UTC_TIMESTAMP() WHERE id = ?",
        [r.job_id],
      );
      jobEvents.emit('enqueued', 'download');
    } else {
      const jobId = await enqueueJob('yt_import', { payload: { importId: id } });
      await exec('UPDATE youtube_imports SET job_id = ? WHERE id = ?', [jobId, id]);
    }
    await audit(req, 'import.retry', null, { importId: id, yt: r.yt_id });
    return { ok: true };
  });

  /** Batalkan (bila menunggu/berjalan) atau hapus dari daftar (video hasil impor TIDAK dihapus). */
  app.delete('/api/admin/imports/:id', { preHandler: requireAdmin }, async (req) => {
    const { id } = parse(idParams, req.params);
    const r = await loadRow(id);
    const status = displayStatus(r);
    if (status === 'downloading' || status === 'uploading') {
      if (r.job_id) cancelRunningJob(r.job_id);
      await audit(req, 'import.cancel', null, { importId: id, yt: r.yt_id });
      return { ok: true, cancelled: true };
    }
    if (status === 'queued' && r.job_id) {
      await exec("UPDATE jobs SET status = 'cancelled', finished_at = UTC_TIMESTAMP(), last_error = 'dibatalkan admin' WHERE id = ? AND status = 'queued'", [r.job_id]);
      await audit(req, 'import.cancel', null, { importId: id, yt: r.yt_id });
      return { ok: true, cancelled: true };
    }
    await exec('DELETE FROM youtube_imports WHERE id = ?', [id]);
    return { ok: true, removed: true };
  });

  app.get('/api/admin/imports/tool', { preHandler: requireAdmin }, async () => {
    const path = ytdlpPath();
    return { path, installed: existsSync(path), version: await ytdlpVersion() };
  });

  app.post('/api/admin/imports/tool/update', { preHandler: requireAdmin }, async (req) => {
    if (!existsSync(ytdlpPath())) throw conflict('yt-dlp belum terpasang di server');
    let message: string;
    try {
      message = await updateYtdlp();
    } catch (err) {
      throw badRequest(`Gagal memperbarui yt-dlp: ${(err as Error).message.slice(0, 300)}`);
    }
    const version = await ytdlpVersion();
    await audit(req, 'import.tool_update', null, { version });
    return { version, message };
  });
}
