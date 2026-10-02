import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import sharp from 'sharp';
import { config } from '../../config.js';
import { exec, query, queryOne } from '../../db.js';
import { freeBytes } from '../../lib/disk.js';
import { ffprobe, internalInput, progressSeconds, run } from '../../lib/ffmpeg.js';
import { newAssetKey } from '../../lib/ids.js';
import { DriveError, mediaRequest, trashFile, uploadFileFromDisk } from '../drive/client.js';
import { ensureSystemFolders } from '../drive/service.js';
import { settings } from '../settings/service.js';
import { invalidateStreamCache } from '../stream/routes.js';
import { faststartEligible, faststartMuxer, remoteNeedsFaststart, rewriteFaststart } from './faststart.js';
import { enqueueJob, type JobType } from './queue.js';
import { encodeParams, isBrowserPlayable, outputSize, planRenditions, storyboardInterval, summarizeProbe } from './media-rules.js';

export interface JobContext {
  job: { id: number; type: JobType; video_id: number | null; payload: Record<string, unknown> | null; attempts: number; max_attempts: number };
  signal: AbortSignal;
  setProgress: (pct: number) => void;
  log: { info: (o: object, m?: string) => void; warn: (o: object, m?: string) => void };
}

/** Tunda job tanpa menghitung percobaan (mis. disk penuh). */
export class DeferJob extends Error {
  constructor(
    readonly delayMs: number,
    message: string,
  ) {
    super(message);
  }
}

/** Gagal permanen (tidak perlu dicoba ulang). */
export class FatalJobError extends Error {}

interface VideoRow {
  id: number;
  public_id: string;
  drive_file_id: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  original_playable: number | null;
  thumb_key: string | null;
  storyboard: unknown;
  status: string;
  deleted_at: Date | null;
}

const publicDir = (...p: string[]) => join(config.STORAGE_DIR, 'public', ...p);

async function loadVideo(id: number | null): Promise<VideoRow> {
  if (!id) throw new FatalJobError('job tanpa video');
  const v = await queryOne<VideoRow>(
    `SELECT id, public_id, drive_file_id, file_name, mime_type, size_bytes, duration_ms, width, height, original_playable,
            thumb_key, storyboard, status, deleted_at FROM videos WHERE id = ?`,
    [id],
  );
  if (!v) throw new FatalJobError('video tidak ditemukan');
  return v;
}

async function setStatus(id: number, status: string, extra: Record<string, unknown> = {}): Promise<void> {
  const cols = Object.keys(extra);
  await exec(`UPDATE videos SET status = ?${cols.map((c) => `, ${c} = ?`).join('')} WHERE id = ? AND deleted_at IS NULL`, [
    status,
    ...cols.map((c) => extra[c]),
    id,
  ]);
}

// ---------------------------------------------------------------------------
// probe
// ---------------------------------------------------------------------------

async function probe(ctx: JobContext): Promise<void> {
  const v = await loadVideo(ctx.job.video_id);
  if (v.deleted_at) return;
  const input = internalInput(v.drive_file_id);
  let result;
  try {
    result = await ffprobe([...input.headerArgs, input.url], { signal: ctx.signal });
  } catch (err) {
    if (ctx.job.attempts >= ctx.job.max_attempts) {
      await setStatus(v.id, 'failed', { processing_error: 'File video tidak bisa dibaca (rusak atau format tidak dikenal)' });
    }
    throw err;
  }
  const s = summarizeProbe(result);
  if (!s.hasVideo) {
    await setStatus(v.id, 'failed', { processing_error: 'Tidak ada stream video di file ini' });
    throw new FatalJobError('tanpa stream video');
  }
  const playable = isBrowserPlayable(s, v.file_name);
  await exec(
    `UPDATE videos SET duration_ms = ?, width = ?, height = ?, rotation = ?, video_codec = ?, audio_codec = ?, container = ?,
                       bitrate_kbps = ?, original_playable = ?, processing_error = NULL, status = 'processing'
      WHERE id = ? AND deleted_at IS NULL`,
    [
      s.durationSec != null ? Math.round(s.durationSec * 1000) : null,
      s.width,
      s.height,
      s.rotation,
      s.videoCodec,
      s.audioCodec,
      s.container?.slice(0, 64) ?? null,
      s.bitrateKbps,
      playable ? 1 : 0,
      v.id,
    ],
  );
  invalidateStreamCache(v.public_id);
  await enqueueJob('thumbnail', { videoId: v.id });

  const enabled = settings.get('processing.enabled');
  const short = Math.min(s.width ?? 0, s.height ?? 0);
  const plan = planRenditions(short, playable, settings.get('processing.renditions'), settings.get('processing.compat_max_height'));
  if (!enabled) {
    if (!playable) {
      await setStatus(v.id, 'failed', { processing_error: 'Format tidak didukung browser dan pemrosesan dinonaktifkan' });
    }
    return;
  }
  if (plan.length || settings.get('processing.storyboard')) await enqueueJob('media', { videoId: v.id });
  else if (faststartEligible({ file_name: v.file_name, original_playable: playable ? 1 : 0 })) await enqueueJob('faststart', { videoId: v.id });
}

