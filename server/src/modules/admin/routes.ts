import { memoryUsage, uptime, version as nodeVersion } from 'node:process';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { APP_VERSION, config } from '../../config.js';
import { query, queryOne } from '../../db.js';
import { diskInfo } from '../../lib/disk.js';
import { run } from '../../lib/ffmpeg.js';
import { isVideoId } from '../../lib/ids.js';
import { parse } from '../../lib/validate.js';
import { requireAdmin } from '../../plugins/auth.js';
import { audit } from '../audit/service.js';
import { driveStatus } from '../drive/service.js';
import { summarizePlaylists, type PlaylistRow } from '../playlists/routes.js';
import { enqueueReprocess } from '../processing/routes.js';
import { settings } from '../settings/service.js';
import { syncState } from '../sync/service.js';
import { deleteVideo, patchVideo, studioRows } from '../videos/manage.js';
import { VIDEO_SELECT, toSummary, type VideoRecord } from '../videos/model.js';
import { escapeLike } from '../videos/search.js';

const PAGE = 50;
let ffmpegVersion: string | null = null;

const videosQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['ready', 'processing', 'failed', 'missing']).optional(),
  visibility: z.enum(['public', 'private']).optional(),
  owner: z.union([z.literal('main'), z.coerce.number().int().positive()]).optional(),
  category: z.coerce.number().int().positive().optional(),
  sort: z.enum(['latest', 'oldest', 'views', 'size']).default('latest'),
  cursor: z.coerce.number().int().min(0).max(1_000_000).optional(),
});

const bulkBody = z.object({
  ids: z.array(z.string().refine(isVideoId)).min(1).max(200),
  action: z.enum(['public', 'private', 'reprocess', 'delete']),
});

const playlistsQuery = z.object({
  q: z.string().trim().max(100).optional(),
  visibility: z.enum(['public', 'private']).optional(),
  kind: z.enum(['user', 'guest']).optional(),
  cursor: z.coerce.number().int().min(0).max(1_000_000).optional(),
});

const ORDER: Record<z.infer<typeof videosQuery>['sort'], string> = {
  latest: 'v.published_at DESC, v.id DESC',
  oldest: 'v.published_at ASC, v.id ASC',
  views: 'v.view_count DESC, v.id DESC',
  size: 'v.size_bytes DESC, v.id DESC',
};

