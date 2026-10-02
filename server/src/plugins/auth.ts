import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config, isProd } from '../config.js';
import { exec, queryOne } from '../db.js';
import { randomToken, safeEqual, sha256Hex } from '../lib/crypto.js';
import { AppError, forbidden, unauthorized } from '../lib/errors.js';
import { settings } from '../modules/settings/service.js';
import type { Viewer } from './access.js';

export const COOKIE_SESSION = 'dv_sid';
export const COOKIE_CSRF = 'dv_csrf';
export const COOKIE_GUEST = 'dv_gid';
export const CSRF_HEADER = 'x-csrf-token';

const NON_REMEMBER_TTL_MS = 24 * 3600 * 1000;
const SLIDE_EVERY_MS = 3600 * 1000;
const GUEST_MAX_AGE_SEC = 400 * 24 * 3600;

export interface SessionUser {
  id: number;
  username: string;
  display_name: string;
  role: 'admin' | 'user';
  status: 'active' | 'disabled';
  avatar_color: string;
  storage_quota_bytes: number | null;
  storage_used_bytes: number;
}

export interface RequestViewer extends Viewer {
  user: SessionUser | null;
  sessionId: number | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    viewer: RequestViewer;
  }
}

const APP_ORIGIN = new URL(config.APP_URL).origin;

export const cookieBase = {
  path: '/',
  httpOnly: true,
  secure: isProd,
  sameSite: 'lax' as const,
};

const GUEST_VIEWER: RequestViewer = { userId: null, role: 'guest', guestHash: null, user: null, sessionId: null };

interface SessionRow extends SessionUser {
  session_id: number;
  remember: number;
  expires_at: Date;
  last_seen_at: Date;
}

async function resolveViewer(req: FastifyRequest): Promise<RequestViewer> {
  const gid = req.cookies[COOKIE_GUEST];
  const guestHash = gid && gid.length >= 32 && gid.length <= 64 ? sha256Hex(gid) : null;
  const sid = req.cookies[COOKIE_SESSION];
  if (!sid || sid.length < 32 || sid.length > 64) return { ...GUEST_VIEWER, guestHash };

  const row = await queryOne<SessionRow>(
    `SELECT s.id AS session_id, s.remember, s.expires_at, s.last_seen_at,
            u.id, u.username, u.display_name, u.role, u.status, u.avatar_color,
            u.storage_quota_bytes, u.storage_used_bytes
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP()`,
    [sha256Hex(sid)],
  );
  if (!row || row.status !== 'active') return { ...GUEST_VIEWER, guestHash };

  // Sliding expiry: perpanjang paling sering sekali per jam.
  const now = Date.now();
  if (now - new Date(row.last_seen_at).getTime() > SLIDE_EVERY_MS) {
    const ttl = row.remember ? settings.get('security.session_days') * 24 * 3600 * 1000 : NON_REMEMBER_TTL_MS;
    exec('UPDATE sessions SET last_seen_at = UTC_TIMESTAMP(), expires_at = ? WHERE id = ?', [
      new Date(now + ttl),
      row.session_id,
    ]).catch((err) => req.log.warn({ err }, 'gagal memperpanjang sesi'));
  }

  const { session_id, remember: _r, expires_at: _e, last_seen_at: _l, ...user } = row;
  return { userId: user.id, role: user.role, guestHash, user, sessionId: session_id };
}

/** Membuat sesi baru & menyetel cookie dv_sid. */
export async function createSession(
  req: FastifyRequest,
  reply: FastifyReply,
  userId: number,
  remember: boolean,
): Promise<void> {
  const token = randomToken(32);
  const ttlMs = remember ? settings.get('security.session_days') * 24 * 3600 * 1000 : NON_REMEMBER_TTL_MS;
  await exec(
    'INSERT INTO sessions (token_hash, user_id, remember, ip, user_agent, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    [sha256Hex(token), userId, remember ? 1 : 0, req.ip, (req.headers['user-agent'] ?? '').slice(0, 255), new Date(Date.now() + ttlMs)],
  );
  reply.setCookie(COOKIE_SESSION, token, {
    ...cookieBase,
    ...(remember ? { maxAge: Math.floor(ttlMs / 1000) } : {}),
  });
}

export async function destroySession(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (req.viewer.sessionId) await exec('DELETE FROM sessions WHERE id = ?', [req.viewer.sessionId]);
  reply.clearCookie(COOKIE_SESSION, { path: '/' });
}

/** Pastikan cookie dv_csrf ada (diterbitkan di GET /api/auth/me). */
export function ensureCsrfCookie(req: FastifyRequest, reply: FastifyReply): string {
  const existing = req.cookies[COOKIE_CSRF];
  if (existing && /^[A-Za-z0-9_-]{22}$/.test(existing)) return existing;
  const token = randomToken(16);
  reply.setCookie(COOKIE_CSRF, token, { path: '/', httpOnly: false, secure: isProd, sameSite: 'lax' });
  return token;
}

/** Id tamu (dv_gid); dibuat bila belum ada. Mengembalikan hash-nya. */
export function ensureGuestId(req: FastifyRequest, reply: FastifyReply): string {
  if (req.viewer.guestHash) return req.viewer.guestHash;
  const gid = randomToken(32);
  reply.setCookie(COOKIE_GUEST, gid, { ...cookieBase, maxAge: GUEST_MAX_AGE_SEC });
  req.viewer.guestHash = sha256Hex(gid);
  return req.viewer.guestHash;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function checkCsrf(req: FastifyRequest): void {
  const origin = req.headers.origin;
  if (origin && origin !== APP_ORIGIN) throw forbidden('Origin tidak diizinkan');
  const header = req.headers[CSRF_HEADER];
  const cookie = req.cookies[COOKIE_CSRF];
  if (typeof header !== 'string' || !cookie || !safeEqual(header, cookie)) {
    throw new AppError(403, 'CSRF', 'Token keamanan tidak valid. Muat ulang halaman lalu coba lagi.');
  }
}

export async function registerAuth(app: FastifyInstance): Promise<void> {
  app.decorateRequest('viewer', null as unknown as RequestViewer);

  app.addHook('onRequest', async (req) => {
    const path = req.url;
    if (path.startsWith('/api/') || path.startsWith('/stream/')) {
      req.viewer = await resolveViewer(req);
      if (path.startsWith('/api/') && !SAFE_METHODS.has(req.method)) checkCsrf(req);
    } else {
      req.viewer = { ...GUEST_VIEWER };
    }
  });
}

/** preHandler: wajib login. */
export async function requireUser(req: FastifyRequest): Promise<void> {
  if (!req.viewer.user) throw unauthorized();
}

/** preHandler: wajib admin. */
export async function requireAdmin(req: FastifyRequest): Promise<void> {
  if (!req.viewer.user) throw unauthorized();
  if (req.viewer.role !== 'admin') throw forbidden('Hanya admin yang dapat mengakses ini');
}

export function publicUser(u: SessionUser) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    role: u.role,
    avatarColor: u.avatar_color,
    storageUsedBytes: Number(u.storage_used_bytes),
    storageQuotaBytes: u.storage_quota_bytes == null ? null : Number(u.storage_quota_bytes),
  };
}
