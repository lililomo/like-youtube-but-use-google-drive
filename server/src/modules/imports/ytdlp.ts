/** Pembungkus yt-dlp untuk impor YouTube (binary mandiri yt-dlp_linux, lihat scripts/ops/install-yt-dlp.sh). */
import { existsSync } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { config } from '../../config.js';
import { ProcessError, run } from '../../lib/ffmpeg.js';

export const MAX_HEIGHT = 1080;
/** Batas video per playlist sekali tambah. */
export const MAX_PLAYLIST_ITEMS = 500;

export const ytdlpPath = (): string => config.YTDLP_PATH || join(config.STORAGE_DIR, 'bin', 'yt-dlp');
const cookiesPath = (): string => join(config.STORAGE_DIR, 'private', 'youtube-cookies.txt');

/** Kesalahan yang tidak akan berhasil bila dicoba ulang (video privat/dihapus/umur/anggota, dsb.). */
export class YtPermanentError extends Error {}

/**
 * Resolusi tertinggi ≤1080p dulu; pada resolusi yang sama utamakan H.264 + AAC (diputar langsung di semua browser
 * termasuk iPhone, tanpa konversi). Bila 1080p hanya ada dalam VP9/AV1, tetap diambil (pipeline membuat versi kompatibel).
 */
const SELECT = ['-f', 'bv*+ba/b', '-S', `res:${MAX_HEIGHT},vcodec:h264,acodec:aac`];

function baseArgs(playlist = false): string[] {
  const args = [
    playlist ? '--yes-playlist' : '--no-playlist',
    '--no-colors',
    '--no-mtime',
    '--js-runtimes',
    `node:${process.execPath}`,
    '--ffmpeg-location',
    dirname(config.FFMPEG_PATH),
    '--cache-dir',
    join(config.STORAGE_DIR, 'cache', 'yt-dlp'),
    '--socket-timeout',
    '30',
    '--retries',
    '10',
    '--fragment-retries',
    '10',
  ];
  if (existsSync(cookiesPath())) args.push('--cookies', cookiesPath());
  return args;
}

export interface YtInfo {
  id: string;
  title: string;
  channel: string | null;
  durationSec: number | null;
  isLive: boolean;
  height: number | null;
  vcodec: string | null;
  acodec: string | null;
  ext: string;
  /** Perkiraan ukuran total (video + audio), bila diketahui. */
  sizeEstimate: number | null;
  formatIds: string[];
  formatSizes: Record<string, number>;
}

interface RawFormat {
  format_id?: string;
  filesize?: number | null;
  filesize_approx?: number | null;
  height?: number | null;
  width?: number | null;
  vcodec?: string | null;
  acodec?: string | null;
  ext?: string;
}

interface RawInfo extends RawFormat {
  id: string;
  title?: string;
  channel?: string;
  uploader?: string;
  duration?: number;
  is_live?: boolean;
  live_status?: string;
  requested_formats?: RawFormat[];
}

const codecName = (c: string | null | undefined): string | null => {
  if (!c || c === 'none') return null;
  if (c.startsWith('avc1')) return 'H.264';
  if (c.startsWith('vp09') || c.startsWith('vp9')) return 'VP9';
  if (c.startsWith('av01')) return 'AV1';
  if (c.startsWith('mp4a')) return 'AAC';
  if (c.startsWith('opus')) return 'Opus';
  return c.split('.')[0] ?? c;
};

export function summarizeInfo(raw: RawInfo): YtInfo {
  const parts = raw.requested_formats?.length ? raw.requested_formats : [raw];
  const sizes: Record<string, number> = {};
  for (const f of parts) {
    const s = f.filesize ?? f.filesize_approx;
    if (f.format_id && s) sizes[f.format_id] = s;
  }
  const v = parts.find((f) => f.vcodec && f.vcodec !== 'none') ?? raw;
  const a = parts.find((f) => f.acodec && f.acodec !== 'none') ?? raw;
  const known = Object.values(sizes);
  return {
    id: raw.id,
    title: (raw.title ?? raw.id).trim(),
    channel: raw.channel ?? raw.uploader ?? null,
    durationSec: raw.duration != null ? Math.round(raw.duration) : null,
    isLive: raw.is_live === true || raw.live_status === 'is_live' || raw.live_status === 'is_upcoming',
    height: v.height != null && v.width != null ? Math.min(v.height, v.width) : (v.height ?? null),
    vcodec: codecName(v.vcodec),
    acodec: codecName(a.acodec),
    ext: raw.ext ?? 'mp4',
    sizeEstimate: known.length === parts.length && known.length ? known.reduce((x, y) => x + y, 0) : null,
    formatIds: parts.map((f) => f.format_id ?? '').filter(Boolean),
    formatSizes: sizes,
  };
}

