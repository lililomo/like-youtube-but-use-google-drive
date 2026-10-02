import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { queryOne } from '../../db.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { parse } from '../../lib/validate.js';
import { requireAdmin } from '../../plugins/auth.js';
import { audit } from '../audit/service.js';
import { driveAuth } from '../drive/client.js';
import { settings, type SettingKey, type Settings } from './service.js';

const GROUPS = ['site', 'drive', 'processing', 'upload', 'player', 'security'] as const;
type Group = (typeof GROUPS)[number];

/** Field yang boleh diubah lewat PUT per grup (nama = akhiran kunci, mis. "name" → site.name). */
const SCHEMAS: Record<Group, z.ZodObject> = {
  site: z
    .object({
      name: z.string().trim().min(1).max(60),
      logo_mode: z.enum(['icon', 'full']),
      channel_name: z.string().trim().min(1).max(60),
      channel_handle: z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z0-9_.]{3,32}$/, 'Handle 3–32 karakter: huruf kecil, angka, titik, garis bawah'),
      default_theme: z.enum(['system', 'dark', 'light']),
      guest_playlists: z.boolean(),
    })
    .partial()
    .strict(),
  drive: z
    .object({
      auth_mode: z.enum(['oauth', 'service_account']),
      oauth_client_id: z.string().trim().max(300),
      oauth_client_secret: z.string().trim().max(300),
      include_subfolders: z.boolean(),
      sync_interval_sec: z.number().int().min(30).max(3600),
      full_sync_interval_min: z.number().int().min(30).max(10080),
    })
    .partial()
    .strict(),
  processing: z
    .object({
      enabled: z.boolean(),
      renditions: z
        .array(z.union([z.literal(1080), z.literal(720), z.literal(480), z.literal(360)]))
        .max(4)
        .refine((a) => new Set(a).size === a.length, 'Kualitas tidak boleh ganda'),
      compat_max_height: z.union([z.literal(720), z.literal(1080)]),
      storyboard: z.boolean(),
      x264_preset: z.enum(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium']),
      threads: z.number().int().min(1).max(16),
      nice: z.number().int().min(0).max(19),
      min_free_disk_gb: z.number().int().min(1).max(1000),
    })
    .partial()
    .strict(),
  upload: z
    .object({
      enabled: z.boolean(),
      max_file_gb: z.number().min(0.1).max(100),
      allowed_ext: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9]{2,5}$/)).min(1).max(30),
      chunk_mb: z.union([z.literal(8), z.literal(16), z.literal(32)]),
      default_visibility: z.enum(['public', 'private']),
      default_quota_gb: z.number().min(0).max(1_000_000).nullable(),
    })
    .partial()
    .strict(),
  player: z
    .object({
      autoplay_default: z.boolean(),
      seek_seconds: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(30)]),
      endscreen_countdown: z.number().int().min(0).max(20),
    })
    .partial()
    .strict(),
  security: z
    .object({
      session_days: z.number().int().min(1).max(365),
    })
    .partial()
    .strict(),
};

function allGroups() {
  return Object.fromEntries(GROUPS.map((g) => [g, settings.group(g)]));
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/admin/settings', { preHandler: requireAdmin }, async () => allGroups());

  app.put('/api/admin/settings/:group', { preHandler: requireAdmin }, async (req) => {
    const { group } = parse(z.object({ group: z.string() }), req.params);
    if (!(GROUPS as readonly string[]).includes(group)) throw notFound('Grup pengaturan tidak dikenal');
    const body = parse(SCHEMAS[group as Group], req.body) as Record<string, unknown>;

    const values: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(body)) values[`${group}.${name}`] = value;

    if (group === 'site' && typeof body.channel_handle === 'string') {
      const clash = await queryOne('SELECT id FROM users WHERE username = ?', [body.channel_handle]);
      if (clash) throw badRequest('Handle channel sudah dipakai sebagai username');
    }

    if (group === 'drive') {
      // Secret kosong = tidak diubah.
      if (values['drive.oauth_client_secret'] === '') delete values['drive.oauth_client_secret'];
      const newId = values['drive.oauth_client_id'];
      const clientChanged =
        (typeof newId === 'string' && newId !== settings.get('drive.oauth_client_id')) || 'drive.oauth_client_secret' in values;
      if (clientChanged) {
        // Refresh token terikat ke client lama → harus menghubungkan ulang.
        values['drive.oauth_refresh_token'] = '';
        values['drive.connected_email'] = null;
      }
    }

    await settings.set(values as Partial<{ [K in SettingKey]: Settings[K] }>);
    if (group === 'drive') driveAuth.reset();

    const logged = Object.fromEntries(
      Object.entries(body).map(([k, v]) => [k, k.includes('secret') ? '[disimpan]' : v]),
    );
    await audit(req, 'settings.update', { type: 'settings', id: group }, logged);
    return { [group]: settings.group(group) };
  });
}
