import { query, queryOne } from '../../db.js';
import { avatarUrl } from '../../lib/images.js';
import { signedStreamUrl, viewerKey } from '../../lib/sign.js';
import { canEditVideo, type Viewer } from '../../plugins/access.js';
import { settings } from '../settings/service.js';

/** Kolom & join standar untuk daftar/detail video. */
export const VIDEO_SELECT = `
  SELECT v.id, v.public_id, v.title, v.duration_ms, v.thumb_key, v.view_count, v.published_at, v.visibility, v.status,
         v.owner_user_id, v.category_id, v.deleted_at, v.width, v.height, v.mime_type, v.container, v.video_codec,
         v.original_playable, v.storyboard, v.drive_file_id, v.size_bytes, v.bitrate_kbps, v.processing_error, v.source,
         u.username AS owner_username, u.display_name AS owner_name, u.avatar_color AS owner_color, u.avatar_key AS owner_avatar_key,
         c.slug AS category_slug, c.name AS category_name
    FROM videos v
    LEFT JOIN users u ON u.id = v.owner_user_id
    LEFT JOIN categories c ON c.id = v.category_id`;

export interface VideoRecord {
  id: number;
  public_id: string;
  title: string;
  duration_ms: number | null;
  thumb_key: string | null;
  view_count: number;
  published_at: Date;
  visibility: 'public' | 'private';
  status: 'pending' | 'processing' | 'ready' | 'failed' | 'missing';
  owner_user_id: number | null;
  category_id: number | null;
  deleted_at: Date | null;
  width: number | null;
  height: number | null;
  mime_type: string | null;
  container: string | null;
  video_codec: string | null;
  original_playable: number | null;
  storyboard: string | Storyboard | null;
  drive_file_id: string;
  size_bytes: number;
  bitrate_kbps: number | null;
  processing_error: string | null;
  source: 'drive' | 'upload';
  owner_username: string | null;
  owner_name: string | null;
  owner_color: string | null;
  owner_avatar_key?: string | null;
  category_slug: string | null;
  category_name: string | null;
}

export interface Storyboard {
  v: 1;
  interval: number;
  w: number;
  h: number;
  cols: number;
  rows: number;
  count: number;
  sheets: string[];
}

export interface Channel {
  name: string;
  handle: string;
  avatarColor: string;
  avatarUrl: string | null;
}

/** Avatar channel utama: favicon (persegi) → logo mode ikon → null (avatar huruf). */
export function mainChannelAvatar(): string | null {
  const touch = settings.get('site.touch_icon_url');
  if (touch) return touch;
  return settings.get('site.logo_mode') === 'icon' ? settings.get('site.logo_url') : null;
}

export function channelOf(
  v: Pick<VideoRecord, 'owner_user_id' | 'owner_username' | 'owner_name' | 'owner_color' | 'owner_avatar_key'>,
): Channel {
  if (v.owner_user_id && v.owner_username) {
    return {
      name: v.owner_name ?? v.owner_username,
      handle: v.owner_username,
      avatarColor: v.owner_color ?? '#5c6bc0',
      avatarUrl: avatarUrl(v.owner_user_id, v.owner_avatar_key),
    };
  }
  return {
    name: settings.get('site.channel_name'),
    handle: settings.get('site.channel_handle'),
    avatarColor: '#cc0000',
    avatarUrl: mainChannelAvatar(),
  };
}

export function thumbUrls(v: Pick<VideoRecord, 'public_id' | 'thumb_key'>) {
  if (!v.thumb_key) return null;
  const base = `/media/thumbs/${v.public_id}-${v.thumb_key}`;
  return { sd: `${base}-480.webp`, hd: `${base}-1280.webp`, og: `${base}-og.jpg` };
}

export function toSummary(v: VideoRecord, viewer: Viewer) {
  const isOwnerOrAdmin = viewer.role === 'admin' || (v.owner_user_id != null && v.owner_user_id === viewer.userId);
  const thumb = thumbUrls(v);
  return {
    id: v.public_id,
    title: v.title,
    durationSec: v.duration_ms != null ? Math.round(v.duration_ms / 1000) : null,
    thumb: thumb ? { sd: thumb.sd, hd: thumb.hd } : null,
    channel: channelOf(v),
    views: Number(v.view_count),
    publishedAt: new Date(v.published_at).toISOString(),
    visibility: v.visibility,
    ...(isOwnerOrAdmin ? { status: v.status } : {}),
    category: v.category_slug ? { slug: v.category_slug, name: v.category_name ?? '' } : null,
  };
}

export type VideoSummary = ReturnType<typeof toSummary>;

/** Label kualitas ala YouTube. */
export function qualityLabel(h: number): string {
  if (h >= 2160) return `${h}p 4K`;
  if (h >= 1080) return `${h}p HD`;
  return `${h}p`;
}

const shortSide = (w: number | null, h: number | null) => (w && h ? Math.min(w, h) : (h ?? w ?? 0));