/** Panel admin (SPEC §18): dasbor, sistem, video & playlist semua pengguna. */
export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/admin/stats', { preHandler: requireAdmin }, async (req) => {
    const [vids, size, users, pls, jobs, running, top, recent] = await Promise.all([
      query<{ status: string; visibility: string; n: number }>(
        'SELECT status, visibility, COUNT(*) AS n FROM videos WHERE deleted_at IS NULL GROUP BY status, visibility',
      ),
      queryOne<{ total: number }>('SELECT COALESCE(SUM(size_bytes), 0) AS total FROM videos WHERE deleted_at IS NULL'),
      query<{ status: string; n: number }>('SELECT status, COUNT(*) AS n FROM users GROUP BY status'),
      queryOne<{ total: number; pub: number; guest: number }>(
        "SELECT COUNT(*) AS total, SUM(visibility = 'public') AS pub, SUM(owner_user_id IS NULL) AS guest FROM playlists",
      ),
      query<{ status: string; n: number }>("SELECT status, COUNT(*) AS n FROM jobs WHERE status IN ('queued','running','failed') GROUP BY status"),
      query<{ id: number; type: string; progress: number; started_at: Date | null; public_id: string | null; title: string | null }>(
        `SELECT j.id, j.type, j.progress, j.locked_at AS started_at, v.public_id, v.title FROM jobs j LEFT JOIN videos v ON v.id = j.video_id
          WHERE j.status = 'running' ORDER BY j.locked_at`,
      ),
      query<VideoRecord>(`${VIDEO_SELECT} WHERE v.deleted_at IS NULL ORDER BY v.view_count DESC, v.id DESC LIMIT 5`),
      query<VideoRecord>(`${VIDEO_SELECT} WHERE v.deleted_at IS NULL AND v.source = 'upload' ORDER BY v.published_at DESC, v.id DESC LIMIT 5`),
    ]);
    const count = (pred: (r: { status: string; visibility: string }) => boolean) => vids.filter(pred).reduce((a, r) => a + Number(r.n), 0);
    const jobCount = (s: string) => Number(jobs.find((j) => j.status === s)?.n ?? 0);
    const drive = driveStatus();
    return {
      videos: {
        total: count(() => true),
        public: count((r) => r.visibility === 'public' && r.status !== 'missing'),
        private: count((r) => r.visibility === 'private' && r.status !== 'missing'),
        processing: count((r) => r.status === 'pending' || r.status === 'processing'),
        failed: count((r) => r.status === 'failed'),
        missing: count((r) => r.status === 'missing'),
        totalBytes: Number(size?.total ?? 0),
      },
      users: {
        total: users.reduce((a, u) => a + Number(u.n), 0),
        active: Number(users.find((u) => u.status === 'active')?.n ?? 0),
      },
      playlists: { total: Number(pls?.total ?? 0), public: Number(pls?.pub ?? 0), guest: Number(pls?.guest ?? 0) },
      drive: {
        configured: drive.configured,
        connectedEmail: drive.connectedEmail,
        folder: drive.folder,
        lastSyncAt: drive.lastSyncAt,
        lastFullSyncAt: drive.lastFullSyncAt,
        lastSyncError: drive.lastSyncError,
        syncing: syncState.running,
      },
      queue: {
        queued: jobCount('queued'),
        running: jobCount('running'),
        failed: jobCount('failed'),
        active: running.map((j) => ({
          id: j.id,
          type: j.type,
          progress: Number(j.progress),
          startedAt: j.started_at ? new Date(j.started_at).toISOString() : null,
          video: j.public_id ? { id: j.public_id, title: j.title } : null,
        })),
      },
      topVideos: top.map((v) => toSummary(v, req.viewer)),
      recentUploads: recent.map((v) => ({ ...toSummary(v, req.viewer), status: v.status })),
    };
  });

  app.get('/api/admin/system', { preHandler: requireAdmin }, async () => {
    if (ffmpegVersion === null) {
      try {
        const r = await run(config.FFMPEG_PATH, ['-hide_banner', '-version'], { timeoutMs: 5000 });
        ffmpegVersion = /ffmpeg version (\S+)/.exec(String(r.stdout))?.[1] ?? 'tidak diketahui';
      } catch {
        ffmpegVersion = 'tidak tersedia';
      }
    }
    let disk: { free: number; total: number } | null = null;
    try {
      disk = await diskInfo(config.STORAGE_DIR);
    } catch {
      disk = null;
    }
    const mem = memoryUsage();
    return {
      appVersion: APP_VERSION,
      node: nodeVersion,
      ffmpeg: ffmpegVersion,
      uptimeSec: Math.round(uptime()),
      memory: { rss: mem.rss, heapUsed: mem.heapUsed },
      disk,
      minFreeDiskGb: settings.get('processing.min_free_disk_gb'),
    };
  });

  /** Semua video (termasuk privat milik siapa pun & yang hilang dari Drive). */
  app.get('/api/admin/videos', { preHandler: requireAdmin }, async (req, reply) => {
    const q = parse(videosQuery, req.query);
    const where: string[] = ['(v.deleted_at IS NULL OR v.status = \'missing\')'];
    const params: unknown[] = [];
    if (q.q) {
      where.push('(v.search_text LIKE ? OR v.public_id = ?)');
      params.push(`%${escapeLike(q.q.toLowerCase())}%`, q.q);
    }
    if (q.status === 'processing') where.push("v.status IN ('pending','processing')");
    else if (q.status) {
      where.push('v.status = ?');
      params.push(q.status);
    }
    if (q.status !== 'missing') where.push('v.deleted_at IS NULL');
    if (q.visibility) {
      where.push('v.visibility = ?');
      params.push(q.visibility);
    }
    if (q.owner === 'main') where.push('v.owner_user_id IS NULL');
    else if (q.owner) {
      where.push('v.owner_user_id = ?');
      params.push(q.owner);
    }
    if (q.category) {
      where.push('v.category_id = ?');
      params.push(q.category);
    }
    const offset = q.cursor ?? 0;
    const rows = await query<VideoRecord>(`${VIDEO_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${ORDER[q.sort]} LIMIT ? OFFSET ?`, [
      ...params,
      PAGE + 1,
      offset,
    ]);
    const total = await queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM videos v WHERE ${where.join(' AND ')}`, params);
    reply.header('Cache-Control', 'private, no-store');
    const items = await studioRows(rows.slice(0, PAGE), req.viewer);
    return {
      items: items.map((it, i) => ({ ...it, owner: rows[i]!.owner_username ? { id: rows[i]!.owner_user_id, username: rows[i]!.owner_username, name: rows[i]!.owner_name } : null })),
      total: Number(total?.n ?? 0),
      nextCursor: rows.length > PAGE ? String(offset + PAGE) : null,
    };
  });

  /** Aksi massal: visibilitas, proses ulang, hapus. Setiap video diproses terpisah (gagal satu tidak membatalkan lainnya). */
  app.post('/api/admin/videos/bulk', { preHandler: requireAdmin }, async (req) => {
    const body = parse(bulkBody, req.body);
    const failed: { id: string; error: string }[] = [];
    let done = 0;
    for (const id of body.ids) {
      try {
        if (body.action === 'public' || body.action === 'private') await patchVideo(req, id, { visibility: body.action });
        else if (body.action === 'delete') await deleteVideo(req, id);
        else {
          const v = await queryOne<{ id: number }>('SELECT id FROM videos WHERE public_id = ? AND deleted_at IS NULL', [id]);
          if (!v) throw new Error('Video tidak ditemukan');
          await enqueueReprocess(v.id);
        }
        done++;
      } catch (err) {
        failed.push({ id, error: err instanceof Error ? err.message : String(err) });
      }
    }
    await audit(req, 'video.bulk', null, { action: body.action, count: body.ids.length, done, failed: failed.length });
    return { ok: failed.length === 0, done, failed };
  });

  app.get('/api/admin/playlists', { preHandler: requireAdmin }, async (req, reply) => {
    const q = parse(playlistsQuery, req.query);
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.q) {
      where.push('p.title LIKE ?');
      params.push(`%${escapeLike(q.q)}%`);
    }
    if (q.visibility) {
      where.push('p.visibility = ?');
      params.push(q.visibility);
    }
    if (q.kind === 'guest') where.push('p.owner_user_id IS NULL');
    else if (q.kind === 'user') where.push('p.owner_user_id IS NOT NULL');
    const offset = q.cursor ?? 0;
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await query<PlaylistRow>(
      `SELECT p.id, p.public_id, p.title, p.owner_user_id, p.guest_hash, p.visibility, p.item_count, p.created_at, p.updated_at,
              u.username AS owner_username, u.display_name AS owner_name
         FROM playlists p LEFT JOIN users u ON u.id = p.owner_user_id ${w}
        ORDER BY p.updated_at DESC LIMIT ? OFFSET ?`,
      [...params, PAGE + 1, offset],
    );
    const total = await queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM playlists p ${w}`, params);
    reply.header('Cache-Control', 'private, no-store');
    const items = await summarizePlaylists(rows.slice(0, PAGE), req.viewer);
    return {
      items: items.map((p, i) => ({ ...p, createdAt: new Date(rows[i]!.created_at).toISOString() })),
      total: Number(total?.n ?? 0),
      nextCursor: rows.length > PAGE ? String(offset + PAGE) : null,
    };
  });
}
