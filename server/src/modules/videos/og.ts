import type { FastifyRequest } from 'fastify';
import { config } from '../../config.js';
import { isVideoId } from '../../lib/ids.js';
import { canWatch } from '../../plugins/access.js';
import { escapeHtml } from '../../plugins/spa.js';
import { settings } from '../settings/service.js';
import { findVideo, thumbUrls } from './model.js';

const GUEST = { userId: null, role: 'guest' as const, guestHash: null };

/** Meta OG/Twitter untuk link yang dibagikan (hanya konten publik). */
export async function ogMeta(req: FastifyRequest): Promise<string | null> {
  const url = new URL(req.url, 'http://x');
  if (url.pathname !== '/watch') return null;
  const id = url.searchParams.get('v');
  if (!isVideoId(id)) return null;
  const v = await findVideo(id);
  if (!v || !canWatch(v, GUEST)) return null;
  const site = settings.get('site.name');
  const title = escapeHtml(v.title);
  const thumb = thumbUrls(v);
  const pageUrl = `${config.APP_URL}/watch?v=${v.public_id}`;
  const tags = [
    `<title>${title} - ${escapeHtml(site)}</title>`,
    `<meta property="og:site_name" content="${escapeHtml(site)}" />`,
    `<meta property="og:type" content="video.other" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:url" content="${pageUrl}" />`,
    `<link rel="canonical" href="${pageUrl}" />`,
    `<meta name="twitter:card" content="${thumb ? 'summary_large_image' : 'summary'}" />`,
    `<meta name="twitter:title" content="${title}" />`,
  ];
  if (thumb) {
    tags.push(`<meta property="og:image" content="${config.APP_URL}${thumb.og}" />`, `<meta property="og:image:width" content="1280" />`, `<meta property="og:image:height" content="720" />`);
  }
  return tags.join('\n    ');
}
