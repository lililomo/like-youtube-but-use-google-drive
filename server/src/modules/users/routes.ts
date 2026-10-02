import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { exec, query, queryOne, tx } from '../../db.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { MIN_PASSWORD_LENGTH, hashPassword } from '../../lib/password.js';
import { parse } from '../../lib/validate.js';
import { requireAdmin } from '../../plugins/auth.js';
import { audit } from '../audit/service.js';
import { avatarColorSchema } from '../auth/routes.js';
import { settings } from '../settings/service.js';

const GB = 1024 ** 3;
const AVATAR_COLORS = ['#5c6bc0', '#26a69a', '#ef6c00', '#8e24aa', '#00897b', '#3949ab', '#d81b60', '#6d4c41', '#43a047', '#f4511e'];

const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_.]{3,32}$/, 'Username 3–32 karakter: huruf kecil, angka, titik, garis bawah');
const passwordSchema = z.string().min(MIN_PASSWORD_LENGTH, `Password minimal ${MIN_PASSWORD_LENGTH} karakter`).max(256);
const quotaSchema = z.number().min(0).max(1_000_000).nullable();

const createBody = z.object({
  username: usernameSchema,
  displayName: z.string().trim().min(1).max(64),
  password: passwordSchema,
  role: z.enum(['admin', 'user']).default('user'),
  status: z.enum(['active', 'disabled']).default('active'),
  quotaGb: quotaSchema.optional(),
  avatarColor: avatarColorSchema.optional(),
});