/** Ubah pesan error yt-dlp menjadi pesan yang dimengerti admin; tandai yang permanen. */
export function explainYtdlpError(stderr: string): Error {
  const line =
    stderr
      .split('\n')
      .reverse()
      .find((l) => l.startsWith('ERROR:')) ?? stderr.trim().split('\n').pop() ?? 'yt-dlp gagal';
  const msg = line.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?([\w-]{11}:\s*)?/, '').trim();
  const lower = msg.toLowerCase();
  const permanent: [RegExp, string][] = [
    [/private video/, 'Video ini privat di YouTube'],
    [/video (is )?unavailable|video is not available|video has been removed|account associated .* terminated/, 'Video tidak tersedia / sudah dihapus di YouTube'],
    [/confirm your age|age-restricted|inappropriate for some users/, 'Video dibatasi umur — butuh cookies akun YouTube (lihat panduan di halaman Impor)'],
    [/members-only|join this channel/, 'Video khusus anggota channel'],
    [/copyright/, 'Video diblokir karena hak cipta'],
    [/not available in your country|geo.?restrict/, 'Video tidak tersedia dari lokasi server'],
    [/live event will begin|premieres in|is_upcoming/, 'Siaran/premiere belum dimulai'],
    [/sign in to confirm you.?re not a bot/, 'YouTube meminta verifikasi "bukan bot" untuk IP server — butuh cookies akun YouTube (lihat panduan di halaman Impor)'],
    [/unsupported url|is not a valid url|incomplete youtube id/, 'Link YouTube tidak valid'],
    [/playlist does not exist|the playlist does not exist|this playlist is private/, 'Playlist tidak ada atau privat'],
  ];
  for (const [re, text] of permanent) if (re.test(lower)) return new YtPermanentError(text);
  return new Error(msg.slice(0, 500) || 'yt-dlp gagal');
}

async function ytdlp(args: string[], opts: { signal?: AbortSignal; timeoutMs?: number; onLine?: (l: string) => void } = {}) {
  try {
    return await run(ytdlpPath(), args, { ...opts, maxStderr: 256 * 1024 });
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    if (err instanceof ProcessError) throw explainYtdlpError(err.stderr);
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new YtPermanentError('yt-dlp belum terpasang di server (jalankan scripts/ops/install-yt-dlp.sh)');
    throw err;
  }
}

/** Ambil metadata + format yang akan dipilih; JSON lengkap disimpan ke `<dir>/info.json` untuk dipakai saat unduh. */
export async function fetchInfo(url: string, dir: string, signal?: AbortSignal): Promise<YtInfo> {
  const res = await ytdlp([...baseArgs(), ...SELECT, '-J', url], { signal, timeoutMs: 180_000 });
  const raw = JSON.parse(res.stdout.toString()) as RawInfo;
  await writeFile(join(dir, 'info.json'), res.stdout);
  return summarizeInfo(raw);
}