/** Original dianggap bisa diputar bila hasil probe bilang ya, atau (belum diprobe) mime mp4/webm. */
export function originalPlayable(v: Pick<VideoRecord, 'original_playable' | 'mime_type'>): boolean {
  if (v.original_playable != null) return v.original_playable === 1;
  return v.mime_type === 'video/mp4' || v.mime_type === 'video/webm' || v.mime_type === 'video/x-m4v';
}

export function originalMime(v: Pick<VideoRecord, 'container' | 'mime_type'>): string {
  const c = v.container ?? '';
  if (c.includes('webm') || v.mime_type === 'video/webm') return 'video/webm';
  if (c.includes('mp4') || c.includes('mov') || v.mime_type === 'video/mp4' || v.mime_type === 'video/quicktime' || v.mime_type === 'video/x-m4v') {
    return 'video/mp4';
  }
  return v.mime_type ?? 'video/mp4';
}

export interface RenditionRow {
  id: number;
  height: number;
  width: number;
  real_height: number;
  kind: 'quality' | 'compat';
  drive_file_id: string | null;
  size_bytes: number;
  bitrate_kbps: number | null;
  status: string;
}

export async function readyRenditions(videoId: number): Promise<RenditionRow[]> {
  return query<RenditionRow>(
    "SELECT id, height, width, real_height, kind, drive_file_id, size_bytes, bitrate_kbps, status FROM video_renditions WHERE video_id = ? AND status = 'ready' ORDER BY height DESC",
    [videoId],
  );
}

export interface Source {
  q: string;
  label: string;
  height: number;
  width: number;
  url: string;
  mime: string;
  bitrateKbps: number | null;
  isOriginal: boolean;
}

/** Daftar sumber bertanda tangan (urut kualitas tertinggi dulu). */
export async function buildSources(v: VideoRecord, viewer: Viewer): Promise<{ sources: Source[]; expireAt: string }> {
  const vk = viewerKey(v.visibility, viewer.userId);
  const sources: Source[] = [];
  let exp = 0;
  const origH = shortSide(v.width, v.height);
  if (originalPlayable(v)) {
    const signed = signedStreamUrl(v.public_id, 'orig', vk);
    exp = signed.exp;
    sources.push({
      q: 'orig',
      label: origH ? qualityLabel(origH) : 'Asli',
      height: origH,
      width: v.width && v.height ? Math.max(v.width, v.height) : 0,
      url: signed.url,
      mime: originalMime(v),
      bitrateKbps: v.bitrate_kbps,
      isOriginal: true,
    });
  }
  for (const r of await readyRenditions(v.id)) {
    if (r.kind === 'quality' && sources.some((s) => s.height === r.height)) continue;
    const q = r.kind === 'compat' ? 'compat' : String(r.height);
    const signed = signedStreamUrl(v.public_id, q, vk);
    exp = signed.exp;
    sources.push({
      q,
      label: qualityLabel(r.height),
      height: r.height,
      width: r.width,
      url: signed.url,
      mime: 'video/mp4',
      bitrateKbps: r.bitrate_kbps,
      isOriginal: false,
    });
  }
  sources.sort((a, b) => b.height - a.height || (a.isOriginal ? -1 : 1));
  return { sources, expireAt: new Date((exp || Math.floor(Date.now() / 1000)) * 1000).toISOString() };
}

export function parseStoryboard(raw: VideoRecord['storyboard']): Storyboard | null {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw) as Storyboard;
  } catch {
    return null;
  }
}

export async function subtitlesFor(videoId: number) {
  const rows = await query<{ id: number; lang: string | null; label: string; is_default: number }>(
    'SELECT id, lang, label, is_default FROM subtitles WHERE video_id = ? ORDER BY is_default DESC, label',
    [videoId],
  );
  return rows.map((r) => ({ id: r.id, lang: r.lang, label: r.label, url: `/api/subtitles/${r.id}.vtt`, isDefault: r.is_default === 1 }));
}

export async function buildDetail(v: VideoRecord, viewer: Viewer) {
  const { sources, expireAt } = await buildSources(v, viewer);
  let resumeSec: number | null = null;
  if (viewer.userId) {
    const h = await queryOne<{ position_sec: number }>('SELECT position_sec FROM watch_history WHERE user_id = ? AND video_id = ?', [
      viewer.userId,
      v.id,
    ]);
    resumeSec = h?.position_sec ?? null;
  }
  return {
    ...toSummary(v, viewer),
    width: v.width ?? 0,
    height: v.height ?? 0,
    sources,
    sourcesExpireAt: expireAt,
    subtitles: await subtitlesFor(v.id),
    storyboard: parseStoryboard(v.storyboard),
    canEdit: canEditVideo(v, viewer),
    resumeSec,
    processing: v.status === 'pending' || v.status === 'processing',
  };
}

export async function findVideo(publicId: string): Promise<VideoRecord | null> {
  return queryOne<VideoRecord>(`${VIDEO_SELECT} WHERE v.public_id = ?`, [publicId]);
}