const updateBody = z
  .object({
    displayName: z.string().trim().min(1).max(64).optional(),
    role: z.enum(['admin', 'user']).optional(),
    status: z.enum(['active', 'disabled']).optional(),
    quotaGb: quotaSchema.optional(),
    avatarColor: avatarColorSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Tidak ada perubahan');

const resetBody = z.object({ password: passwordSchema });
const deleteBody = z.object({ videos: z.enum(['delete', 'transfer']).default('transfer') });
const idParams = z.object({ id: z.coerce.number().int().positive() });

interface AdminUserRow {
  id: number;
  username: string;
  display_name: string;
  role: 'admin' | 'user';
  status: 'active' | 'disabled';
  avatar_color: string;
  storage_quota_bytes: number | null;
  storage_used_bytes: number;
  last_login_at: Date | null;
  created_at: Date;
  video_count: number;
}

const USER_SELECT = `
  SELECT u.id, u.username, u.display_name, u.role, u.status, u.avatar_color, u.storage_quota_bytes,
         u.storage_used_bytes, u.last_login_at, u.created_at,
         (SELECT COUNT(*) FROM videos v WHERE v.owner_user_id = u.id AND v.deleted_at IS NULL) AS video_count
    FROM users u`;

function toAdminUser(r: AdminUserRow) {
  return {
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    role: r.role,
    status: r.status,
    avatarColor: r.avatar_color,
    storageQuotaBytes: r.storage_quota_bytes == null ? null : Number(r.storage_quota_bytes),
    storageUsedBytes: Number(r.storage_used_bytes),
    videoCount: Number(r.video_count),
    lastLoginAt: r.last_login_at ? new Date(r.last_login_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

async function getUser(id: number) {
  const row = await queryOne<AdminUserRow>(`${USER_SELECT} WHERE u.id = ?`, [id]);
  if (!row) throw notFound('User tidak ditemukan');
  return row;
}

async function activeAdminCount(): Promise<number> {
  const row = await queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active'");
  return Number(row?.n ?? 0);
}

function quotaBytes(quotaGb: number | null | undefined): number | null | undefined {
  if (quotaGb === undefined) return undefined;
  if (quotaGb === null) return null;
  return Math.round(quotaGb * GB);
}

function assertNotSelf(req: FastifyRequest, id: number, what: string) {
  if (req.viewer.userId === id) throw forbidden(`Anda tidak bisa ${what} akun Anda sendiri`);
}

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/admin/users', { preHandler: requireAdmin }, async (req) => {
    const q = parse(z.object({ q: z.string().trim().max(64).optional() }), req.query);
    const rows = q.q
      ? await query<AdminUserRow>(`${USER_SELECT} WHERE u.username LIKE ? OR u.display_name LIKE ? ORDER BY u.id LIMIT 500`, [
          `%${q.q}%`,
          `%${q.q}%`,
        ])
      : await query<AdminUserRow>(`${USER_SELECT} ORDER BY u.id LIMIT 500`);
    return { items: rows.map(toAdminUser) };
  });

  app.get('/api/admin/users/:id', { preHandler: requireAdmin }, async (req) => {
    const { id } = parse(idParams, req.params);
    return { user: toAdminUser(await getUser(id)) };
  });

  app.post('/api/admin/users', { preHandler: requireAdmin }, async (req, reply) => {
    const body = parse(createBody, req.body);
    if (body.username === settings.get('site.channel_handle').toLowerCase()) {
      throw badRequest('Username tidak boleh sama dengan handle channel utama');
    }
    const exists = await queryOne('SELECT id FROM users WHERE username = ?', [body.username]);
    if (exists) throw conflict('Username sudah dipakai');
    const defaultQuota = settings.get('upload.default_quota_gb');
    const quota = body.quotaGb !== undefined ? quotaBytes(body.quotaGb) : quotaBytes(defaultQuota);
    const color = body.avatarColor ?? AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]!;
    const res = await exec(
      `INSERT INTO users (username, display_name, password_hash, role, status, avatar_color, storage_quota_bytes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [body.username, body.displayName, await hashPassword(body.password), body.role, body.status, color.toLowerCase(), quota ?? null],
    );
    await audit(req, 'user.create', { type: 'user', id: res.insertId }, { username: body.username, role: body.role });
    reply.code(201);
    return { user: toAdminUser(await getUser(res.insertId)) };
  });

  app.patch('/api/admin/users/:id', { preHandler: requireAdmin }, async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(updateBody, req.body);
    const target = await getUser(id);

    const demoting = body.role === 'user' && target.role === 'admin';
    const disabling = body.status === 'disabled' && target.status === 'active';
    if (demoting || disabling) {
      assertNotSelf(req, id, demoting ? 'menurunkan role' : 'menonaktifkan');
      if (target.role === 'admin' && target.status === 'active' && (await activeAdminCount()) <= 1) {
        throw forbidden('Harus ada minimal satu admin aktif');
      }
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (col: string, val: unknown) => {
      sets.push(`${col} = ?`);
      params.push(val);
    };
    if (body.displayName !== undefined) push('display_name', body.displayName);
    if (body.role !== undefined) push('role', body.role);
    if (body.status !== undefined) push('status', body.status);
    if (body.avatarColor !== undefined) push('avatar_color', body.avatarColor.toLowerCase());
    const quota = quotaBytes(body.quotaGb);
    if (quota !== undefined) push('storage_quota_bytes', quota);

    await exec(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
    if (disabling) await exec('DELETE FROM sessions WHERE user_id = ?', [id]);
    await audit(req, 'user.update', { type: 'user', id }, body);
    return { user: toAdminUser(await getUser(id)) };
  });

  app.post('/api/admin/users/:id/reset-password', { preHandler: requireAdmin }, async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(resetBody, req.body);
    await getUser(id);
    await exec('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(body.password), id]);
    // Paksa login ulang di semua perangkat (kecuali sesi admin sendiri bila mereset dirinya).
    await exec('DELETE FROM sessions WHERE user_id = ? AND id <> ?', [id, req.viewer.sessionId ?? 0]);
    await audit(req, 'user.reset_password', { type: 'user', id });
    return { ok: true };
  });

  app.delete('/api/admin/users/:id', { preHandler: requireAdmin }, async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(deleteBody, req.body ?? {});
    assertNotSelf(req, id, 'menghapus');
    const target = await getUser(id);
    if (target.role === 'admin' && target.status === 'active' && (await activeAdminCount()) <= 1) {
      throw forbidden('Harus ada minimal satu admin aktif');
    }

    // Penghapusan/peralihan file di Google Drive disambungkan di Step 14 (SPEC §11).
    const affected = await tx(async (conn) => {
      let n = 0;
      if (body.videos === 'transfer') {
        const res = await exec('UPDATE videos SET owner_user_id = NULL WHERE owner_user_id = ?', [id], conn);
        n = res.affectedRows;
      } else {
        const res = await exec(
          `UPDATE videos SET prev_status = status, status = 'missing', deleted_at = UTC_TIMESTAMP(), owner_user_id = NULL
            WHERE owner_user_id = ? AND deleted_at IS NULL`,
          [id],
          conn,
        );
        n = res.affectedRows;
      }
      await exec('DELETE FROM users WHERE id = ?', [id], conn);
      return n;
    });
    await audit(req, 'user.delete', { type: 'user', id }, { username: target.username, videos: body.videos, affected });
    return { ok: true, videosAffected: affected };
  });
}
