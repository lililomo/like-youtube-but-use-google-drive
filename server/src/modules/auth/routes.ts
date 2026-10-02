import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { exec, queryOne } from '../../db.js';
import { AppError, badRequest, forbidden, unauthorized } from '../../lib/errors.js';
import { AttemptLimiter } from '../../lib/limiter.js';
import { MIN_PASSWORD_LENGTH, hashPassword, verifyDummy, verifyPassword } from '../../lib/password.js';
import { parse } from '../../lib/validate.js';
import {
  createSession,
  destroySession,
  ensureCsrfCookie,
  publicUser,
  requireUser,
} from '../../plugins/auth.js';
import { audit } from '../audit/service.js';

/** 10 kegagalan / 15 menit, per IP dan per username (SPEC §12). */
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const loginLimiterIp = new AttemptLimiter(10, LOGIN_WINDOW_MS);
export const loginLimiterUser = new AttemptLimiter(10, LOGIN_WINDOW_MS);

const loginBody = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
  remember: z.boolean().optional().default(false),
});

const passwordBody = z.object({
  current: z.string().min(1).max(256),
  next: z.string().min(MIN_PASSWORD_LENGTH, `Password minimal ${MIN_PASSWORD_LENGTH} karakter`).max(256),
});

export const avatarColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Warna harus format #rrggbb');

const meBody = z
  .object({
    displayName: z.string().trim().min(1).max(64).optional(),
    avatarColor: avatarColorSchema.optional(),
  })
  .refine((v) => v.displayName !== undefined || v.avatarColor !== undefined, 'Tidak ada perubahan');

interface LoginUserRow {
  id: number;
  username: string;
  password_hash: string;
  status: 'active' | 'disabled';
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/auth/me', async (req, reply) => {
    ensureCsrfCookie(req, reply);
    reply.header('Cache-Control', 'no-store');
    const user = req.viewer.user;
    return { user: user ? publicUser(user) : null, guest: !user };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = parse(loginBody, req.body);
    const username = body.username.toLowerCase();
    const ipKey = `ip:${req.ip}`;
    const userKey = `u:${username}`;

    if (loginLimiterIp.isBlocked(ipKey) || loginLimiterUser.isBlocked(userKey)) {
      const wait = Math.max(loginLimiterIp.retryAfterSec(ipKey), loginLimiterUser.retryAfterSec(userKey));
      reply.header('Retry-After', String(wait));
      throw new AppError(429, 'TOO_MANY_ATTEMPTS', `Terlalu banyak percobaan login. Coba lagi dalam ${Math.ceil(wait / 60)} menit.`);
    }

    const row = await queryOne<LoginUserRow>('SELECT id, username, password_hash, status FROM users WHERE username = ?', [
      username,
    ]);
    const ok = row ? await verifyPassword(row.password_hash, body.password) : await verifyDummy(body.password);

    if (!row || !ok) {
      loginLimiterIp.hit(ipKey);
      loginLimiterUser.hit(userKey);
      await audit(req, 'login.fail', null, { username }, row?.id ?? null);
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Username atau password salah');
    }
    if (row.status !== 'active') {
      await audit(req, 'login.disabled', { type: 'user', id: row.id }, null, row.id);
      throw forbidden('Akun ini dinonaktifkan. Hubungi admin.');
    }

    loginLimiterUser.reset(userKey);
    await createSession(req, reply, row.id, body.remember);
    await exec('UPDATE users SET last_login_at = UTC_TIMESTAMP() WHERE id = ?', [row.id]);
    await audit(req, 'login.success', { type: 'user', id: row.id }, null, row.id);

    const user = await queryOne<Parameters<typeof publicUser>[0]>(
      `SELECT id, username, display_name, role, status, avatar_color, storage_quota_bytes, storage_used_bytes
         FROM users WHERE id = ?`,
      [row.id],
    );
    return { user: user ? publicUser(user) : null };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.viewer.user) await audit(req, 'logout');
    await destroySession(req, reply);
    return { ok: true };
  });

  app.post('/api/auth/password', { preHandler: requireUser }, async (req) => {
    const body = parse(passwordBody, req.body);
    const user = req.viewer.user;
    if (!user) throw unauthorized();
    const row = await queryOne<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', [user.id]);
    if (!row || !(await verifyPassword(row.password_hash, body.current))) {
      throw badRequest('Password saat ini salah');
    }
    if (body.current === body.next) throw badRequest('Password baru harus berbeda');
    await exec('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(body.next), user.id]);
    // Keluarkan sesi lain; sesi saat ini tetap.
    await exec('DELETE FROM sessions WHERE user_id = ? AND id <> ?', [user.id, req.viewer.sessionId ?? 0]);
    await audit(req, 'user.password_change', { type: 'user', id: user.id });
    return { ok: true };
  });

  app.patch('/api/me', { preHandler: requireUser }, async (req) => {
    const body = parse(meBody, req.body);
    const user = req.viewer.user;
    if (!user) throw unauthorized();
    const sets: string[] = [];
    const params: unknown[] = [];
    if (body.displayName !== undefined) {
      sets.push('display_name = ?');
      params.push(body.displayName);
    }
    if (body.avatarColor !== undefined) {
      sets.push('avatar_color = ?');
      params.push(body.avatarColor.toLowerCase());
    }
    await exec(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...params, user.id]);
    await audit(req, 'user.profile_update', { type: 'user', id: user.id }, body);
    const fresh = await queryOne<Parameters<typeof publicUser>[0]>(
      `SELECT id, username, display_name, role, status, avatar_color, storage_quota_bytes, storage_used_bytes
         FROM users WHERE id = ?`,
      [user.id],
    );
    return { user: fresh ? publicUser(fresh) : null };
  });
}
