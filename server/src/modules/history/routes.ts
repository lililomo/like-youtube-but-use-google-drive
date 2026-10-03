import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { exec, query, queryOne } from '../../db.js';
import { isVideoId } from '../../lib/ids.js';
import { parse } from '../../lib/validate.js';
import { canWatch } from '../../plugins/access.js';
import { ensureGuestId, requireUser } from '../../plugins/auth.js';
import { VIDEO_SELECT, toSummary, type VideoRecord } from '../videos/model.js';

const PAGE = 30;
const MAX_OFFSET = 1000;

const progressBody = z.object({
  videoId: z.string().refine(isVideoId, 'ID video tidak valid'),
  positionSec: z.number().min(0).max(1e7),
  durationSec: z.number().min(0).max(1e7),
  /** Awal pemutaran (bukan simpan berkala) → jumlah putar bertambah (sinyal rekomendasi "ditonton berulang"). */
  start: z.boolean().optional(),
});

type HistoryRow = VideoRecord & { position_sec: number; duration_sec: number; watched_at: Date };

/**
 * Progres & histori tonton (SPEC §17). Halaman Histori hanya untuk user login (tamu: localStorage), progres tamu
 * disimpan di server hanya sebagai sinyal rekomendasi. Histori hanya menampilkan video yang masih boleh ditonton viewer.
 */
export async function historyRoutes(app: FastifyInstance): Promise<void> {
  // Dipanggil tiap 15 dtk saat bermain, saat jeda, dan saat pagehide (fetch keepalive).
  // Tamu: disimpan per dv_gid di guest_watch — hanya untuk rekomendasi (Histori tamu tetap dari perangkat).
  app.post('/api/progress', async (req, reply) => {
    const body = parse(progressBody, req.body);
    const v = await queryOne<VideoRecord>(`${VIDEO_SELECT} WHERE v.public_id = ?`, [body.videoId]);
    if (!v || !canWatch(v, req.viewer)) return reply.code(204).send();
    const duration = Math.round(body.durationSec || (v.duration_ms ?? 0) / 1000);
    // Posisi disimpan apa adanya (bar merah thumbnail); aturan resume (> 30 dtk & < durasi − 15) di klien.
    const pos = Math.min(Math.floor(body.positionSec), duration || Number.MAX_SAFE_INTEGER);
    const userId = req.viewer.userId;
    const [table, ownerCol, owner] = userId ? ['watch_history', 'user_id', userId] : ['guest_watch', 'guest_hash', ensureGuestId(req, reply)];
    await exec(
      `INSERT INTO ${table} (${ownerCol}, video_id, position_sec, max_position_sec, duration_sec, plays, first_watched_at, watched_at)
       VALUES (?, ?, ?, ?, ?, 1, UTC_TIMESTAMP(), UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE position_sec = VALUES(position_sec), max_position_sec = GREATEST(max_position_sec, VALUES(position_sec)),
         duration_sec = VALUES(duration_sec), plays = plays + ?, watched_at = VALUES(watched_at)`,
      [owner, v.id, pos, pos, duration, body.start ? 1 : 0],
    );
    return reply.code(204).send();
  });

  app.get('/api/progress', { preHandler: requireUser }, async (req) => {
    const q = parse(z.object({ ids: z.string().max(12 * 100) }), req.query);
    const ids = q.ids.split(',').filter(isVideoId).slice(0, 100);
    if (!ids.length) return { items: {} };
    const rows = await query<{ public_id: string; position_sec: number }>(
      `SELECT v.public_id, wh.position_sec FROM watch_history wh JOIN videos v ON v.id = wh.video_id
        WHERE wh.user_id = ? AND v.public_id IN (?)`,
      [req.viewer.userId, ids],
    );
    return { items: Object.fromEntries(rows.map((r) => [r.public_id, r.position_sec])) };
  });

  app.get('/api/history', { preHandler: requireUser }, async (req, reply) => {
    const q = parse(z.object({ cursor: z.coerce.number().int().min(0).max(MAX_OFFSET).optional() }), req.query);
    const offset = q.cursor ?? 0;
    const sql = VIDEO_SELECT.replace('FROM videos v', ', wh.position_sec, wh.duration_sec, wh.watched_at FROM watch_history wh JOIN videos v ON v.id = wh.video_id');
    const rows = await query<HistoryRow>(`${sql} WHERE wh.user_id = ? ORDER BY wh.watched_at DESC, wh.video_id DESC LIMIT ? OFFSET ?`, [
      req.viewer.userId,
      PAGE + 1,
      offset,
    ]);
    reply.header('Cache-Control', 'private, no-store');
    const items = rows
      .slice(0, PAGE)
      .filter((r) => canWatch(r, req.viewer))
      .map((r) => ({
        ...toSummary(r, req.viewer),
        progressSec: r.position_sec,
        watchedAt: new Date(r.watched_at).toISOString(),
      }));
    return { items, nextCursor: rows.length > PAGE && offset + PAGE <= MAX_OFFSET ? String(offset + PAGE) : null };
  });

  app.delete('/api/history', { preHandler: requireUser }, async (req) => {
    const res = await exec('DELETE FROM watch_history WHERE user_id = ?', [req.viewer.userId]);
    return { ok: true, removed: res.affectedRows };
  });

  app.delete<{ Params: { videoId: string } }>('/api/history/:videoId', { preHandler: requireUser }, async (req) => {
    if (!isVideoId(req.params.videoId)) return { ok: true };
    await exec('DELETE wh FROM watch_history wh JOIN videos v ON v.id = wh.video_id WHERE wh.user_id = ? AND v.public_id = ?', [
      req.viewer.userId,
      req.params.videoId,
    ]);
    return { ok: true };
  });
}
