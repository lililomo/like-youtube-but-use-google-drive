/**
 * Link YouTube → ID video (11 karakter) dan/atau ID playlist (`list=`).
 * Didukung: watch?v=, youtu.be/, shorts/, live/, embed/, playlist?list=, m./music./nocookie, ID video polos, ID playlist polos (PL…).
 */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID = /^[A-Za-z0-9_-]{10,64}$/;
const BARE_PLAYLIST = /^(PL|OL|UU|FL)[A-Za-z0-9_-]{10,62}$/;
const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);

export interface YoutubeLink {
  videoId: string | null;
  playlistId: string | null;
}

export function parseYoutubeLink(input: string): YoutubeLink | null {
  const s = input.trim();
  if (VIDEO_ID.test(s)) return { videoId: s, playlistId: null };
  if (BARE_PLAYLIST.test(s)) return { videoId: null, playlistId: s };
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  let videoId: string | null = null;
  if (host === 'youtu.be') videoId = url.pathname.split('/')[1] ?? null;
  else if (HOSTS.has(host)) {
    if (url.pathname === '/watch') videoId = url.searchParams.get('v');
    else {
      const m = /^\/(?:shorts|live|embed|v)\/([^/?#]+)/.exec(url.pathname);
      videoId = m?.[1] ?? null;
    }
  } else return null;
  const list = url.searchParams.get('list');
  const out = { videoId: videoId && VIDEO_ID.test(videoId) ? videoId : null, playlistId: list && PLAYLIST_ID.test(list) ? list : null };
  return out.videoId || out.playlistId ? out : null;
}

/** ID video saja (kompatibel dengan pemakaian lama). */
export const parseYoutubeId = (input: string): string | null => parseYoutubeLink(input)?.videoId ?? null;

/** Alasan bila playlist tidak bisa diimpor (Mix/Radio tak berujung; Tonton Nanti/Disukai butuh login), atau null. */
export function unsupportedPlaylistReason(id: string): string | null {
  if (id.startsWith('RD')) return 'Mix/Radio YouTube (daftar otomatis tanpa akhir) tidak didukung — pakai link playlist biasa';
  if (['WL', 'LL', 'LM'].includes(id)) return 'Playlist pribadi (Tonton Nanti/Disukai) butuh login YouTube';
  return null;
}

export const canonicalUrl = (id: string): string => `https://www.youtube.com/watch?v=${id}`;
export const playlistUrl = (id: string): string => `https://www.youtube.com/playlist?list=${id}`;

/** Pecah teks (satu link per baris / dipisah spasi atau koma). */
export function splitLinks(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}
