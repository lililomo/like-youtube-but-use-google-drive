import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { exec, query, queryOne, tx } from '../../db.js';
import { AppError, badRequest, forbidden, notFound, tooMany } from '../../lib/errors.js';
import { isPlaylistId, isVideoId, newPlaylistId } from '../../lib/ids.js';
import { AttemptLimiter } from '../../lib/limiter.js';
import { parse } from '../../lib/validate.js';
import { canEditPlaylist, canViewPlaylist, canWatch, listableSql, type Viewer } from '../../plugins/access.js';
import { ensureGuestId, requireUser } from '../../plugins/auth.js';
import { audit } from '../audit/service.js';
import { settings } from '../settings/service.js';
import { VIDEO_SELECT, thumbUrls, toSummary, type VideoRecord } from '../videos/model.js';

/** Batas (SPEC §12). */
export const LIMITS = {
  guest: { playlists: 50, items: 500 },
  user: { playlists: 200, items: 5000 },
};
const createLimiter = new AttemptLimiter(30, 3600_000);
const PAGE = 24;

export interface PlaylistRow {
  id: number;
  public_id: string;
  title: string;
  owner_user_id: number | null;
  guest_hash: string | null;
  visibility: 'public' | 'private';
  item_count: number;
  created_at: Date;
  updated_at: Date;
  owner_username?: string | null;
  owner_name?: string | null;
}

const PL_SELECT = `
  SELECT p.id, p.public_id, p.title, p.owner_user_id, p.guest_hash, p.visibility, p.item_count, p.created_at, p.updated_at,
         u.username AS owner_username, u.display_name AS owner_name
    FROM playlists p LEFT JOIN users u ON u.id = p.owner_user_id`;

const titleSchema = z
  .string()
  .transform((s) => s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(1, 'Judul playlist tidak boleh kosong').max(150, 'Judul playlist maksimal 150 karakter'));