// ---------------------------------------------------------------------------
// thumbnail
// ---------------------------------------------------------------------------

async function grabFrame(fileId: string, t: number, signal: AbortSignal): Promise<Buffer> {
  const input = internalInput(fileId);
  const res = await run(
    config.FFMPEG_PATH,
    ['-v', 'error', '-ss', t.toFixed(2), ...input.headerArgs, '-i', input.url, '-frames:v', '1', '-an', '-sn', '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '2', 'pipe:1'],
    { binaryStdout: true, signal, timeoutMs: 90_000 },
  );
  if (!res.stdout.length) throw new Error('frame kosong');
  return res.stdout;
}

/** Skor frame: entropi + bonus bila tidak gelap + variasi warna (hindari frame hitam/polos). */
export function frameScore(stats: { entropy: number; channels: { mean: number; stdev: number }[] }): number {
  const ch = stats.channels.slice(0, 3);
  const mean = ch.reduce((a, c) => a + c.mean, 0) / Math.max(1, ch.length);
  const stdev = ch.reduce((a, c) => a + c.stdev, 0) / Math.max(1, ch.length);
  return stats.entropy + (mean > 24 ? 2 : 0) + Math.min(stdev / 32, 2);
}

async function removeThumbs(publicId: string, exceptKey?: string): Promise<void> {
  const dir = publicDir('thumbs');
  if (!existsSync(dir)) return;
  for (const name of await readdir(dir)) {
    if (name.startsWith(`${publicId}-`) && (!exceptKey || !name.startsWith(`${publicId}-${exceptKey}-`))) {
      await rm(join(dir, name), { force: true });
    }
  }
}

async function thumbnail(ctx: JobContext): Promise<void> {
  const v = await loadVideo(ctx.job.video_id);
  if (v.deleted_at) return;
  const dur = v.duration_ms ? v.duration_ms / 1000 : 10;
  const clamp = (t: number) => Math.max(Math.min(1, dur / 2), Math.min(t, Math.max(0, dur - 1)));
  const times = [...new Set([0.1, 0.25, 0.5].map((p) => Number(clamp(dur * p).toFixed(2))))];

  let best: { buf: Buffer; score: number } | null = null;
  for (const [i, t] of times.entries()) {
    try {
      const buf = await grabFrame(v.drive_file_id, t, ctx.signal);
      const score = frameScore(await sharp(buf).stats());
      if (!best || score > best.score) best = { buf, score };
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      ctx.log.warn({ err: (err as Error).message, t }, 'gagal ambil frame');
    }
    ctx.setProgress(Math.round(((i + 1) / times.length) * 70));
  }
  if (!best) throw new Error('tidak ada frame yang bisa diambil');

  const portrait = (v.width ?? 16) / (v.height ?? 9) < 1.2;
  const fit = portrait ? ({ fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 1 } } as const) : ({ fit: 'cover' } as const);
  const key = newAssetKey();
  const dir = publicDir('thumbs');
  await mkdir(dir, { recursive: true });
  const base = join(dir, `${v.public_id}-${key}`);
  await sharp(best.buf).resize(480, 270, fit).webp({ quality: 78 }).toFile(`${base}-480.webp`);
  await sharp(best.buf).resize(1280, 720, fit).webp({ quality: 80 }).toFile(`${base}-1280.webp`);
  await sharp(best.buf).resize(1280, 720, fit).flatten({ background: '#000' }).jpeg({ quality: 82, mozjpeg: true }).toFile(`${base}-og.jpg`);
  await exec('UPDATE videos SET thumb_key = ? WHERE id = ?', [key, v.id]);
  await removeThumbs(v.public_id, key);

  const fresh = await loadVideo(v.id);
  if (fresh.original_playable === 1 && fresh.status !== 'ready') await setStatus(v.id, 'ready');
  invalidateStreamCache(v.public_id);
}

// ---------------------------------------------------------------------------
// media: rendition + storyboard
// ---------------------------------------------------------------------------

