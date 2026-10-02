import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { newAssetKey } from '../../lib/ids.js';
import { imageBody, registerImageParser, removePublic, renderFavicon, renderLogo, writePublic } from '../../lib/images.js';
import { parse } from '../../lib/validate.js';
import { requireAdmin } from '../../plugins/auth.js';
import { audit } from '../audit/service.js';
import { settings } from '../settings/service.js';
import { siteInfo } from '../site/routes.js';

const slotParams = z.object({ slot: z.enum(['logo', 'logo_dark', 'favicon']) });
const logoQuery = z.object({ mode: z.enum(['icon', 'full']).optional() });

const fileKey = () => newAssetKey().replace(/[^A-Za-z0-9]/g, '').slice(0, 12) || 'b';

/** Logo, logo tema gelap & favicon situs (admin). File disimpan di storage/public/branding/. */
export async function brandingRoutes(app: FastifyInstance): Promise<void> {
  registerImageParser(app);

  app.put('/api/admin/branding/:slot', { preHandler: requireAdmin }, async (req) => {
    const { slot } = parse(slotParams, req.params);
    const input = imageBody(req.body);
    const key = fileKey();

    if (slot === 'favicon') {
      const { icon64, icon180 } = await renderFavicon(input);
      const n64 = `favicon-${key}-64.png`;
      const n180 = `favicon-${key}-180.png`;
      const url64 = await writePublic('branding', n64, icon64);
      const url180 = await writePublic('branding', n180, icon180);
      await settings.set({ 'site.favicon_url': url64, 'site.touch_icon_url': url180 });
      await removePublic('branding', 'favicon-', [n64, n180]);
    } else {
      const { mode } = parse(logoQuery, req.query);
      // Logo gelap mengikuti mode logo utama agar tampilan konsisten.
      const wanted = slot === 'logo_dark' ? settings.get('site.logo_mode') : mode;
      const out = await renderLogo(input, wanted);
      const prefix = slot === 'logo' ? 'logo-' : 'logodark-';
      const name = `${prefix}${key}.png`;
      const url = await writePublic('branding', name, out.png);
      if (slot === 'logo') await settings.set({ 'site.logo_url': url, 'site.logo_mode': out.mode });
      else await settings.set({ 'site.logo_dark_url': url });
      await removePublic('branding', prefix, [name]);
    }
    await audit(req, 'settings.branding', { type: 'settings', id: 'site' }, { slot, action: 'upload' });
    return { site: siteInfo() };
  });

  app.delete('/api/admin/branding/:slot', { preHandler: requireAdmin }, async (req) => {
    const { slot } = parse(slotParams, req.params);
    if (slot === 'favicon') {
      await settings.set({ 'site.favicon_url': null, 'site.touch_icon_url': null });
      await removePublic('branding', 'favicon-');
    } else if (slot === 'logo') {
      await settings.set({ 'site.logo_url': null, 'site.logo_mode': 'icon' });
      await removePublic('branding', 'logo-');
    } else {
      await settings.set({ 'site.logo_dark_url': null });
      await removePublic('branding', 'logodark-');
    }
    await audit(req, 'settings.branding', { type: 'settings', id: 'site' }, { slot, action: 'remove' });
    return { site: siteInfo() };
  });
}
