import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../config.js';
import { exec, queryOne } from '../../db.js';
import { safeEqual } from '../../lib/crypto.js';
import { errorBody } from '../../lib/errors.js';
import { isVideoId } from '../../lib/ids.js';
import { LruCache } from '../../lib/lru.js';
import { normalizeRange } from '../../lib/range.js';
import { verifyStream, viewerKey } from '../../lib/sign.js';
import { canWatch } from '../../plugins/access.js';
import { DriveError, mediaRequest } from '../drive/client.js';
import { findVideo, originalMime, originalPlayable, type VideoRecord } from '../videos/model.js';

const MAX_STREAMS_PER_IP = 8;
const active = new Map<string, number>();
// TTL pendek: perubahan visibilitas lewat jalur mana pun cepat berlaku; jalur aplikasi memanggil invalidateStreamCache().
const videoCache = new LruCache<string, VideoRecord | null>(2000, 10_000);
const renditionCache = new LruCache<string, { drive_file_id: string; size_bytes: number } | null>(5000, 10_000);

/** Bersihkan cache video (dipanggil saat video berubah). */
export function invalidateStreamCache(publicId: string): void {
  videoCache.delete(publicId);
  for (const q of ['compat', '1080', '720', '480', '360']) renditionCache.delete(`${publicId}:${q}`);
}

async function cachedVideo(publicId: string): Promise<VideoRecord | null> {
  const hit = videoCache.get(publicId);
  if (hit !== undefined) return hit;
  const v = await findVideo(publicId);
  videoCache.set(publicId, v);
  return v;
}

async function resolveFile(v: VideoRecord, q: string): Promise<{ fileId: string; size: number; mime: string } | null> {
  if (q === 'orig') {
    return originalPlayable(v) ? { fileId: v.drive_file_id, size: Number(v.size_bytes), mime: originalMime(v) } : null;
  }
  const key = `${v.public_id}:${q}`;
  let r = renditionCache.get(key);
  if (r === undefined) {
    r = await (q === 'compat'
      ? queryOne<{ drive_file_id: string; size_bytes: number }>(
          "SELECT drive_file_id, size_bytes FROM video_renditions WHERE video_id = ? AND kind = 'compat' AND status = 'ready' LIMIT 1",
          [v.id],
        )
      : queryOne<{ drive_file_id: string; size_bytes: number }>(
          "SELECT drive_file_id, size_bytes FROM video_renditions WHERE video_id = ? AND height = ? AND kind = 'quality' AND status = 'ready'",
          [v.id, Number(q)],
        ));
    renditionCache.set(key, r);
  }
  return r?.drive_file_id ? { fileId: r.drive_file_id, size: Number(r.size_bytes), mime: 'video/mp4' } : null;
}

const PASS_HEADERS = ['content-length', 'content-range', 'etag', 'last-modified'];

const DRIVE_AUTH_REASONS = new Set(['INVALID_GRANT', 'NOT_CONNECTED', 'NOT_CONFIGURED']);
const DRIVE_QUOTA_REASONS = new Set(['downloadQuotaExceeded', 'userRateLimitExceeded', 'rateLimitExceeded', 'quotaExceeded']);

/** Kode error stream untuk pemutar (dibaca lewat fetch karena elemen video menyamakan semua error HTTP jadi "format tidak didukung"). */
export function upstreamError(err: DriveError): [number, string, string] {
  if (DRIVE_AUTH_REASONS.has(err.reason)) {
    return [503, 'DRIVE_AUTH', 'Server sedang tidak terhubung ke Google Drive, jadi video belum bisa diputar. Admin perlu menghubungkan ulang Google Drive.'];
  }
  if (err.status === 429 || DRIVE_QUOTA_REASONS.has(err.reason)) {
    return [503, 'DRIVE_QUOTA', 'Batas unduhan Google Drive untuk video ini sedang tercapai. Coba lagi nanti.'];
  }
  return [502, 'UPSTREAM', 'Gagal mengambil video dari Google Drive. Coba lagi nanti.'];
}

