import type { FastifyInstance, FastifyRequest } from 'fastify';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { exec, query, queryOne } from '../../db.js';
import { AppError, badRequest, conflict, notFound, tooMany } from '../../lib/errors.js';
import { AttemptLimiter } from '../../lib/limiter.js';
import { parse } from '../../lib/validate.js';
import { requireAdmin, requireUser } from '../../plugins/auth.js';
import { audit } from '../audit/service.js';
import { enqueueJob, jobEvents } from '../processing/queue.js';
import { cancelRunningJob } from '../processing/worker.js';
import { settings } from '../settings/service.js';
import { thumbUrls } from '../videos/model.js';
import { fillTitlesSoon } from './oembed.js';
import { canonicalUrl, parseYoutubeLink, playlistUrl, splitLinks, unsupportedPlaylistReason } from './url.js';
import { fetchPlaylist, MAX_HEIGHT, MAX_PLAYLIST_ITEMS, updateYtdlp, ytdlpPath, ytdlpVersion, type YtPlaylist } from './ytdlp.js';

const MAX_PER_BATCH = 100;
/** Batas total video yang masuk antrean sekali tambah (termasuk isi playlist). */
const MAX_TOTAL = 1000;
/** Pengguna biasa: playlist per sekali tambah (tiap playlist dibaca yt-dlp saat itu juga). */
const USER_MAX_PLAYLISTS = 10;
/** Pengguna biasa: tambah link per jam (in-memory, seperti mulai upload). */
const userAddLimiter = new AttemptLimiter(30, 3600_000);

