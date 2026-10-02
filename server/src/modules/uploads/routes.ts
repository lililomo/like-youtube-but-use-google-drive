import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Readable } from 'node:stream';
import { request } from 'undici';
import { z } from 'zod';
import { exec, query, queryOne, tx } from '../../db.js';
import { decrypt, encrypt } from '../../lib/crypto.js';
import { AppError, badRequest, conflict, notFound, tooMany } from '../../lib/errors.js';
import { isUploadId, newUploadId, newVideoId } from '../../lib/ids.js';
import { AttemptLimiter } from '../../lib/limiter.js';
import { parse } from '../../lib/validate.js';
import { requireUser } from '../../plugins/auth.js';
import { audit } from '../audit/service.js';
import { fileExtension, searchTextFrom, titleFromName } from '../drive/classify.js';
import { createResumableSession } from '../drive/client.js';
import { enqueueJob } from '../processing/queue.js';
import { settings } from '../settings/service.js';

const GB = 1024 ** 3;
const MAX_ACTIVE = 3;
const SESSION_DAYS = 7; // sesi resumable Google berlaku ±1 minggu
const initLimiter = new AttemptLimiter(30, 3600_000);
/** Satu chunk per upload pada satu waktu. */
const busy = new Set<string>();

const MIME_BY_EXT: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  ts: 'video/mp2t',
  mts: 'video/mp2t',
  m2ts: 'video/mp2t',
  '3gp': 'video/3gpp',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  ogv: 'video/ogg',
};

export interface UploadRow {
  id: number;
  public_id: string;
  user_id: number;
  video_public_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  received_bytes: number;
  visibility: 'public' | 'private';
  category_id: number | null;
  target_folder_id: string;
  session_url_enc: string;
  status: 'uploading' | 'completed' | 'failed' | 'cancelled' | 'expired';
  drive_file_id: string | null;
  video_id: number | null;
  error: string | null;
  expires_at: Date;
}

interface DriveUploadedFile {
  id: string;
  name: string;
  mimeType?: string;
  size?: string;
  md5Checksum?: string;
  parents?: string[];
  createdTime?: string;
  modifiedTime?: string;
  videoMediaMetadata?: { width?: number; height?: number; durationMillis?: string };
}

const initBody = z.object({
  fileName: z.string().trim().min(1).max(255),
  size: z.number().int().positive(),
  mimeType: z.string().max(100).optional().default(''),
  visibility: z.enum(['public', 'private']).optional(),
  categoryId: z.number().int().positive().nullable().optional(),
});

/** Nama file aman untuk Drive (tanpa karakter kontrol & pemisah path). */
export function cleanFileName(name: string): string {
  return name
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 255);
}

/** `Content-Range: bytes a-b/total` → angka; null bila tidak valid. */
export function parseContentRange(h: string | undefined): { start: number; end: number; total: number } | null {
  const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(h ?? '');
  if (!m) return null;
  const [start, end, total] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!(start <= end && end < total)) return null;
  return { start, end, total };
}

/** Header `Range: bytes=0-N` dari Drive (308) → jumlah byte yang sudah diterima. */
export function receivedFromRange(h: string | string[] | undefined): number {
  const v = Array.isArray(h) ? h[0] : h;
  const m = /bytes=0-(\d+)/.exec(v ?? '');
  return m ? Number(m[1]) + 1 : 0;
}

async function loadUpload(publicId: string, userId: number): Promise<UploadRow> {
  if (!isUploadId(publicId)) throw notFound('Upload tidak ditemukan');
  const up = await queryOne<UploadRow>('SELECT * FROM uploads WHERE public_id = ? AND user_id = ?', [publicId, userId]);
  if (!up) throw notFound('Upload tidak ditemukan');
  return up;
}

function publicUpload(up: UploadRow, videoPublicId?: string | null) {
  return {
    uploadId: up.public_id,
    fileName: up.file_name,
    size: Number(up.size_bytes),
    received: Number(up.received_bytes),
    status: up.status,
    videoId: videoPublicId ?? (up.status === 'completed' ? up.video_public_id : null),
    error: up.error,
    chunkSize: settings.get('upload.chunk_mb') * 1024 * 1024,
  };
}

/**
 * Selesaikan upload: buat/klaim baris videos, tambah pemakaian kuota (sekali), antrekan probe.
 * Aman bila sinkronisasi lebih dulu memasukkan file yang sama (cek drive_file_id).
 */
