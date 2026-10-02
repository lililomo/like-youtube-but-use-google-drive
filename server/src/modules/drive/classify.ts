/** Klasifikasi file Drive & util nama (SPEC §8.1–8.2). Murni → mudah dites. */

export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const SYSTEM_FOLDER_NAME = '_dymasvideo_system';
export const RENDITIONS_FOLDER_NAME = 'renditions';
export const SUBTITLE_EXT = ['srt', 'vtt'] as const;

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  md5Checksum?: string;
  parents?: string[];
  trashed?: boolean;
  createdTime?: string;
  modifiedTime?: string;
  appProperties?: Record<string, string>;
  videoMediaMetadata?: { width?: number; height?: number; durationMillis?: string };
  driveId?: string;
}

export function fileExtension(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 && i < name.length - 1 ? name.slice(i + 1).toLowerCase() : '';
}

/** Judul = nama file tanpa ekstensi terakhir ("Film.Bagus.2024.mp4" → "Film.Bagus.2024"). */
export function titleFromName(name: string): string {
  const ext = fileExtension(name);
  const base = ext ? name.slice(0, -(ext.length + 1)) : name;
  return base.trim() || name.trim();
}

/** Teks pencarian: lowercase, "_", ".", "-" diganti spasi. */
export function searchTextFrom(title: string): string {
  return title
    .toLowerCase()
    .replace(/[_.\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600);
}

export const isFolder = (f: Pick<DriveFile, 'mimeType'>): boolean => f.mimeType === FOLDER_MIME;

/** Folder diabaikan: folder sistem & nama diawali "_" atau ".". */
export function isIgnoredFolder(f: Pick<DriveFile, 'name' | 'appProperties'>): boolean {
  if (f.appProperties?.dvRole) return true;
  return f.name.startsWith('_') || f.name.startsWith('.');
}

export function isVideoFile(f: Pick<DriveFile, 'name' | 'mimeType' | 'appProperties'>, allowedExt: readonly string[]): boolean {
  if (isFolder(f) || f.appProperties?.dvRole) return false;
  if (f.mimeType.startsWith('video/')) return true;
  return allowedExt.includes(fileExtension(f.name));
}

export function isSubtitleFile(f: Pick<DriveFile, 'name' | 'mimeType'>): boolean {
  return !isFolder(f) && (SUBTITLE_EXT as readonly string[]).includes(fileExtension(f.name));
}

const LANG_RE = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

export interface SubtitleMatch {
  /** Judul video yang dicocokkan. */
  title: string;
  lang: string | null;
}

/**
 * Cocokkan nama subtitle ke judul video di folder yang sama.
 * "Judul.srt" → {Judul, null}; "Judul.id.srt" → {Judul, id}; "Judul.en.forced.vtt" → {Judul, en}.
 * Mengembalikan null bila tidak ada judul yang cocok.
 */
export function matchSubtitle(subtitleName: string, videoTitles: ReadonlySet<string>): SubtitleMatch | null {
  const base = titleFromName(subtitleName);
  if (videoTitles.has(base)) return { title: base, lang: null };
  const parts = base.split('.');
  // Coba dari yang terpanjang: "<judul>.<lang>.<apa saja>" atau "<judul>.<lang>"
  for (let i = parts.length - 1; i >= 1; i--) {
    const title = parts.slice(0, i).join('.');
    const lang = parts[i] ?? '';
    if (videoTitles.has(title) && LANG_RE.test(lang)) return { title, lang: lang.toLowerCase() };
  }
  return null;
}

/** Label bahasa dalam Bahasa Indonesia ("id" → "Indonesia", "en" → "Inggris"). */
export function languageLabel(lang: string | null): string {
  if (!lang) return 'Subtitle';
  try {
    const name = new Intl.DisplayNames(['id'], { type: 'language' }).of(lang);
    if (name && name.toLowerCase() !== lang.toLowerCase()) return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    /* kode tidak valid */
  }
  return lang.toUpperCase();
}

/**
 * ID folder dari input admin: URL Google Drive (folders/<ID>, open?id=<ID>, ?id=<ID>) atau ID polos.
 */
export function parseFolderInput(input: string): string | null {
  const s = input.trim();
  if (/^[A-Za-z0-9_-]{10,}$/.test(s)) return s;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (!/(^|\.)google\.com$/i.test(url.hostname)) return null;
  const m = url.pathname.match(/\/folders\/([A-Za-z0-9_-]{10,})/);
  if (m?.[1]) return m[1];
  const id = url.searchParams.get('id');
  if (id && /^[A-Za-z0-9_-]{10,}$/.test(id)) return id;
  return null;
}
