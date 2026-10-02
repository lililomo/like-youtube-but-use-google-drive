import type { FastifyInstance } from 'fastify';
import { settings } from '../settings/service.js';

/** Info situs publik untuk frontend (nama, logo, channel utama, tema default, flag fitur). */
export function siteInfo() {
  return {
    name: settings.get('site.name'),
    logoUrl: settings.get('site.logo_url'),
    faviconUrl: settings.get('site.favicon_url'),
    channelName: settings.get('site.channel_name'),
    channelHandle: settings.get('site.channel_handle'),
    defaultTheme: settings.get('site.default_theme'),
    guestPlaylists: settings.get('site.guest_playlists'),
    uploadEnabled: settings.get('upload.enabled'),
  };
}

export async function siteRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/site', async (_req, reply) => {
    reply.header('Cache-Control', 'no-cache');
    return siteInfo();
  });
}