async function download(fileId: string, dest: string, size: number, ctx: JobContext, from: number, to: number): Promise<void> {
  const res = await mediaRequest(fileId, { signal: ctx.signal });
  let got = 0;
  let last = 0;
  res.body.on('data', (chunk: Buffer) => {
    got += chunk.length;
    const now = Date.now();
    if (size > 0 && now - last > 2000) {
      last = now;
      ctx.setProgress(from + Math.round(((to - from) * got) / size));
    }
  });
  await pipeline(res.body, createWriteStream(dest), { signal: ctx.signal });
}

async function makeStoryboard(v: VideoRow, src: string, durationSec: number, ctx: JobContext): Promise<void> {
  const interval = storyboardInterval(durationSec);
  const key = newAssetKey();
  const dirName = `${v.public_id}-${key}`;
  const dir = publicDir('sb', dirName);
  await mkdir(dir, { recursive: true });
  const vf = `fps=1/${interval},scale=160:90:force_original_aspect_ratio=decrease,pad=160:90:(ow-iw)/2:(oh-ih)/2,tile=10x10`;
  const expected = Math.max(1, Math.ceil(durationSec / interval));
  const nice = settings.get('processing.nice');
  const attempt = async (skipNonKey: boolean) => {
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    await run(
      config.FFMPEG_PATH,
      ['-v', 'error', ...(skipNonKey ? ['-skip_frame', 'nokey'] : []), '-i', src, '-an', '-sn', '-vf', vf, '-q:v', '5', '-vsync', 'vfr', join(dir, '%d.jpg')],
      { nice, signal: ctx.signal, timeoutMs: 3600_000 },
    );
    return (await readdir(dir)).filter((f) => f.endsWith('.jpg')).length;
  };
  let sheets = await attempt(true);
  // GOP panjang → terlalu sedikit keyframe: ulangi dengan semua frame.
  if (sheets < Math.ceil(expected / 100)) sheets = await attempt(false);
  if (!sheets) {
    await rm(dir, { recursive: true, force: true });
    return;
  }
  const storyboard = {
    v: 1,
    interval,
    w: 160,
    h: 90,
    cols: 10,
    rows: 10,
    count: Math.min(expected, sheets * 100),
    sheets: Array.from({ length: sheets }, (_, i) => `/media/sb/${dirName}/${i + 1}.jpg`),
  };
  await exec('UPDATE videos SET storyboard = ? WHERE id = ?', [JSON.stringify(storyboard), v.id]);
  await removeStoryboardDirs(v.public_id, dirName);
}

async function removeStoryboardDirs(publicId: string, exceptDir?: string): Promise<void> {
  const root = publicDir('sb');
  if (!existsSync(root)) return;
  for (const name of await readdir(root)) {
    if (name.startsWith(`${publicId}-`) && name !== exceptDir) await rm(join(root, name), { recursive: true, force: true });
  }
}

async function renditionsFolder(): Promise<string> {
  const existing = settings.get('drive.renditions_folder_id');
  if (existing) return existing;
  const root = settings.get('drive.root_folder_id');
  if (!root) throw new FatalJobError('folder sumber belum diatur');
  const { systemId, renditionsId } = await ensureSystemFolders(root);
  await settings.set({ 'drive.system_folder_id': systemId, 'drive.renditions_folder_id': renditionsId });
  return renditionsId;
}

