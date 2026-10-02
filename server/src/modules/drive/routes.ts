import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { exec, queryOne } from '../../db.js';
import { randomToken, sha256Hex } from '../../lib/crypto.js';
import { badRequest } from '../../lib/errors.js';
import { parse } from '../../lib/validate.js';
import { requireAdmin } from '../../plugins/auth.js';
import { audit } from '../audit/service.js';
import { settings } from '../settings/service.js';
import { parseFolderInput } from './classify.js';
import { about, DriveError, driveAuth, newOAuthClient, OAUTH_SCOPES, REDIRECT_URI, revokeToken } from './client.js';
import { configureRootFolder, driveStatus, folderStats } from './service.js';
import { runSync } from '../sync/service.js';

const STATE_TTL_MS = 10 * 60 * 1000;
const SETTINGS_PAGE = '/admin/settings/drive';

const folderBody = z.object({ folder: z.string().trim().min(1).max(500) });
const testBody = z.object({ folder: z.string().trim().max(500).optional() });
const saBody = z.object({ json: z.string().trim().min(10).max(20_000) });
const callbackQuery = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
});

function redirectToSettings(reply: FastifyReply, params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  return reply.redirect(`${SETTINGS_PAGE}?${qs}`, 302);
}

/** Pesan error Drive yang ramah. */
function driveErrorMessage(err: unknown): string {
  if (err instanceof DriveError) return err.message;
  return (err as Error)?.message ?? 'Terjadi kesalahan';
}