/** Proxy media Drive → klien dengan Range; batalkan upstream saat klien putus. */
async function pipeMedia(
  req: FastifyRequest,
  reply: FastifyReply,
  fileId: string,
  mime: string,
  onMissing?: () => void,
): Promise<FastifyReply> {
  const range = normalizeRange(req.headers.range);
  if (range === null) return reply.code(416).send(errorBody('BAD_RANGE', 'Range tidak valid'));
  const ac = new AbortController();
  req.raw.on('close', () => {
    if (!reply.raw.writableFinished) ac.abort();
  });
  let upstream;
  try {
    upstream = await mediaRequest(fileId, {
      range,
      ifRange: typeof req.headers['if-range'] === 'string' ? req.headers['if-range'] : undefined,
      signal: ac.signal,
    });
  } catch (err) {
    if (ac.signal.aborted) return reply;
    if (err instanceof DriveError) {
      if (err.status === 404) {
        onMissing?.();
        return reply.code(404).send(errorBody('NOT_FOUND', 'File video tidak ditemukan di Google Drive'));
      }
      if (err.status === 416) return reply.code(416).send(errorBody('BAD_RANGE', 'Range di luar ukuran file'));
      req.log.warn({ err: err.message, status: err.status }, 'stream upstream gagal');
      const [status, code, message] = upstreamError(err);
      return reply.code(status).send(errorBody(code, message));
    }
    throw err;
  }
  reply.code(upstream.statusCode);
  for (const h of PASS_HEADERS) {
    const val = upstream.headers[h];
    if (val !== undefined) reply.header(h, Array.isArray(val) ? val[0] : val);
  }
  reply.header('content-type', mime);
  reply.header('accept-ranges', 'bytes');
  reply.header('cache-control', 'private, max-age=3600');
  reply.header('x-content-type-options', 'nosniff');
  upstream.body.on('error', (err) => {
    if (!ac.signal.aborted) req.log.warn({ err: err.message }, 'stream terputus');
  });
  return reply.send(upstream.body);
}

const LOCALHOST = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export async function streamRoutes(app: FastifyInstance): Promise<void> {
  app.route<{ Params: { publicId: string; file: string }; Querystring: { e?: string; s?: string } }>({
    method: ['GET', 'HEAD'],
    url: '/stream/:publicId/:file',
    handler: async (req, reply) => {
      const { publicId, file } = req.params;
      const qm = /^(orig|compat|1080|720|480|360|1440|2160)\.mp4$/.exec(file);
      if (!isVideoId(publicId) || !qm) return reply.code(404).send(errorBody('NOT_FOUND', 'Tidak ditemukan'));
      const q = qm[1]!;

      const v = await cachedVideo(publicId);
      if (!v) return reply.code(404).send(errorBody('NOT_FOUND', 'Tidak ditemukan'));
      const sig = verifyStream(publicId, q, req.query.e, req.query.s, viewerKey(v.visibility, req.viewer.userId));
      if (sig !== 'ok') {
        return reply.code(403).send(errorBody(sig === 'expired' ? 'STREAM_EXPIRED' : 'STREAM_FORBIDDEN', 'Tautan video kedaluwarsa atau tidak valid'));
      }
      if (!canWatch(v, req.viewer)) return reply.code(404).send(errorBody('VIDEO_UNAVAILABLE', 'Video tidak tersedia'));

      const target = await resolveFile(v, q);
      if (!target) return reply.code(404).send(errorBody('NOT_FOUND', 'Kualitas ini belum tersedia'));

      if (req.method === 'HEAD') {
        return reply
          .code(200)
          .headers({
            'content-type': target.mime,
            'content-length': String(target.size),
            'accept-ranges': 'bytes',
            'cache-control': 'private, max-age=3600',
          })
          .send();
      }

      const ip = req.ip;
      const n = active.get(ip) ?? 0;
      if (n >= MAX_STREAMS_PER_IP) return reply.code(429).send(errorBody('TOO_MANY_STREAMS', 'Terlalu banyak video diputar bersamaan'));
      active.set(ip, n + 1);
      reply.raw.on('close', () => {
        const left = (active.get(ip) ?? 1) - 1;
        if (left <= 0) active.delete(ip);
        else active.set(ip, left);
      });

      return pipeMedia(req, reply, target.fileId, target.mime, () => {
        if (q === 'orig') {
          void exec(
            "UPDATE videos SET prev_status = status, status = 'missing', deleted_at = UTC_TIMESTAMP() WHERE id = ? AND deleted_at IS NULL",
            [v.id],
          );
          invalidateStreamCache(publicId);
        }
      });
    },
  });

  /** Proxy internal untuk ffmpeg/ffprobe: hanya dari localhost, tanpa lewat nginx, dengan token. */
  app.route<{ Params: { fileId: string } }>({
    method: ['GET', 'HEAD'],
    url: '/internal/drive/:fileId',
    handler: async (req, reply) => {
      const remote = req.socket.remoteAddress ?? '';
      const token = req.headers['x-internal-token'];
      if (
        !LOCALHOST.has(remote) ||
        req.headers['x-forwarded-for'] ||
        req.headers['x-real-ip'] ||
        typeof token !== 'string' ||
        !safeEqual(token, config.INTERNAL_TOKEN) ||
        !/^[A-Za-z0-9_-]{10,}$/.test(req.params.fileId)
      ) {
        return reply.code(404).send(errorBody('NOT_FOUND', 'Tidak ditemukan'));
      }
      return pipeMedia(req, reply, req.params.fileId, 'application/octet-stream');
    },
  });
}