async function media(ctx: JobContext): Promise<void> {
  const v = await loadVideo(ctx.job.video_id);
  if (v.deleted_at) return;
  if (v.original_playable == null || !v.width || !v.height) throw new Error('video belum diprobe');
  const durationSec = (v.duration_ms ?? 0) / 1000;
  const playable = v.original_playable === 1;
  const short = Math.min(v.width, v.height);
  const plan = planRenditions(short, playable, settings.get('processing.renditions'), settings.get('processing.compat_max_height'));
  const wantStoryboard = settings.get('processing.storyboard') && durationSec > 0;
  if (!plan.length && !wantStoryboard) {
    if (faststartEligible(v)) await enqueueJob('faststart', { videoId: v.id });
    return;
  }

  const tmpDir = join(config.STORAGE_DIR, 'tmp');
  await mkdir(tmpDir, { recursive: true });
  const size = Number(v.size_bytes);
  const minFree = settings.get('processing.min_free_disk_gb') * 1024 ** 3;
  if ((await freeBytes(tmpDir)) < size * 2.5 + minFree) {
    throw new DeferJob(30 * 60_000, 'ruang disk tidak cukup, ditunda 30 menit');
  }

  const src = join(tmpDir, `${v.public_id}.src`);
  let fastOut: string | null = null;
  const outputs: { path: string; height: number; kind: 'quality' | 'compat'; width: number; realHeight: number }[] = [];
  try {
    ctx.setProgress(1);
    await download(v.drive_file_id, src, size, ctx, 1, 30);
    // File asli dirapikan dulu (cepat, tanpa encode ulang) agar 1080p asli langsung lancar sebelum konversi selesai.
    let input = src;
    try {
      const rewritten = await rewriteFaststart(ctx, v, src);
      if (rewritten) {
        fastOut = rewritten;
        input = rewritten;
        await rm(src, { force: true });
      }
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      ctx.log.warn({ err: (err as Error).message, publicId: v.public_id }, 'faststart gagal (file asli tidak diubah)');
    }

    const nice = settings.get('processing.nice');
    if (plan.length) {
      const threads = String(settings.get('processing.threads'));
      const preset = settings.get('processing.x264_preset');
      const labels = plan.map((_, i) => `v${i}`);
      const scales = plan
        .map((p, i) => {
          const o = outputSize(v.width!, v.height!, p.height);
          return `[s${i}]scale=${o.width}:${o.height}:flags=bicubic[${labels[i]}]`;
        })
        .join(';');
      const split = plan.length > 1 ? `[0:v]split=${plan.length}${plan.map((_, i) => `[s${i}]`).join('')};` : '[0:v]null[s0];';
      const args = ['-hide_banner', '-y', '-i', input, '-filter_complex', `${split}${scales}`];
      for (const [i, p] of plan.entries()) {
        const e = encodeParams(p.height);
        const o = outputSize(v.width, v.height, p.height);
        const out = join(tmpDir, `${v.public_id}_${p.kind === 'compat' ? 'compat' : p.height}.mp4`);
        outputs.push({ path: out, height: p.height, kind: p.kind, width: o.width, realHeight: o.height });
        args.push(
          '-map', `[${labels[i]}]`, '-map', '0:a:0?',
          '-c:v', 'libx264', '-preset', preset, '-crf', String(e.crf), '-maxrate', e.maxrate, '-bufsize', e.bufsize,
          '-profile:v', e.profile, '-pix_fmt', 'yuv420p', '-force_key_frames', 'expr:gte(t,n_forced*2)',
          '-c:a', 'aac', '-b:a', e.audio, '-ac', '2', '-movflags', '+faststart', '-threads', threads, out,
        );
      }
      args.push('-progress', 'pipe:1', '-nostats');
      let lastPct = 30;
      await run(config.FFMPEG_PATH, args, {
        nice,
        signal: ctx.signal,
        timeoutMs: Math.max(3600_000, durationSec * 20_000),
        onLine: (line) => {
          const t = progressSeconds(line);
          if (t != null && durationSec > 0) {
            const pct = 30 + Math.round(Math.min(1, t / durationSec) * 50);
            if (pct > lastPct) {
              lastPct = pct;
              ctx.setProgress(pct);
            }
          }
        },
      });
    }

    if (wantStoryboard) {
      try {
        await makeStoryboard(v, input, durationSec, ctx);
      } catch (err) {
        if (ctx.signal.aborted) throw err;
        ctx.log.warn({ err: (err as Error).message }, 'storyboard gagal (diabaikan)');
      }
    }
    ctx.setProgress(85);

    if (outputs.length) {
      const folder = await renditionsFolder();
      for (const [i, o] of outputs.entries()) {
        const bytes = (await stat(o.path)).size;
        const uploaded = await uploadFileFromDisk(o.path, {
          name: `${v.public_id}_${o.kind === 'compat' ? `${o.height}p_compat` : `${o.height}p`}.mp4`,
          mimeType: 'video/mp4',
          parents: [folder],
          appProperties: { dv: '1', dvRole: 'rendition', dvVid: v.public_id, dvH: String(o.height) },
        });
        const old = await queryOne<{ drive_file_id: string | null }>('SELECT drive_file_id FROM video_renditions WHERE video_id = ? AND height = ?', [v.id, o.height]);
        await exec(
          `INSERT INTO video_renditions (video_id, height, width, real_height, kind, drive_file_id, size_bytes, bitrate_kbps, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready')
           ON DUPLICATE KEY UPDATE width = VALUES(width), real_height = VALUES(real_height), kind = VALUES(kind),
             drive_file_id = VALUES(drive_file_id), size_bytes = VALUES(size_bytes), bitrate_kbps = VALUES(bitrate_kbps), status = 'ready'`,
          [v.id, o.height, o.width, o.realHeight, o.kind, uploaded.id, bytes, durationSec > 0 ? Math.round((bytes * 8) / durationSec / 1000) : null],
        );
        if (old?.drive_file_id && old.drive_file_id !== uploaded.id) await trashFile(old.drive_file_id).catch(() => {});
        ctx.setProgress(85 + Math.round(((i + 1) / outputs.length) * 15));
      }
    }

    const fresh = await loadVideo(v.id);
    if (!playable && outputs.some((o) => o.kind === 'compat') && fresh.status !== 'ready') await setStatus(v.id, 'ready', { processing_error: null });
    invalidateStreamCache(v.public_id);
  } finally {
    await rm(src, { force: true });
    if (fastOut) await rm(fastOut, { force: true });
    for (const o of outputs) await rm(o.path, { force: true });
  }
}