interface Row {
  id: number;
  url: string;
  yt_id: string;
  playlist_id: string | null;
  playlist_title: string | null;
  playlist_index: number | null;
  title: string | null;
  channel: string | null;
  duration_sec: number | null;
  phase: string;
  format_note: string | null;
  size_bytes: number | null;
  visibility: 'public' | 'private';
  owner_user_id: number | null;
  owner_username: string | null;
  owner_name: string | null;
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
function displayStatus(r: Pick<Row, 'phase' | 'job_status'>): string {
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

// ---------------------------------------------------------------------------
// Antrean global (lane download, satu per satu untuk semua pengguna)
// ---------------------------------------------------------------------------

export interface QueueState {
  /** Video yang menunggu giliran (semua pengguna). */
  waiting: number;
  /** Video yang sedang diunduh/diupload (lane download ×1). */
  running: number;
  /** job id → urutan menunggu (1 = berikutnya setelah yang sedang berjalan). */
  position: Map<number, number>;
}

/** Urutan sama dengan worker (`ORDER BY priority, id`); job yang menunggu jadwal coba lagi tetap dihitung. */
export function queueFromJobs(jobs: { id: number; status: string }[]): QueueState {
  const position = new Map<number, number>();
  let running = 0;
  for (const j of jobs) {
    if (j.status === 'running') running++;
    else position.set(j.id, position.size + 1);
  }
  return { waiting: position.size, running, position };
}

let queueCache: { at: number; value: Promise<QueueState> } | null = null;

/** Dibaca halaman impor tiap beberapa detik oleh banyak pengguna → di-cache 1 detik (single-flight). */
function queueState(): Promise<QueueState> {
  if (queueCache && Date.now() - queueCache.at < 1000) return queueCache.value;
  const value = query<{ id: number; status: string }>(
    "SELECT id, status FROM jobs WHERE lane = 'download' AND status IN ('queued','running') ORDER BY priority, id",
  ).then(queueFromJobs);
  queueCache = { at: Date.now(), value };
  value.catch(() => (queueCache = null));
  return value;
}

/** Pesan error untuk pengguna biasa: path di server disamarkan (admin melihat apa adanya). */
export function publicError(msg: string | null): string | null {
  return msg && msg.replace(/(^|[\s'"(=])\/(?:www|root|tmp|home|var|usr|opt|etc)\/[^\s'")]*/g, '$1…');
}

function present(r: Row, queue: QueueState, admin: boolean) {
  const status = displayStatus(r);
  const error = status === 'failed' || status === 'cancelled' || (status === 'queued' && r.job_error) ? r.job_error : null;
  return {
    id: r.id,
    url: r.url,
    ytId: r.yt_id,
    playlist: r.playlist_id ? { id: r.playlist_id, title: r.playlist_title, index: r.playlist_index } : null,
    title: r.title,
    channel: r.channel,
    durationSec: r.duration_sec,
    quality: r.format_note,
    sizeBytes: r.size_bytes != null ? Number(r.size_bytes) : null,
    visibility: r.visibility,
    category: r.category_name,
    status,
    progress: status === 'downloading' || status === 'uploading' ? (r.job_progress ?? 0) : status === 'done' ? 100 : 0,
    /** Urutan dalam antrean global (hanya untuk yang menunggu). */
    position: status === 'queued' && r.job_id ? (queue.position.get(r.job_id) ?? null) : null,
    error: admin ? error : publicError(error),
    attempts: r.job_attempts ?? 0,
    maxAttempts: r.job_max ?? 0,
    retryAt: status === 'queued' && r.job_run_after && r.job_run_after.getTime() > Date.now() ? r.job_run_after.toISOString() : null,
    createdAt: r.created_at.toISOString(),
    finishedAt: r.finished_at?.toISOString() ?? null,
    video:
      r.v_public_id && !r.v_deleted
        ? { id: r.v_public_id, title: r.v_title, status: r.v_status, thumb: thumbUrls({ public_id: r.v_public_id, thumb_key: r.v_thumb_key })?.sd ?? null }
        : null,
    // Channel tujuan hanya untuk admin (null = channel utama).
    ...(admin ? { owner: r.owner_user_id != null ? { id: r.owner_user_id, username: r.owner_username, name: r.owner_name } : null } : {}),
  };
}

const SELECT = `SELECT i.id, i.url, i.yt_id, i.playlist_id, i.playlist_title, i.playlist_index, i.title, i.channel, i.duration_sec, i.phase, i.format_note, i.size_bytes, i.visibility,
                       i.owner_user_id, ou.username AS owner_username, ou.display_name AS owner_name,
                       i.created_at, i.finished_at, i.job_id,
                       j.status AS job_status, j.progress AS job_progress, j.last_error AS job_error, j.attempts AS job_attempts,
                       j.max_attempts AS job_max, j.run_after AS job_run_after,
                       v.public_id AS v_public_id, v.title AS v_title, v.status AS v_status, v.thumb_key AS v_thumb_key, v.deleted_at AS v_deleted,
                       c.name AS category_name
                  FROM youtube_imports i
                  LEFT JOIN jobs j ON j.id = i.job_id
                  LEFT JOIN users ou ON ou.id = i.owner_user_id
                  LEFT JOIN videos v ON v.id = i.video_id
                  LEFT JOIN categories c ON c.id = i.category_id`;

/** Impor yang menunggu/berjalan (job antre/berjalan & belum selesai). */
const ACTIVE_SQL = "(i.phase <> 'done' AND j.status IN ('queued','running'))";
/** Kebalikan ACTIVE_SQL yang aman terhadap NULL (impor tanpa job tetap masuk riwayat). */
const HISTORY_SQL = "(i.phase = 'done' OR j.status IS NULL OR j.status NOT IN ('queued','running'))";

const SUMMARY_SQL = `SELECT CASE WHEN i.phase = 'done' THEN 'done' WHEN j.status IN ('failed','cancelled') THEN j.status
                                 WHEN j.status = 'running' THEN 'running' ELSE 'queued' END AS s, COUNT(*) AS n
                       FROM youtube_imports i LEFT JOIN jobs j ON j.id = i.job_id`;

async function summaryOf(where = '', params: unknown[] = []) {
  const counts = await query<{ s: string; n: number }>(`${SUMMARY_SQL} ${where} GROUP BY s`, params);
  return Object.fromEntries(['queued', 'running', 'done', 'failed', 'cancelled'].map((k) => [k, Number(counts.find((c) => c.s === k)?.n ?? 0)]));
}

const listQuery = z.object({
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
const addBody = z.object({
  urls: z.string().max(50_000),
  visibility: z.enum(['public', 'private']).optional(),
  categoryId: z.number().int().positive().nullable().optional(),
  /** Impor ulang walau video YouTube yang sama sudah pernah diimpor ke channel yang sama (hanya admin). */
  force: z.boolean().optional(),
  /** Link berisi video + playlist (`watch?v=…&list=…`): seluruh playlist (default) atau videonya saja. */
  playlistMode: z.enum(['all', 'video']).default('all'),
});
type AddBody = z.infer<typeof addBody>;

interface Candidate {
  id: string;
  input: string;
  title: string | null;
  durationSec: number | null;
  playlist: { id: string; title: string; index: number } | null;
}
const idParams = z.object({ id: z.coerce.number().int().positive() });

async function loadRow(id: number, ownerUserId?: number): Promise<Row> {
  const r = await queryOne<Row>(`${SELECT} WHERE i.id = ?${ownerUserId != null ? ' AND i.owner_user_id = ?' : ''}`, ownerUserId != null ? [id, ownerUserId] : [id]);
  if (!r) throw notFound('Data impor tidak ditemukan');
  return r;
}

async function listRows(where: string, params: unknown[], q: z.infer<typeof listQuery>, req: FastifyRequest, admin: boolean) {
  const conds = [where, q.cursor ? 'i.id < ?' : ''].filter(Boolean);
  const args = [...params, ...(q.cursor ? [q.cursor] : [])];
  const [rows, queue] = await Promise.all([
    query<Row>(`${SELECT} ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''} ORDER BY i.id DESC LIMIT ?`, [...args, q.limit + 1]),
    queueState(),
  ]);
  const items = rows.slice(0, q.limit).map((r) => present(r, queue, admin));
  // Termasuk baris lama / yang judulnya gagal diambil saat ditambahkan (dibatasi 1×/jam per impor).
  fillTitlesSoon(items.filter((i) => !i.title && i.status !== 'done').map((i) => i.id), req.log);
  return { items, nextCursor: rows.length > q.limit ? String(items.at(-1)!.id) : null, queue: { waiting: queue.waiting, running: queue.running } };
}

/** Impor pengguna (non-admin) aktif? Upload harus aktif juga karena impor diperlakukan sebagai upload. */
const userImportEnabled = () => settings.get('upload.enabled') && settings.get('upload.youtube_import');

function assertUserCanImport(req: FastifyRequest): void {
  if (req.viewer.role !== 'admin' && !userImportEnabled()) throw new AppError(403, 'IMPORT_DISABLED', 'Impor YouTube sedang dinonaktifkan oleh admin');
}

interface AddTarget {
  /** Channel tujuan: null = channel utama. */
  ownerUserId: number | null;
  /** Admin: tanpa batas antrean per pengguna & boleh `force`. */
  admin: boolean;
}

/** Tambah link ke antrean global. Video jadi milik `target.ownerUserId` (seperti upload) atau channel utama. */
async function addImports(req: FastifyRequest, body: AddBody, target: AddTarget) {
  if (!settings.get('drive.root_folder_id')) throw conflict('Folder Google Drive belum diatur (Studio → Pengaturan → Google Drive)');
  const links = splitLinks(body.urls);
  if (!links.length) throw badRequest('Masukkan minimal satu link YouTube');
  if (links.length > MAX_PER_BATCH) throw badRequest(`Maksimal ${MAX_PER_BATCH} link sekali tambah`);
  if (body.categoryId != null) {
    const cat = await queryOne('SELECT id FROM categories WHERE id = ? AND missing_at IS NULL', [body.categoryId]);
    if (!cat) throw badRequest('Kategori tidak ditemukan');
  }
  const force = target.admin && body.force === true;
  const visibility = body.visibility ?? settings.get('upload.default_visibility');
  const skipped: { input: string; reason: string }[] = [];
  const playlists: { id: string; title: string; total: number; added: number }[] = [];
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  const push = (c: Candidate) => {
    if (seen.has(c.id)) skipped.push({ input: c.title ?? c.input, reason: 'Ganda di daftar ini' });
    else {
      seen.add(c.id);
      candidates.push(c);
    }
  };
  let playlistReads = 0;
  for (const input of links) {
    const link = parseYoutubeLink(input);
    if (!link) {
      skipped.push({ input, reason: 'Bukan link video/playlist YouTube' });
      continue;
    }
    if (link.playlistId && (body.playlistMode === 'all' || !link.videoId)) {
      const why = unsupportedPlaylistReason(link.playlistId);
      if (why) {
        if (link.videoId) push({ id: link.videoId, input, title: null, durationSec: null, playlist: null });
        else skipped.push({ input, reason: why });
        continue;
      }
      if (!target.admin && playlistReads >= USER_MAX_PLAYLISTS) {
        skipped.push({ input, reason: `Maksimal ${USER_MAX_PLAYLISTS} playlist sekali tambah` });
        continue;
      }
      playlistReads++;
      let pl: YtPlaylist;
      try {
        pl = await fetchPlaylist(playlistUrl(link.playlistId));
      } catch (err) {
        skipped.push({ input, reason: `Playlist gagal dibaca: ${(err as Error).message}` });
        continue;
      }
      playlists.push({ id: pl.id, title: pl.title, total: pl.entries.length, added: 0 });
      for (const [i, e] of pl.entries.entries()) {
        if (e.unavailable) skipped.push({ input: e.title ?? e.id, reason: e.unavailable });
        else push({ id: e.id, input: e.id, title: e.title, durationSec: e.durationSec, playlist: { id: pl.id, title: pl.title, index: i + 1 } });
      }
      continue;
    }
    if (link.videoId) push({ id: link.videoId, input, title: null, durationSec: null, playlist: null });
  }
  if (candidates.length > MAX_TOTAL) throw badRequest(`Terlalu banyak video sekaligus (${candidates.length}); maksimal ${MAX_TOTAL}`);

  // Pengguna biasa: jumlah video menunggu/berjalan miliknya dibatasi agar antrean bersama tidak dimonopoli.
  let room = Number.POSITIVE_INFINITY;
  const maxQueued = settings.get('upload.import_max_queued');
  if (!target.admin && target.ownerUserId != null) {
    const mine = await queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM youtube_imports i JOIN jobs j ON j.id = i.job_id
        WHERE i.owner_user_id = ? AND i.phase <> 'done' AND j.status IN ('queued','running')`,
      [target.ownerUserId],
    );
    room = Math.max(0, maxQueued - Number(mine?.n ?? 0));
  }

  let added = 0;
  let overLimit = 0;
  const untitled: number[] = [];
  for (const c of candidates) {
    if (!force) {
      // Cek ganda per channel tujuan: video yang sama boleh ada di channel pengguna lain.
      const prev = await queryOne<{ phase: string; job_status: string | null; v_deleted: Date | null; video_id: number | null }>(
        `SELECT i.phase, j.status AS job_status, v.deleted_at AS v_deleted, i.video_id
           FROM youtube_imports i LEFT JOIN jobs j ON j.id = i.job_id LEFT JOIN videos v ON v.id = i.video_id
          WHERE i.yt_id = ? AND i.owner_user_id <=> ? ORDER BY i.id DESC LIMIT 1`,
        [c.id, target.ownerUserId],
      );
      if (prev && prev.phase !== 'done' && (prev.job_status === 'queued' || prev.job_status === 'running')) {
        skipped.push({ input: c.title ?? c.input, reason: 'Sudah ada di antrean' });
        continue;
      }
      if (prev && prev.phase === 'done' && prev.video_id && !prev.v_deleted) {
        skipped.push({ input: c.title ?? c.input, reason: target.ownerUserId != null ? 'Sudah ada di channel Anda' : 'Sudah pernah diimpor' });
        continue;
      }
    }
    if (added >= room) {
      overLimit++;
      continue;
    }
    const res = await exec(
      `INSERT INTO youtube_imports (url, yt_id, playlist_id, playlist_title, playlist_index, title, duration_sec, visibility, category_id, owner_user_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        canonicalUrl(c.id),
        c.id,
        c.playlist?.id ?? null,
        c.playlist?.title.slice(0, 300) ?? null,
        c.playlist?.index ?? null,
        c.title?.slice(0, 500) ?? null,
        c.durationSec,
        visibility,
        body.categoryId ?? null,
        target.ownerUserId,
        req.viewer.userId,
      ],
    );
    const jobId = await enqueueJob('yt_import', { payload: { importId: res.insertId } });
    await exec('UPDATE youtube_imports SET job_id = ? WHERE id = ?', [jobId, res.insertId]);
    if (!c.title) untitled.push(res.insertId);
    added++;
    const pl = c.playlist && playlists.find((p) => p.id === c.playlist!.id);
    if (pl) pl.added++;
  }
  if (overLimit) skipped.push({ input: `${overLimit} video`, reason: `Batas antrean Anda tercapai (maksimal ${maxQueued} video menunggu). Tambahkan lagi setelah sebagian selesai.` });
  queueCache = null;
  // Link video tunggal belum punya judul (isi playlist sudah dari --flat-playlist) → ambil lewat oEmbed.
  fillTitlesSoon(untitled, req.log);
  if (added)
    await audit(req, 'import.add', null, {
      count: added,
      visibility,
      categoryId: body.categoryId ?? null,
      owner: target.ownerUserId ?? 'main',
      playlists: playlists.map((p) => p.id),
    });
  return { added, skipped, playlists };
}

async function retryImport(req: FastifyRequest, r: Row): Promise<void> {
  const status = displayStatus(r);
  if (status !== 'failed' && status !== 'cancelled') throw badRequest('Hanya impor yang gagal/dibatalkan yang bisa dicoba lagi');
  await exec("UPDATE youtube_imports SET phase = 'queued' WHERE id = ?", [r.id]);
  if (r.job_id && r.job_status) {
    // Job lama dipakai ulang → kembali ke posisinya semula di antrean (urutan job id).
    await exec(
      "UPDATE jobs SET status = 'queued', attempts = 0, progress = 0, last_error = NULL, finished_at = NULL, run_after = UTC_TIMESTAMP() WHERE id = ?",
      [r.job_id],
    );
    jobEvents.emit('enqueued', 'download');
  } else {
    const jobId = await enqueueJob('yt_import', { payload: { importId: r.id } });
    await exec('UPDATE youtube_imports SET job_id = ? WHERE id = ?', [jobId, r.id]);
  }
  queueCache = null;
  await audit(req, 'import.retry', null, { importId: r.id, yt: r.yt_id });
}

/** Batalkan (bila menunggu/berjalan) atau hapus dari daftar (video hasil impor TIDAK dihapus). */
async function cancelOrRemove(req: FastifyRequest, r: Row, by: 'admin' | 'pengguna') {
  const status = displayStatus(r);
  const reason = `dibatalkan ${by}`;
  if (status === 'downloading' || status === 'uploading') {
    if (r.job_id) cancelRunningJob(r.job_id, reason);
    await audit(req, 'import.cancel', null, { importId: r.id, yt: r.yt_id });
    return { ok: true, cancelled: true };
  }
  if (status === 'queued' && r.job_id) {
    await exec("UPDATE jobs SET status = 'cancelled', finished_at = UTC_TIMESTAMP(), last_error = ? WHERE id = ? AND status = 'queued'", [reason, r.job_id]);
    queueCache = null;
    await audit(req, 'import.cancel', null, { importId: r.id, yt: r.yt_id });
    return { ok: true, cancelled: true };
  }
  await exec('DELETE FROM youtube_imports WHERE id = ?', [r.id]);
  return { ok: true, removed: true };
}

/**
 * User dihapus: impor yang belum selesai dibatalkan & dihapus dari daftar. Opsi `transfer` (video pindah ke channel
 * utama) → baris impor yang sudah selesai ikut menjadi milik channel utama; opsi hapus → semua baris impornya dihapus.
 */
export async function dropUserImports(userId: number, transfer: boolean): Promise<void> {
  const rows = await query<{ id: number; job_id: number | null; job_status: string | null; phase: string }>(
    'SELECT i.id, i.job_id, j.status AS job_status, i.phase FROM youtube_imports i LEFT JOIN jobs j ON j.id = i.job_id WHERE i.owner_user_id = ?',
    [userId],
  );
  for (const r of rows) {
    if (r.phase === 'done' || !r.job_id) continue;
    if (r.job_status === 'running') cancelRunningJob(r.job_id, 'pemilik dihapus');
    else if (r.job_status === 'queued')
      await exec("UPDATE jobs SET status = 'cancelled', finished_at = UTC_TIMESTAMP(), last_error = 'pemilik dihapus' WHERE id = ? AND status = 'queued'", [r.job_id]);
  }
  if (transfer) {
    await exec("UPDATE youtube_imports SET owner_user_id = NULL WHERE owner_user_id = ? AND phase = 'done'", [userId]);
    await exec("DELETE FROM youtube_imports WHERE owner_user_id = ? AND phase <> 'done'", [userId]);
  } else {
    await exec('DELETE FROM youtube_imports WHERE owner_user_id = ?', [userId]);
  }
  queueCache = null;
}

export async function importRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  // Pengguna: impor ke channel sendiri. Hanya melihat daftar miliknya + jumlah antrean global (angka).
  // -------------------------------------------------------------------------

  app.get('/api/imports', { preHandler: requireUser }, async (req) => {
    const q = parse(listQuery, req.query);
    const userId = req.viewer.userId!;
    const admin = req.viewer.role === 'admin';
    // Riwayat (selesai/gagal/dibatalkan) berhalaman; yang menunggu/berjalan selalu lengkap di halaman pertama.
    const history = await listRows(`i.owner_user_id = ? AND ${HISTORY_SQL}`, [userId], q, req, false);
    if (q.cursor) return history;
    const [activeRows, queue, summary] = await Promise.all([
      query<Row>(`${SELECT} WHERE i.owner_user_id = ? AND ${ACTIVE_SQL} ORDER BY j.status = 'running' DESC, j.priority, j.id LIMIT 1000`, [userId]),
      queueState(),
      summaryOf('WHERE i.owner_user_id = ?', [userId]),
    ]);
    const active = activeRows.map((r) => present(r, queue, false));
    fillTitlesSoon(active.filter((i) => !i.title).map((i) => i.id), req.log);
    return {
      ...history,
      active,
      summary,
      enabled: admin || userImportEnabled(),
      limits: {
        maxHeight: MAX_HEIGHT,
        maxPlaylistItems: MAX_PLAYLIST_ITEMS,
        maxQueued: admin ? null : settings.get('upload.import_max_queued'),
        maxFileGb: settings.get('upload.max_file_gb'),
      },
    };
  });

  app.post('/api/imports', { preHandler: requireUser }, async (req, reply) => {
    assertUserCanImport(req);
    const body = parse(addBody, req.body);
    const admin = req.viewer.role === 'admin';
    const key = `u:${req.viewer.userId}`;
    if (!admin) {
      if (userAddLimiter.isBlocked(key)) throw tooMany('Terlalu banyak permintaan impor. Coba lagi dalam satu jam.');
      userAddLimiter.hit(key);
    }
    const res = await addImports(req, body, { ownerUserId: req.viewer.userId, admin });
    reply.code(res.added ? 201 : 200);
    return res;
  });

  app.post('/api/imports/:id/retry', { preHandler: requireUser }, async (req) => {
    assertUserCanImport(req);
    const { id } = parse(idParams, req.params);
    await retryImport(req, await loadRow(id, req.viewer.userId!));
    return { ok: true };
  });

  app.delete('/api/imports/:id', { preHandler: requireUser }, async (req) => {
    const { id } = parse(idParams, req.params);
    return cancelOrRemove(req, await loadRow(id, req.viewer.userId!), 'pengguna');
  });

  // -------------------------------------------------------------------------
  // Admin (Studio → Impor YouTube): semua antrean semua pengguna; tambah dari sini → channel utama.
  // -------------------------------------------------------------------------

  app.get('/api/admin/imports', { preHandler: requireAdmin }, async (req) => {
    const q = parse(listQuery, req.query);
    const list = await listRows('', [], q, req, true);
    return { ...list, summary: await summaryOf(), maxHeight: MAX_HEIGHT, maxPlaylistItems: MAX_PLAYLIST_ITEMS };
  });

  app.post('/api/admin/imports', { preHandler: requireAdmin }, async (req, reply) => {
    const res = await addImports(req, parse(addBody, req.body), { ownerUserId: null, admin: true });
    reply.code(res.added ? 201 : 200);
    return res;
  });

  app.post('/api/admin/imports/:id/retry', { preHandler: requireAdmin }, async (req) => {
    const { id } = parse(idParams, req.params);
    await retryImport(req, await loadRow(id));
    return { ok: true };
  });

  app.delete('/api/admin/imports/:id', { preHandler: requireAdmin }, async (req) => {
    const { id } = parse(idParams, req.params);
    return cancelOrRemove(req, await loadRow(id), 'admin');
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