/** Unduh (memakai info.json, tanpa ekstraksi ulang) → path file hasil. Progres 0..1 dari byte semua format. */
export async function downloadVideo(dir: string, info: YtInfo, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<string> {
  const done: Record<string, number> = {};
  const totals: Record<string, number> = { ...info.formatSizes };
  const args = [
    ...baseArgs(),
    ...SELECT,
    '--load-info-json',
    join(dir, 'info.json'),
    '--merge-output-format',
    'mp4/mkv',
    // Indeks di depan saat penggabungan → tidak perlu dirapikan/ditimpa lagi oleh pipeline faststart.
    '--postprocessor-args',
    'Merger+ffmpeg_o:-movflags +faststart',
    '--concurrent-fragments',
    '4',
    '--newline',
    '--progress-template',
    'download:DVP %(info.format_id)s %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s',
    '-o',
    join(dir, 'video.%(ext)s'),
  ];
  await ytdlp(args, {
    signal,
    timeoutMs: 6 * 3600_000,
    onLine: (line) => {
      const m = /^DVP (\S+) (\S+) (\S+) (\S+)/.exec(line.trim());
      if (!m) return;
      const [, fid = '', got, total, estimate] = m;
      const n = (s: string | undefined) => (s && s !== 'NA' ? Number(s) : NaN);
      if (Number.isFinite(n(got))) done[fid] = n(got);
      const t = Number.isFinite(n(total)) ? n(total) : n(estimate);
      if (Number.isFinite(t) && t > 0) totals[fid] = t;
      const sumTotal = info.formatIds.reduce((a, id) => a + (totals[id] ?? 0), 0);
      const sumDone = Object.values(done).reduce((a, b) => a + b, 0);
      if (sumTotal > 0) onProgress(Math.min(1, sumDone / sumTotal));
    },
  });
  const out = (await readdir(dir)).find((f) => f.startsWith('video.') && !/\.(part|ytdl|temp)$/.test(f) && !/\.f\d+\./.test(f));
  if (!out) throw new Error('file hasil unduhan tidak ditemukan');
  return join(dir, out);
}

export interface YtPlaylistEntry {
  id: string;
  title: string | null;
  durationSec: number | null;
  /** Alasan tidak bisa diunduh (privat/dihapus/anggota), atau null. */
  unavailable: string | null;
}

export interface YtPlaylist {
  id: string;
  title: string;
  channel: string | null;
  entries: YtPlaylistEntry[];
}

interface RawEntry {
  id?: string;
  title?: string;
  duration?: number | null;
  availability?: string | null;
  live_status?: string | null;
}

export function summarizePlaylist(raw: { id?: string; title?: string; channel?: string; uploader?: string; entries?: (RawEntry | null)[] }): YtPlaylist {
  const entries: YtPlaylistEntry[] = [];
  for (const e of raw.entries ?? []) {
    if (!e?.id || !/^[A-Za-z0-9_-]{11}$/.test(e.id)) continue;
    const title = e.title ?? null;
    let unavailable: string | null = null;
    if (title === '[Private video]' || e.availability === 'private') unavailable = 'Video privat di YouTube';
    else if (title === '[Deleted video]') unavailable = 'Video sudah dihapus di YouTube';
    else if (e.availability && ['needs_auth', 'subscriber_only', 'premium_only'].includes(e.availability)) unavailable = 'Butuh login/khusus anggota';
    else if (e.live_status === 'is_upcoming' || e.live_status === 'is_live') unavailable = 'Siaran langsung/premiere belum selesai';
    entries.push({ id: e.id, title, durationSec: e.duration != null ? Math.round(e.duration) : null, unavailable });
  }
  return { id: raw.id ?? '', title: (raw.title ?? raw.id ?? 'Playlist').trim(), channel: raw.channel ?? raw.uploader ?? null, entries };
}

/** Daftar isi playlist (tanpa mengunduh; --flat-playlist), maksimal `max` video. */
export async function fetchPlaylist(url: string, max = MAX_PLAYLIST_ITEMS, signal?: AbortSignal): Promise<YtPlaylist> {
  const res = await ytdlp([...baseArgs(true), '--flat-playlist', '--playlist-end', String(max), '-J', url], { signal, timeoutMs: 180_000 });
  return summarizePlaylist(JSON.parse(res.stdout.toString()) as Parameters<typeof summarizePlaylist>[0]);
}

export async function ytdlpVersion(): Promise<string | null> {
  if (!existsSync(ytdlpPath())) return null;
  try {
    return (await run(ytdlpPath(), ['--version'], { timeoutMs: 30_000 })).stdout.toString().trim();
  } catch {
    return null;
  }
}

/** Perbarui yt-dlp (YouTube sering berubah; versi lama cepat rusak). Butuh binary milik user aplikasi. */
export async function updateYtdlp(): Promise<string> {
  const res = await run(ytdlpPath(), ['-U'], { timeoutMs: 300_000 });
  return res.stdout.toString().trim().split('\n').pop() ?? '';
}