// ---------------------------------------------------------------------------
// faststart: video lama / tanpa job media (cek Drive dulu, unduh hanya bila perlu)
// ---------------------------------------------------------------------------

async function faststart(ctx: JobContext): Promise<void> {
  const v = await loadVideo(ctx.job.video_id);
  if (v.deleted_at || !faststartEligible(v) || !faststartMuxer(v.file_name)) return;
  if (!(await remoteNeedsFaststart(v, ctx.signal))) return;

  const tmpDir = join(config.STORAGE_DIR, 'tmp');
  await mkdir(tmpDir, { recursive: true });
  const size = Number(v.size_bytes);
  const minFree = settings.get('processing.min_free_disk_gb') * 1024 ** 3;
  if ((await freeBytes(tmpDir)) < size * 2.2 + minFree) throw new DeferJob(30 * 60_000, 'ruang disk tidak cukup, ditunda 30 menit');

  const src = join(tmpDir, `${v.public_id}.fs-src`);
  let out: string | null = null;
  try {
    ctx.setProgress(1);
    await download(v.drive_file_id, src, size, ctx, 1, 60);
    ctx.setProgress(60);
    out = await rewriteFaststart(ctx, v, src);
    ctx.setProgress(100);
  } finally {
    await rm(src, { force: true });
    if (out) await rm(out, { force: true });
  }
}

// ---------------------------------------------------------------------------
// delete_assets
// ---------------------------------------------------------------------------

async function deleteAssets(ctx: JobContext): Promise<void> {
  const mode = (ctx.job.payload?.mode as string) ?? 'all';
  const videoId = ctx.job.video_id;
  const row = videoId ? await queryOne<{ public_id: string }>('SELECT public_id FROM videos WHERE id = ?', [videoId]) : null;
  const publicId = (ctx.job.payload?.publicId as string | undefined) ?? row?.public_id;
  if (videoId) {
    const rends = await query<{ id: number; drive_file_id: string | null }>('SELECT id, drive_file_id FROM video_renditions WHERE video_id = ?', [videoId]);
    for (const r of rends) {
      if (r.drive_file_id) {
        try {
          await trashFile(r.drive_file_id);
        } catch (err) {
          if (!(err instanceof DriveError && err.status === 404)) throw err;
        }
      }
      await exec('DELETE FROM video_renditions WHERE id = ?', [r.id]);
    }
    await exec('UPDATE videos SET storyboard = NULL WHERE id = ?', [videoId]);
  }
  if (publicId) {
    await removeStoryboardDirs(publicId);
    if (mode === 'all') {
      await removeThumbs(publicId);
      if (videoId) await exec('UPDATE videos SET thumb_key = NULL WHERE id = ?', [videoId]);
    }
    invalidateStreamCache(publicId);
  }
}

export const HANDLERS: Record<JobType, (ctx: JobContext) => Promise<void>> = {
  probe,
  thumbnail,
  media,
  faststart,
  delete_assets: deleteAssets,
};

/** Dipanggil saat job gagal permanen. */
export async function onJobFailed(type: JobType, videoId: number | null, message: string): Promise<void> {
  if (!videoId) return;
  const v = await queryOne<{ original_playable: number | null; status: string; thumb_key: string | null }>(
    'SELECT original_playable, status, thumb_key FROM videos WHERE id = ? AND deleted_at IS NULL',
    [videoId],
  );
  if (!v) return;
  if (type === 'probe') {
    await setStatus(videoId, 'failed', { processing_error: message.slice(0, 1000) });
  } else if (type === 'thumbnail') {
    // Tanpa thumbnail video tetap bisa ditonton.
    if (v.original_playable === 1 && v.status !== 'ready') await setStatus(videoId, 'ready');
  } else if (type === 'media') {
    if (v.original_playable !== 1) await setStatus(videoId, 'failed', { processing_error: `Konversi gagal: ${message}`.slice(0, 1000) });
  }
}
