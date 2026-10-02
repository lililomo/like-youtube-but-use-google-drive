import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { exec, queryOne } from '../../db.js';
import { newAssetKey } from '../../lib/ids.js';
import { imageBody, registerImageParser, removePublic, renderAvatar, writePublic } from '../../lib/images.js';
import { notFound, unauthorized } from '../../lib/errors.js';
import { parse } from '../../lib/validate.js';
import { loadSessionUser, publicUser, requireAdmin, requireUser } from '../../plugins/auth.js';
import { audit } from '../audit/service.js';

/** Simpan foto profil baru untuk user; file lama dihapus. */
export async function setAvatar(userId: number, input: Buffer): Promise<string> {
  const webp = await renderAvatar(input);
  const key = newAssetKey().replace(/[^A-Za-z0-9]/g, '').slice(0, 12) || 'a';
  const name = `${userId}-${key}.webp`;
  await writePublic('avatars', name, webp);
  await exec('UPDATE users SET avatar_key = ? WHERE id = ?', [key, userId]);
  await removePublic('avatars', `${userId}-`, [name]);
  return key;
}

/** Hapus foto profil (kembali ke avatar huruf). */
export async function clearAvatar(userId: number): Promise<void> {
  await exec('UPDATE users SET avatar_key = NULL WHERE id = ?', [userId]);
  await removePublic('avatars', `${userId}-`);
}

export async function avatarRoutes(app: FastifyInstance): Promise<void> {
  registerImageParser(app);

  app.put('/api/me/avatar', { preHandler: requireUser }, async (req) => {
    const user = req.viewer.user;
    if (!user) throw unauthorized();
    await setAvatar(user.id, imageBody(req.body));
    await audit(req, 'user.avatar_update', { type: 'user', id: user.id });
    const fresh = await loadSessionUser(user.id);
    return { user: fresh ? publicUser(fresh) : null };
  });

  app.delete('/api/me/avatar', { preHandler: requireUser }, async (req) => {
    const user = req.viewer.user;
    if (!user) throw unauthorized();
    await clearAvatar(user.id);
    await audit(req, 'user.avatar_remove', { type: 'user', id: user.id });
    const fresh = await loadSessionUser(user.id);
    return { user: fresh ? publicUser(fresh) : null };
  });

  /** Admin: hapus foto profil user lain (moderasi). */
  app.delete('/api/admin/users/:id/avatar', { preHandler: requireAdmin }, async (req) => {
    const { id } = parse(z.object({ id: z.coerce.number().int().positive() }), req.params);
    const row = await queryOne('SELECT id FROM users WHERE id = ?', [id]);
    if (!row) throw notFound('User tidak ditemukan');
    await clearAvatar(id);
    await audit(req, 'user.avatar_remove', { type: 'user', id }, { by: 'admin' });
    return { ok: true };
  });
}
