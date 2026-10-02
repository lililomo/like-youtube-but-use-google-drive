import type { FastifyRequest } from 'fastify';
import { config } from '../../config.js';
import { isPlaylistId, isVideoId } from '../../lib/ids.js';
import { queryOne } from '../../db.js';
import { canWatch } from '../../plugins/access.js';
import { escapeHtml } from '../../plugins/spa.js';
import { settings } from '../settings/service.js';
import { findVideo, thumbUrls } from './model.js';

const GUEST = { userId: null, role: 'guest' as const, guestHash: null };

/** Meta OG/Twitter untuk link yang dibagikan (hanya konten publik). */
export async function ogMeta(req: FastifyRequest): Promise<string | null> {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/playlist') return playlistMeta(url.searchParams.get('list'));
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

/** OG untuk playlist publik (sampul = video publik pertama). */
async function playlistMeta(listId: string | null): Promise<string | null> {
  if (!isPlaylistId(listId)) return null;
  const p = await queryOne<{ id: number; title: string; visibility: string; item_count: number }>(
    'SELECT id, title, visibility, item_count FROM playlists WHERE public_id = ?',
    [listId],
  );
  if (!p || p.visibility !== 'public') return null;
  const first = await queryOne<{ public_id: string; thumb_key: string | null }>(
    `SELECT v.public_id, v.thumb_key FROM playlist_items pi JOIN videos v ON v.id = pi.video_id
      WHERE pi.playlist_id = ? AND v.deleted_at IS NULL AND v.status = 'ready' AND v.visibility = 'public'
      ORDER BY pi.position LIMIT 1`,
    [p.id],
  );
  const site = escapeHtml(settings.get('site.name'));
  const title = escapeHtml(p.title);
  const pageUrl = `${config.APP_URL}/playlist?list=${listId}`;
  const thumb = first ? thumbUrls(first) : null;
  const tags = [
    `<title>${title} - ${site}</title>`,
    `<meta property="og:site_name" content="${site}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:url" content="${pageUrl}" />`,
    `<link rel="canonical" href="${pageUrl}" />`,
    `<meta name="twitter:card" content="${thumb ? 'summary_large_image' : 'summary'}" />`,
  ];
  if (thumb) tags.push(`<meta property="og:image" content="${config.APP_URL}${thumb.og}" />`);
  return tags.join('\n    ');
}