const createBody = z.object({
  title: titleSchema,
  visibility: z.enum(['public', 'private']).optional(),
  videoId: z.string().refine(isVideoId, 'ID video tidak valid').optional(),
});
const patchBody = z
  .object({ title: titleSchema.optional(), visibility: z.enum(['public', 'private']).optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Tidak ada perubahan');
const itemBody = z.object({ videoId: z.string().refine(isVideoId, 'ID video tidak valid') });
const orderBody = z.object({ videoIds: z.array(z.string().refine(isVideoId)).max(5000) });

/** Sama dengan listableSql (dievaluasi di JS). Awas: pemilik null (channel utama) ≠ tamu (userId null). */
export function isListable(v: Pick<VideoRecord, 'deleted_at' | 'status' | 'visibility' | 'owner_user_id'>, viewer: Viewer): boolean {
  if (v.deleted_at != null || v.status !== 'ready') return false;
  return v.visibility === 'public' || (viewer.userId != null && v.owner_user_id === viewer.userId);
}

const plNotFound = () => notFound('Playlist tidak ditemukan', 'PLAYLIST_NOT_FOUND');

/** Sampul = video listable pertama (sesuai urutan) untuk viewer; satu query untuk banyak playlist. */
async function covers(ids: number[], viewer: Viewer): Promise<Map<number, { publicId: string; thumb: ReturnType<typeof thumbUrls> }>> {
  const out = new Map<number, { publicId: string; thumb: ReturnType<typeof thumbUrls> }>();
  if (!ids.length) return out;
  const [lw, lp] = listableSql(viewer);
  const rows = await query<{ playlist_id: number; public_id: string; thumb_key: string | null; position: number }>(
    `SELECT pi.playlist_id, v.public_id, v.thumb_key, pi.position
       FROM playlist_items pi JOIN videos v ON v.id = pi.video_id
      WHERE pi.playlist_id IN (?) AND ${lw}
      ORDER BY pi.playlist_id, pi.position`,
    [ids, ...lp],
  );
  for (const r of rows) {
    if (!out.has(r.playlist_id)) out.set(r.playlist_id, { publicId: r.public_id, thumb: thumbUrls(r) });
  }
  return out;
}

export function toPlaylistSummary(p: PlaylistRow, cover: { publicId: string; thumb: ReturnType<typeof thumbUrls> } | undefined) {
  return {
    id: p.public_id,
    title: p.title,
    visibility: p.visibility,
    itemCount: Number(p.item_count),
    thumb: cover?.thumb ? { sd: cover.thumb.sd, hd: cover.thumb.hd } : null,
    owner: p.owner_user_id && p.owner_username ? { name: p.owner_name ?? p.owner_username, handle: p.owner_username } : null,
    isGuest: p.owner_user_id == null && p.guest_hash != null,
    updatedAt: new Date(p.updated_at).toISOString(),
    firstVideoId: cover?.publicId ?? null,
  };
}

export async function summarizePlaylists(rows: PlaylistRow[], viewer: Viewer) {
  const c = await covers(
    rows.map((r) => r.id),
    viewer,
  );
  return rows.map((r) => toPlaylistSummary(r, c.get(r.id)));
}

async function loadPlaylist(publicId: string): Promise<PlaylistRow> {
  if (!isPlaylistId(publicId)) throw plNotFound();
  const p = await queryOne<PlaylistRow>(`${PL_SELECT} WHERE p.public_id = ?`, [publicId]);
  if (!p) throw plNotFound();
  return p;
}

async function loadEditable(publicId: string, viewer: Viewer): Promise<PlaylistRow> {
  const p = await loadPlaylist(publicId);
  if (!canEditPlaylist(p, viewer)) {
    if (!canViewPlaylist(p, viewer)) throw plNotFound();
    throw forbidden('Hanya pemilik playlist yang dapat mengubahnya');
  }
  return p;
}

const limitsFor = (p: Pick<PlaylistRow, 'owner_user_id'>) => (p.owner_user_id ? LIMITS.user : LIMITS.guest);

/** Hanya video yang boleh ditonton viewer yang bisa ditambahkan. */
async function watchableVideo(publicId: string, viewer: Viewer): Promise<VideoRecord> {
  const v = await queryOne<VideoRecord>(`${VIDEO_SELECT} WHERE v.public_id = ?`, [publicId]);
  if (!v || !canWatch(v, viewer)) throw notFound('Video tidak tersedia', 'VIDEO_UNAVAILABLE');
  return v;
}

async function addItem(p: PlaylistRow, v: VideoRecord): Promise<boolean> {
  return tx(async (conn) => {
    const locked = await queryOne<{ item_count: number }>('SELECT item_count FROM playlists WHERE id = ? FOR UPDATE', [p.id], conn);
    if (!locked) throw plNotFound();
    if (Number(locked.item_count) >= limitsFor(p).items) throw badRequest(`Playlist maksimal berisi ${limitsFor(p).items.toLocaleString('id-ID')} video`);
    const res = await exec(
      `INSERT IGNORE INTO playlist_items (playlist_id, video_id, position)
       SELECT ?, ?, COALESCE(MAX(position), 0) + 1 FROM playlist_items WHERE playlist_id = ?`,
      [p.id, v.id, p.id],
      conn,
    );
    if (res.affectedRows === 0) return false;
    await exec('UPDATE playlists SET item_count = item_count + 1, updated_at = UTC_TIMESTAMP() WHERE id = ?', [p.id], conn);
    return true;
  });
}

/** Viewer untuk kepemilikan: user login atau tamu (dv_gid dibuat bila perlu). */
function ownerOf(req: FastifyRequest, reply: FastifyReply, create: boolean): { userId: number | null; guestHash: string | null } {
  if (req.viewer.userId) return { userId: req.viewer.userId, guestHash: null };
  if (!settings.get('site.guest_playlists')) throw forbidden('Login untuk membuat playlist');
  return { userId: null, guestHash: create ? ensureGuestId(req, reply) : req.viewer.guestHash };
}

export async function playlistRoutes(app: FastifyInstance): Promise<void> {
  /** Playlist milik saya (user) atau perangkat ini (tamu). `guestCount` = playlist tamu di perangkat ini (tawaran impor). */
  app.get('/api/playlists/mine', async (req, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const v = req.viewer;
    let rows: PlaylistRow[] = [];
    if (v.userId) rows = await query<PlaylistRow>(`${PL_SELECT} WHERE p.owner_user_id = ? ORDER BY p.updated_at DESC LIMIT 500`, [v.userId]);
    else if (v.guestHash) rows = await query<PlaylistRow>(`${PL_SELECT} WHERE p.owner_user_id IS NULL AND p.guest_hash = ? ORDER BY p.updated_at DESC LIMIT 500`, [v.guestHash]);
    let guestCount = 0;
    if (v.userId && v.guestHash) {
      const r = await queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM playlists WHERE owner_user_id IS NULL AND guest_hash = ?', [v.guestHash]);
      guestCount = Number(r?.n ?? 0);
    }
    return { items: await summarizePlaylists(rows, v), guestCount, guestAllowed: settings.get('site.guest_playlists') };
  });

  /** Jelajahi Playlist: playlist publik milik user (berisi video). */
  app.get('/api/playlists/public', async (req) => {
    const q = parse(z.object({ cursor: z.coerce.number().int().min(0).max(5000).optional() }), req.query);
    const offset = q.cursor ?? 0;
    const rows = await query<PlaylistRow>(
      `${PL_SELECT} WHERE p.visibility = 'public' AND p.owner_user_id IS NOT NULL AND p.item_count > 0 ORDER BY p.updated_at DESC LIMIT ? OFFSET ?`,
      [PAGE + 1, offset],
    );
    return { items: await summarizePlaylists(rows.slice(0, PAGE), req.viewer), nextCursor: rows.length > PAGE ? String(offset + PAGE) : null };
  });

  /** Id playlist saya yang berisi video (dialog "Simpan video ke…"). */
  app.get<{ Params: { videoId: string } }>('/api/playlists/contains/:videoId', async (req, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const v = req.viewer;
    if (!isVideoId(req.params.videoId) || (!v.userId && !v.guestHash)) return { ids: [] };
    const owner = v.userId ? 'p.owner_user_id = ?' : 'p.owner_user_id IS NULL AND p.guest_hash = ?';
    const rows = await query<{ public_id: string }>(
      `SELECT p.public_id FROM playlist_items pi JOIN playlists p ON p.id = pi.playlist_id JOIN videos vv ON vv.id = pi.video_id
        WHERE ${owner} AND vv.public_id = ?`,
      [v.userId ?? v.guestHash, req.params.videoId],
    );
    return { ids: rows.map((r) => r.public_id) };
  });

  app.post('/api/playlists', async (req, reply) => {
    const body = parse(createBody, req.body);
    const owner = ownerOf(req, reply, true);
    const key = owner.userId ? `u:${owner.userId}` : `g:${owner.guestHash}`;
    if (createLimiter.isBlocked(key)) throw tooMany('Terlalu banyak playlist dibuat. Coba lagi nanti.');
    const lim = owner.userId ? LIMITS.user : LIMITS.guest;
    const count = await queryOne<{ n: number }>(
      owner.userId ? 'SELECT COUNT(*) AS n FROM playlists WHERE owner_user_id = ?' : 'SELECT COUNT(*) AS n FROM playlists WHERE owner_user_id IS NULL AND guest_hash = ?',
      [owner.userId ?? owner.guestHash],
    );
    if (Number(count?.n ?? 0) >= lim.playlists) throw badRequest(`Maksimal ${lim.playlists} playlist`);
    const video = body.videoId ? await watchableVideo(body.videoId, req.viewer) : null;
    // Tamu selalu privat (SPEC §13).
    const visibility = owner.userId ? (body.visibility ?? 'private') : 'private';
    const publicId = newPlaylistId();
    const res = await exec('INSERT INTO playlists (public_id, title, owner_user_id, guest_hash, visibility) VALUES (?, ?, ?, ?, ?)', [
      publicId,
      body.title,
      owner.userId,
      owner.userId ? null : owner.guestHash,
      visibility,
    ]);
    createLimiter.hit(key);
    const p = (await queryOne<PlaylistRow>(`${PL_SELECT} WHERE p.id = ?`, [res.insertId]))!;
    if (video) await addItem(p, video);
    if (owner.userId) await audit(req, 'playlist.create', { type: 'playlist', id: publicId }, { title: body.title, visibility });
    reply.code(201);
    const fresh = (await queryOne<PlaylistRow>(`${PL_SELECT} WHERE p.id = ?`, [res.insertId]))!;
    return { playlist: (await summarizePlaylists([fresh], req.viewer))[0] };
  });

  /** Detail + item yang boleh dilihat viewer (`hiddenCount` = item tak tersedia yang disembunyikan). */
  app.get<{ Params: { id: string } }>('/api/playlists/:id', async (req, reply) => {
    const p = await loadPlaylist(req.params.id);
    if (!canViewPlaylist(p, req.viewer)) throw plNotFound();
    reply.header('Cache-Control', 'private, no-store');
    const sql = VIDEO_SELECT.replace('FROM videos v', ', pi.position FROM playlist_items pi JOIN videos v ON v.id = pi.video_id');
    const rows = await query<VideoRecord & { position: number }>(`${sql} WHERE pi.playlist_id = ? ORDER BY pi.position`, [p.id]);
    const visible = rows.filter((r) => isListable(r, req.viewer));
    let progress = new Map<number, number>();
    if (req.viewer.userId && visible.length) {
      const pr = await query<{ video_id: number; position_sec: number }>(
        'SELECT video_id, position_sec FROM watch_history WHERE user_id = ? AND video_id IN (?)',
        [req.viewer.userId, visible.map((r) => r.id)],
      );
      progress = new Map(pr.map((r) => [r.video_id, r.position_sec]));
    }
    const summary = toPlaylistSummary(p, visible[0] ? { publicId: visible[0].public_id, thumb: thumbUrls(visible[0]) } : undefined);
    return {
      playlist: { ...summary, canEdit: canEditPlaylist(p, req.viewer), visibleCount: visible.length },
      items: visible.map((r) => ({ ...toSummary(r, req.viewer), ...(progress.has(r.id) ? { progressSec: progress.get(r.id) } : {}) })),
      hiddenCount: rows.length - visible.length,
    };
  });

  app.patch<{ Params: { id: string } }>('/api/playlists/:id', async (req) => {
    const body = parse(patchBody, req.body);
    const p = await loadEditable(req.params.id, req.viewer);
    if (body.visibility === 'public' && !p.owner_user_id) throw badRequest('Playlist tamu selalu privat. Login untuk membuat playlist publik.');
    const sets: string[] = [];
    const params: unknown[] = [];
    if (body.title !== undefined) {
      sets.push('title = ?');
      params.push(body.title);
    }
    if (body.visibility !== undefined) {
      sets.push('visibility = ?');
      params.push(body.visibility);
    }
    await exec(`UPDATE playlists SET ${sets.join(', ')}, updated_at = UTC_TIMESTAMP() WHERE id = ?`, [...params, p.id]);
    if (p.owner_user_id) await audit(req, 'playlist.update', { type: 'playlist', id: p.public_id }, body);
    const fresh = (await queryOne<PlaylistRow>(`${PL_SELECT} WHERE p.id = ?`, [p.id]))!;
    return { playlist: (await summarizePlaylists([fresh], req.viewer))[0] };
  });

  app.delete<{ Params: { id: string } }>('/api/playlists/:id', async (req) => {
    const p = await loadEditable(req.params.id, req.viewer);
    await exec('DELETE FROM playlists WHERE id = ?', [p.id]);
    if (p.owner_user_id) await audit(req, 'playlist.delete', { type: 'playlist', id: p.public_id }, { title: p.title });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/playlists/:id/items', async (req) => {
    const body = parse(itemBody, req.body);
    const p = await loadEditable(req.params.id, req.viewer);
    const v = await watchableVideo(body.videoId, req.viewer);
    const added = await addItem(p, v);
    return { ok: true, added };
  });

  app.delete<{ Params: { id: string; videoId: string } }>('/api/playlists/:id/items/:videoId', async (req) => {
    const p = await loadEditable(req.params.id, req.viewer);
    if (!isVideoId(req.params.videoId)) return { ok: true, removed: false };
    const removed = await tx(async (conn) => {
      const res = await exec(
        'DELETE pi FROM playlist_items pi JOIN videos v ON v.id = pi.video_id WHERE pi.playlist_id = ? AND v.public_id = ?',
        [p.id, req.params.videoId],
        conn,
      );
      if (res.affectedRows) await exec('UPDATE playlists SET item_count = GREATEST(0, item_count - 1), updated_at = UTC_TIMESTAMP() WHERE id = ?', [p.id], conn);
      return res.affectedRows > 0;
    });
    return { ok: true, removed };
  });

  /** Urutan baru: id yang dikirim dulu (urutan klien), item lain (mis. tersembunyi) tetap di belakang dengan urutan lama. */
  app.put<{ Params: { id: string } }>('/api/playlists/:id/order', async (req) => {
    const body = parse(orderBody, req.body);
    const p = await loadEditable(req.params.id, req.viewer);
    await tx(async (conn) => {
      const items = await query<{ id: number; public_id: string }>(
        'SELECT pi.id, v.public_id FROM playlist_items pi JOIN videos v ON v.id = pi.video_id WHERE pi.playlist_id = ? ORDER BY pi.position FOR UPDATE',
        [p.id],
        conn,
      );
      const byVideo = new Map(items.map((i) => [i.public_id, i.id]));
      const seen = new Set<number>();
      const ordered: number[] = [];
      for (const vid of body.videoIds) {
        const itemId = byVideo.get(vid);
        if (itemId && !seen.has(itemId)) {
          seen.add(itemId);
          ordered.push(itemId);
        }
      }
      for (const i of items) if (!seen.has(i.id)) ordered.push(i.id);
      if (!ordered.length) return;
      // Satu UPDATE dengan CASE (posisi 1..n).
      const cases = ordered.map(() => 'WHEN ? THEN ?').join(' ');
      const params: unknown[] = [];
      ordered.forEach((itemId, idx) => params.push(itemId, idx + 1));
      await exec(`UPDATE playlist_items SET position = CASE id ${cases} END WHERE playlist_id = ?`, [...params, p.id], conn);
      await exec('UPDATE playlists SET updated_at = UTC_TIMESTAMP() WHERE id = ?', [p.id], conn);
    });
    return { ok: true };
  });

  /** Pindahkan playlist tamu di perangkat ini (dv_gid) ke akun yang sedang login. */
  app.post('/api/playlists/import-guest', { preHandler: requireUser }, async (req) => {
    const v = req.viewer;
    if (!v.guestHash) return { ok: true, imported: 0 };
    const imported = await tx(async (conn) => {
      const have = await queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM playlists WHERE owner_user_id = ?', [v.userId], conn);
      const room = Math.max(0, LIMITS.user.playlists - Number(have?.n ?? 0));
      if (room === 0) throw new AppError(400, 'LIMIT', `Akun Anda sudah memiliki ${LIMITS.user.playlists} playlist`);
      const res = await exec(
        'UPDATE playlists SET owner_user_id = ?, guest_hash = NULL WHERE owner_user_id IS NULL AND guest_hash = ? ORDER BY updated_at DESC LIMIT ?',
        [v.userId, v.guestHash, room],
        conn,
      );
      return res.affectedRows;
    });
    if (imported) await audit(req, 'playlist.import_guest', null, { imported });
    return { ok: true, imported };
  });
}