async function finalize(req: FastifyRequest, up: UploadRow, file: DriveUploadedFile): Promise<string> {
  const result = await tx(async (conn) => {
    const locked = await queryOne<UploadRow>('SELECT * FROM uploads WHERE id = ? FOR UPDATE', [up.id], conn);
    if (!locked) throw notFound('Upload tidak ditemukan');
    if (locked.status === 'completed' && locked.video_id) {
      const v = await queryOne<{ public_id: string }>('SELECT public_id FROM videos WHERE id = ?', [locked.video_id], conn);
      return { publicId: v?.public_id ?? locked.video_public_id, videoId: locked.video_id, fresh: false };
    }
    const title = titleFromName(file.name);
    const meta = file.videoMediaMetadata;
    const existing = await queryOne<{ id: number; public_id: string }>('SELECT id, public_id FROM videos WHERE drive_file_id = ?', [file.id], conn);
    let videoId: number;
    let publicId: string;
    if (existing) {
      await exec(
        `UPDATE videos SET owner_user_id = ?, source = 'upload', visibility = ?, category_id = ?, deleted_at = NULL WHERE id = ?`,
        [up.user_id, up.visibility, up.category_id, existing.id],
        conn,
      );
      videoId = existing.id;
      publicId = existing.public_id;
    } else {
      const taken = await queryOne('SELECT id FROM videos WHERE public_id = ?', [up.video_public_id], conn);
      publicId = taken ? newVideoId() : up.video_public_id;
      const res = await exec(
        `INSERT INTO videos (public_id, drive_file_id, drive_parent_id, category_id, owner_user_id, source, visibility, status,
                             title, search_text, file_name, mime_type, size_bytes, md5, duration_ms, width, height,
                             drive_created_at, drive_modified_at, published_at)
         VALUES (?, ?, ?, ?, ?, 'upload', ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
        [
          publicId,
          file.id,
          file.parents?.[0] ?? up.target_folder_id,
          up.category_id,
          up.user_id,
          up.visibility,
          title,
          searchTextFrom(title),
          file.name,
          file.mimeType ?? up.mime_type,
          Number(file.size ?? up.size_bytes),
          file.md5Checksum ?? null,
          meta?.durationMillis ? Number(meta.durationMillis) : null,
          meta?.width ?? null,
          meta?.height ?? null,
          file.createdTime ? new Date(file.createdTime) : null,
          file.modifiedTime ? new Date(file.modifiedTime) : null,
        ],
        conn,
      );
      videoId = res.insertId;
    }
    await exec('UPDATE users SET storage_used_bytes = storage_used_bytes + ? WHERE id = ?', [Number(up.size_bytes), up.user_id], conn);
    await exec(
      "UPDATE uploads SET status = 'completed', received_bytes = size_bytes, drive_file_id = ?, video_id = ?, video_public_id = ?, error = NULL WHERE id = ?",
      [file.id, videoId, publicId, up.id],
      conn,
    );
    return { publicId, videoId, fresh: true };
  });
  if (result.fresh) {
    await enqueueJob('probe', { videoId: result.videoId });
    await audit(req, 'video.upload', { type: 'video', id: result.publicId }, { fileName: up.file_name, size: Number(up.size_bytes) });
  }
  return result.publicId;
}

async function markExpired(up: UploadRow, error = 'Sesi upload kedaluwarsa. Mulai upload lagi.'): Promise<void> {
  await exec("UPDATE uploads SET status = 'expired', error = ? WHERE id = ? AND status = 'uploading'", [error, up.id]);
}

/** Tanya Drive berapa byte yang sudah diterima (`PUT` kosong dengan `Content-Range: bytes * /total`). */
async function queryDrive(up: UploadRow): Promise<{ received: number; file?: DriveUploadedFile; gone?: boolean }> {
  const res = await request(decrypt(up.session_url_enc), {
    method: 'PUT',
    headers: { 'content-range': `bytes */${up.size_bytes}`, 'content-length': '0' },
    headersTimeout: 30_000,
    bodyTimeout: 30_000,
  });
  const text = await res.body.text();
  if (res.statusCode === 308) return { received: receivedFromRange(res.headers.range) };
  if (res.statusCode === 200 || res.statusCode === 201) return { received: Number(up.size_bytes), file: JSON.parse(text) as DriveUploadedFile };
  if (res.statusCode === 404 || res.statusCode === 410) return { received: 0, gone: true };
  throw new AppError(502, 'DRIVE_ERROR', `Google Drive membalas ${res.statusCode}`);
}

export async function uploadRoutes(app: FastifyInstance): Promise<void> {
  // Body chunk = stream mentah (TIDAK di-buffer); batas ukuran dicek manual dari Content-Length.
  app.addContentTypeParser('application/octet-stream', (_req, payload, done) => done(null, payload));

  app.post('/api/uploads', { preHandler: requireUser }, async (req, reply) => {
    const user = req.viewer.user!;
    if (!settings.get('upload.enabled')) throw new AppError(403, 'UPLOAD_DISABLED', 'Upload sedang dinonaktifkan oleh admin');
    const body = parse(initBody, req.body);
    const key = `u:${user.id}`;
    if (initLimiter.isBlocked(key)) throw tooMany('Terlalu banyak upload dimulai. Coba lagi dalam satu jam.');

    const fileName = cleanFileName(body.fileName);
    const ext = fileExtension(fileName);
    const allowed = settings.get('upload.allowed_ext');
    if (!ext || !allowed.includes(ext)) throw badRequest(`Format file tidak didukung. Gunakan: ${allowed.join(', ')}`);
    const maxBytes = settings.get('upload.max_file_gb') * GB;
    if (body.size > maxBytes) throw badRequest(`Ukuran file maksimal ${settings.get('upload.max_file_gb')} GB`);

    const active = await query<{ size_bytes: number }>(
      "SELECT size_bytes FROM uploads WHERE user_id = ? AND status = 'uploading' AND expires_at > UTC_TIMESTAMP()",
      [user.id],
    );
    if (active.length >= MAX_ACTIVE) throw conflict(`Maksimal ${MAX_ACTIVE} upload berjalan bersamaan. Tunggu salah satu selesai.`);
    const quota = user.storage_quota_bytes == null ? null : Number(user.storage_quota_bytes);
    if (quota != null) {
      const pending = active.reduce((a, u) => a + Number(u.size_bytes), 0);
      const used = Number(user.storage_used_bytes);
      if (used + pending + body.size > quota) {
        const freeGb = Math.max(0, (quota - used - pending) / GB);
        throw new AppError(413, 'QUOTA_EXCEEDED', `Kuota penyimpanan tidak cukup (sisa ${freeGb.toFixed(2)} GB). Hapus video lama atau hubungi admin.`);
      }
    }

    let folderId = settings.get('drive.root_folder_id');
    if (body.categoryId != null) {
      const cat = await queryOne<{ drive_folder_id: string; missing_at: Date | null }>('SELECT drive_folder_id, missing_at FROM categories WHERE id = ?', [body.categoryId]);
      if (!cat || cat.missing_at) throw badRequest('Kategori tidak ditemukan');
      folderId = cat.drive_folder_id;
    }
    if (!folderId) throw conflict('Folder Google Drive belum diatur oleh admin');

    const visibility = body.visibility ?? settings.get('upload.default_visibility');
    const videoPublicId = newVideoId();
    const mimeType = body.mimeType && body.mimeType.startsWith('video/') ? body.mimeType : (MIME_BY_EXT[ext] ?? 'application/octet-stream');
    let sessionUrl: string;
    try {
      sessionUrl = await createResumableSession({
        name: fileName,
        mimeType,
        size: body.size,
        parents: [folderId],
        appProperties: { dv: '1', dvVid: videoPublicId, dvOwner: String(user.id), dvVis: visibility },
      });
    } catch (err) {
      throw new AppError(502, 'DRIVE_ERROR', `Gagal memulai upload ke Google Drive${err instanceof Error ? `: ${err.message}` : ''}`);
    }
    initLimiter.hit(key);
    const publicId = newUploadId();
    await exec(
      `INSERT INTO uploads (public_id, user_id, video_public_id, file_name, mime_type, size_bytes, visibility, category_id, target_folder_id, session_url_enc, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [publicId, user.id, videoPublicId, fileName, mimeType, body.size, visibility, body.categoryId ?? null, folderId, encrypt(sessionUrl), new Date(Date.now() + SESSION_DAYS * 86400_000)],
    );
    reply.code(201);
    return publicUpload((await loadUpload(publicId, user.id))!);
  });

  /** Satu chunk: body mentah di-stream langsung ke sesi resumable Drive. */
  app.put<{ Params: { id: string } }>('/api/uploads/:id', { preHandler: requireUser }, async (req, reply) => {
    const up = await loadUpload(req.params.id, req.viewer.userId!);
    const stream = req.body as Readable | undefined;
    const drain = () => stream?.resume?.();
    if (up.status === 'completed') {
      drain();
      return publicUpload(up);
    }
    if (up.status !== 'uploading' || new Date(up.expires_at).getTime() < Date.now()) {
      drain();
      throw new AppError(410, 'UPLOAD_EXPIRED', up.error ?? 'Upload ini sudah tidak aktif. Mulai upload lagi.');
    }
    if (!stream || typeof stream.pipe !== 'function') throw badRequest('Kirim chunk sebagai application/octet-stream');
    const range = parseContentRange(req.headers['content-range']);
    const len = Number(req.headers['content-length']);
    const chunkMax = settings.get('upload.chunk_mb') * 1024 * 1024;
    if (!range || range.total !== Number(up.size_bytes) || !Number.isFinite(len) || len !== range.end - range.start + 1 || len > chunkMax) {
      drain();
      throw badRequest('Header Content-Range/Content-Length tidak valid');
    }
    if (range.start !== Number(up.received_bytes)) {
      drain();
      return reply.code(409).send({ error: { code: 'OFFSET_MISMATCH', message: 'Posisi chunk tidak sesuai', details: { received: Number(up.received_bytes) } } });
    }
    if (busy.has(up.public_id)) {
      drain();
      throw conflict('Chunk lain untuk upload ini sedang dikirim');
    }
    busy.add(up.public_id);
    try {
      let res;
      try {
        res = await request(decrypt(up.session_url_enc), {
          method: 'PUT',
          headers: { 'content-length': String(len), 'content-range': `bytes ${range.start}-${range.end}/${range.total}` },
          body: stream,
          headersTimeout: 120_000,
          bodyTimeout: 120_000,
        });
      } catch (err) {
        req.log.warn({ err, upload: up.public_id }, 'chunk upload ke Drive gagal');
        throw new AppError(502, 'DRIVE_ERROR', 'Koneksi ke Google Drive terputus. Upload akan dicoba lagi.');
      }
      const text = await res.body.text();
      if (res.statusCode === 308) {
        const received = receivedFromRange(res.headers.range);
        await exec('UPDATE uploads SET received_bytes = ? WHERE id = ?', [received, up.id]);
        return { ...publicUpload(up), received, done: false };
      }
      if (res.statusCode === 200 || res.statusCode === 201) {
        const file = JSON.parse(text) as DriveUploadedFile;
        const videoId = await finalize(req, up, file);
        return { ...publicUpload(up, videoId), received: Number(up.size_bytes), status: 'completed', done: true, videoId };
      }
      if (res.statusCode === 404 || res.statusCode === 410) {
        await markExpired(up);
        throw new AppError(410, 'UPLOAD_EXPIRED', 'Sesi upload di Google Drive sudah berakhir. Mulai upload lagi.');
      }
      if (res.statusCode >= 500 || res.statusCode === 429) throw new AppError(502, 'DRIVE_ERROR', `Google Drive sibuk (${res.statusCode}). Upload akan dicoba lagi.`);
      req.log.warn({ status: res.statusCode, body: text.slice(0, 300) }, 'chunk ditolak Drive');
      throw new AppError(502, 'DRIVE_ERROR', `Google Drive menolak chunk (${res.statusCode})`);
    } finally {
      busy.delete(up.public_id);
    }
  });

  /** Status (sinkron offset dengan Drive; menangani respons chunk terakhir yang hilang). */
  app.get<{ Params: { id: string } }>('/api/uploads/:id', { preHandler: requireUser }, async (req) => {
    const up = await loadUpload(req.params.id, req.viewer.userId!);
    if (up.status !== 'uploading') return publicUpload(up);
    if (new Date(up.expires_at).getTime() < Date.now()) {
      await markExpired(up);
      return publicUpload({ ...up, status: 'expired' });
    }
    try {
      const st = await queryDrive(up);
      if (st.gone) {
        await markExpired(up);
        return publicUpload({ ...up, status: 'expired', error: 'Sesi upload kedaluwarsa. Mulai upload lagi.' });
      }
      if (st.file) {
        const videoId = await finalize(req, up, st.file);
        return { ...publicUpload(up, videoId), status: 'completed', received: Number(up.size_bytes) };
      }
      if (st.received !== Number(up.received_bytes)) await exec('UPDATE uploads SET received_bytes = ? WHERE id = ?', [st.received, up.id]);
      return { ...publicUpload(up), received: st.received };
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(502, 'DRIVE_ERROR', 'Tidak dapat menghubungi Google Drive');
    }
  });

  app.delete<{ Params: { id: string } }>('/api/uploads/:id', { preHandler: requireUser }, async (req) => {
    const up = await loadUpload(req.params.id, req.viewer.userId!);
    if (up.status !== 'uploading') return { ok: true };
    try {
      const res = await request(decrypt(up.session_url_enc), { method: 'DELETE', headersTimeout: 15_000, bodyTimeout: 15_000 });
      await res.body.dump();
    } catch {
      /* best effort */
    }
    await exec("UPDATE uploads SET status = 'cancelled' WHERE id = ? AND status = 'uploading'", [up.id]);
    return { ok: true };
  });

  /** Upload saya yang belum selesai (untuk melanjutkan setelah halaman dimuat ulang). */
  app.get('/api/uploads', { preHandler: requireUser }, async (req, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const rows = await query<UploadRow>(
      "SELECT * FROM uploads WHERE user_id = ? AND status = 'uploading' AND expires_at > UTC_TIMESTAMP() ORDER BY id DESC LIMIT 20",
      [req.viewer.userId],
    );
    return { items: rows.map((r) => publicUpload(r)) };
  });
}