export async function driveRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/admin/drive/status', { preHandler: requireAdmin }, async () => ({ ...driveStatus(), redirectUri: REDIRECT_URI }));

  // --- OAuth -----------------------------------------------------------------
  app.post('/api/admin/drive/oauth/start', { preHandler: requireAdmin }, async (req) => {
    const clientId = settings.get('drive.oauth_client_id');
    const secret = settings.getSecret('drive.oauth_client_secret');
    if (!clientId || !secret) throw badRequest('Isi dan simpan Client ID serta Client Secret terlebih dahulu');
    const state = randomToken(24);
    await exec('DELETE FROM oauth_states WHERE expires_at < UTC_TIMESTAMP()');
    await exec('INSERT INTO oauth_states (state_hash, user_id, expires_at) VALUES (?, ?, ?)', [
      sha256Hex(state),
      req.viewer.userId,
      new Date(Date.now() + STATE_TTL_MS),
    ]);
    const authUrl = newOAuthClient(clientId, secret).generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: OAUTH_SCOPES,
      include_granted_scopes: true,
      state,
    });
    return { authUrl };
  });

  app.get('/api/admin/drive/oauth/callback', async (req, reply) => {
    const q = parse(callbackQuery, req.query);
    if (!req.viewer.user || req.viewer.role !== 'admin') {
      return reply.redirect(`/login?next=${encodeURIComponent(SETTINGS_PAGE)}`, 302);
    }
    if (q.error) return redirectToSettings(reply, { error: `Google menolak: ${q.error}` });
    if (!q.code || !q.state) return redirectToSettings(reply, { error: 'Parameter callback tidak lengkap' });

    const stateHash = sha256Hex(q.state);
    const row = await queryOne<{ user_id: number }>(
      'SELECT user_id FROM oauth_states WHERE state_hash = ? AND expires_at > UTC_TIMESTAMP()',
      [stateHash],
    );
    await exec('DELETE FROM oauth_states WHERE state_hash = ?', [stateHash]);
    if (!row || row.user_id !== req.viewer.userId) {
      return redirectToSettings(reply, { error: 'Sesi otorisasi kedaluwarsa atau tidak valid. Coba hubungkan lagi.' });
    }

    try {
      const client = newOAuthClient(settings.get('drive.oauth_client_id'), settings.getSecret('drive.oauth_client_secret'));
      const { tokens } = await client.getToken(q.code);
      if (!tokens.refresh_token) {
        return redirectToSettings(reply, {
          error: 'Google tidak memberikan refresh token. Hapus akses aplikasi di myaccount.google.com/permissions lalu hubungkan lagi.',
        });
      }
      if (tokens.scope && !tokens.scope.includes('auth/drive')) {
        return redirectToSettings(reply, { error: 'Izin akses Google Drive tidak diberikan. Centang izin Drive saat menghubungkan.' });
      }
      await settings.set({ 'drive.oauth_refresh_token': tokens.refresh_token, 'drive.auth_mode': 'oauth', 'drive.last_sync_error': null });
      driveAuth.reset();
      const info = await about();
      const email = info.user?.emailAddress ?? null;
      await settings.set({ 'drive.connected_email': email });
      await audit(req, 'drive.connect', null, { email });
      return redirectToSettings(reply, { connected: '1' });
    } catch (err) {
      req.log.warn({ err }, 'oauth callback gagal');
      return redirectToSettings(reply, { error: `Gagal menghubungkan: ${driveErrorMessage(err)}` });
    }
  });

  app.post('/api/admin/drive/disconnect', { preHandler: requireAdmin }, async (req) => {
    const refresh = settings.getSecret('drive.oauth_refresh_token');
    if (refresh) await revokeToken(refresh);
    await settings.set({ 'drive.oauth_refresh_token': '', 'drive.connected_email': null });
    driveAuth.reset();
    await audit(req, 'drive.disconnect');
    return driveStatus();
  });

  // --- Service account -------------------------------------------------------
  app.post('/api/admin/drive/service-account', { preHandler: requireAdmin }, async (req) => {
    const body = parse(saBody, req.body);
    let cred: { type?: string; client_email?: string; private_key?: string };
    try {
      cred = JSON.parse(body.json);
    } catch {
      throw badRequest('JSON tidak valid');
    }
    if (cred.type !== 'service_account' || !cred.client_email || !cred.private_key) {
      throw badRequest('Bukan file kunci Service Account (butuh type, client_email, private_key)');
    }
    const prev = {
      mode: settings.get('drive.auth_mode'),
      json: settings.getSecret('drive.service_account_json'),
      email: settings.get('drive.service_account_email'),
    };
    await settings.set({
      'drive.service_account_json': body.json,
      'drive.service_account_email': cred.client_email,
      'drive.auth_mode': 'service_account',
    });
    driveAuth.reset();
    try {
      await driveAuth.token(true);
    } catch (err) {
      await settings.set({
        'drive.service_account_json': prev.json,
        'drive.service_account_email': prev.email,
        'drive.auth_mode': prev.mode,
      });
      driveAuth.reset();
      throw badRequest(`Kunci Service Account ditolak Google: ${driveErrorMessage(err)}`);
    }
    await audit(req, 'drive.service_account', null, { email: cred.client_email });
    return driveStatus();
  });

  // --- Folder ----------------------------------------------------------------
  app.post('/api/admin/drive/test', { preHandler: requireAdmin }, async (req) => {
    const body = parse(testBody, req.body ?? {});
    const folderId = body.folder ? parseFolderInput(body.folder) : settings.get('drive.root_folder_id');
    if (body.folder && !folderId) throw badRequest('URL/ID folder tidak dikenali');
    try {
      const info = await about();
      const stats = folderId ? await folderStats(folderId, { includeSubfolders: settings.get('drive.include_subfolders') }) : null;
      return {
        ok: true,
        account: info.user?.emailAddress ?? settings.get('drive.service_account_email'),
        stats,
      };
    } catch (err) {
      if (err instanceof DriveError) throw badRequest(err.message);
      throw err;
    }
  });

  app.post('/api/admin/drive/folder', { preHandler: requireAdmin }, async (req) => {
    const body = parse(folderBody, req.body);
    const folderId = parseFolderInput(body.folder);
    if (!folderId) throw badRequest('URL/ID folder tidak dikenali. Tempel URL folder dari Google Drive.');
    try {
      const result = await configureRootFolder(folderId);
      await audit(req, 'drive.folder', { type: 'drive_folder', id: folderId }, { name: result.folder.name, changed: result.changed });
      void runSync('full');
      return { ...result, status: driveStatus() };
    } catch (err) {
      if (err instanceof DriveError) throw badRequest(err.message);
      throw err;
    }
  });
}
