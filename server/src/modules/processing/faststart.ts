/**
 * Faststart file asli: MP4/MOV yang indeks `moov`-nya di akhir file membuat browser bolak-balik ke Drive
 * (±0,6 dtk per request) sebelum bisa memutar/seek. File di-remux TANPA encode ulang (`-c copy`, paket audio/video
 * identik — dibuktikan dengan streamhash), lalu MENIMPA isi file asli di Drive (ID/nama/folder tetap) dan revisi lama
 * dihapus agar tidak memakan kuota. Keputusan user 2026-10-02 (lihat CLAUDE.md → Keputusan).
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { config } from '../../config.js';
import { exec } from '../../db.js';
import { freeBytes } from '../../lib/disk.js';
import { run } from '../../lib/ffmpeg.js';
import { localTopLevelBoxes, moovAfterMdat, readTopLevelBoxes } from '../../lib/mp4.js';
import { fileExtension } from '../drive/classify.js';
import { canEditFile, deleteRevision, listRevisions, mediaRequest, replaceFileContentFromDisk } from '../drive/client.js';
import { settings } from '../settings/service.js';
import { invalidateStreamCache } from '../stream/routes.js';
import type { JobContext } from './handlers.js';

const MUXERS: Record<string, string> = { mp4: 'mp4', m4v: 'mp4', mov: 'mov' };

export interface FaststartVideo {
  id: number;
  public_id: string;
  drive_file_id: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number;
  original_playable: number | null;
}

/** Muxer ffmpeg untuk container file asli, atau null bila bukan MP4/MOV. */
export function faststartMuxer(fileName: string): string | null {
  return MUXERS[fileExtension(fileName)] ?? null;
}

/** File asli diputar langsung oleh browser dan berupa MP4/MOV → kandidat faststart. */
export function faststartEligible(v: Pick<FaststartVideo, 'file_name' | 'original_playable'>): boolean {
  return settings.get('processing.faststart_original') && v.original_playable === 1 && faststartMuxer(v.file_name) !== null;
}

/** Cek posisi moov langsung di Drive lewat beberapa Range kecil (tanpa mengunduh file). */
export async function remoteNeedsFaststart(v: Pick<FaststartVideo, 'drive_file_id' | 'size_bytes'>, signal?: AbortSignal): Promise<boolean> {
  const boxes = await readTopLevelBoxes(async (offset, length) => {
    const end = Math.min(offset + length, Number(v.size_bytes)) - 1;
    const res = await mediaRequest(v.drive_file_id, { range: `bytes=${offset}-${end}`, signal });
    return Buffer.from(await res.body.arrayBuffer());
  }, Number(v.size_bytes));
  return moovAfterMdat(boxes);
}

async function md5File(path: string): Promise<string> {
  const h = createHash('md5');
  for await (const chunk of createReadStream(path)) h.update(chunk as Buffer);
  return h.digest('hex');
}

/** Hash paket per stream (data audio/video/subtitle mentah). Sama persis = isi tidak berubah sedikit pun. */
async function streamHashes(path: string, maps: string[], ctx: JobContext): Promise<string> {
  const res = await run(config.FFMPEG_PATH, ['-v', 'error', '-i', path, ...maps, '-c', 'copy', '-f', 'streamhash', '-hash', 'md5', '-'], {
    nice: settings.get('processing.nice'),
    signal: ctx.signal,
    timeoutMs: 3600_000,
  });
  return res.stdout.toString().trim();
}

interface StreamInfo {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  sample_rate?: string;
  channels?: number;
  nb_frames?: string;
  duration?: string;
  tags?: Record<string, string>;
  side_data_list?: { rotation?: number }[];
}

/** Ringkasan stream untuk dibandingkan (codec, ukuran, rotasi, jumlah frame, durasi). */
async function streamSummary(path: string, ctx: JobContext): Promise<{ key: string; durations: number[] }> {
  const res = await run(config.FFPROBE_PATH, ['-v', 'error', '-print_format', 'json', '-show_streams', path], { signal: ctx.signal, timeoutMs: 300_000 });
  const streams = ((JSON.parse(res.stdout.toString()) as { streams?: StreamInfo[] }).streams ?? []).filter((s) => s.codec_type !== 'data');
  const key = streams
    .map((s) => {
      const rot = s.tags?.rotate ?? s.side_data_list?.find((d) => d.rotation != null)?.rotation ?? 0;
      return [s.codec_type, s.codec_name, s.width ?? '', s.height ?? '', s.sample_rate ?? '', s.channels ?? '', s.nb_frames ?? '', rot].join(':');
    })
    .join('|');
  return { key, durations: streams.map((s) => Number(s.duration ?? NaN)) };
}

/** Hapus revisi lama setelah isi ditimpa (sesuai permintaan user: jangan memenuhi Drive). Gagal → dibiarkan (Drive menghapus sendiri ±30 hari). */
async function pruneOldRevisions(fileId: string, keepMd5: string, ctx: JobContext): Promise<number> {
  let deleted = 0;
  try {
    const revs = await listRevisions(fileId);
    const head = revs.at(-1);
    for (const r of revs) {
      if (r === head || r.md5Checksum === keepMd5) continue;
      await deleteRevision(fileId, r.id);
      deleted++;
    }
  } catch (err) {
    ctx.log.warn({ err: (err as Error).message, fileId }, 'faststart: gagal menghapus revisi lama (diabaikan)');
  }
  return deleted;
}

/**
 * Rapikan file asli lokal `src` (sudah diunduh) bila moov di akhir, lalu timpa file di Drive.
 * Mengembalikan path file hasil (isi stream identik, siap dipakai sebagai input ffmpeg) atau null bila tidak dilakukan.
 * Semua kegagalan non-fatal dilempar ke pemanggil (yang mencatatnya sebagai peringatan); file asli di Drive tidak tersentuh.
 */
export async function rewriteFaststart(ctx: JobContext, v: FaststartVideo, src: string): Promise<string | null> {
  const muxer = faststartMuxer(v.file_name);
  if (!muxer || !faststartEligible(v)) return null;
  if (!moovAfterMdat(await localTopLevelBoxes(src))) return null;

  const size = (await stat(src)).size;
  const minFree = settings.get('processing.min_free_disk_gb') * 1024 ** 3;
  if ((await freeBytes(src)) < size * 1.05 + minFree) {
    ctx.log.warn({ publicId: v.public_id }, 'faststart dilewati: ruang disk tidak cukup');
    return null;
  }
  if (!(await canEditFile(v.drive_file_id))) {
    ctx.log.warn({ publicId: v.public_id }, 'faststart dilewati: akun Drive tidak punya izin edit file ini');
    return null;
  }

  const out = join(dirname(src), `${v.public_id}.faststart.${muxer}`);
  const nice = settings.get('processing.nice');
  const remux = (maps: string[]) =>
    run(config.FFMPEG_PATH, ['-v', 'error', '-y', '-i', src, ...maps, '-c', 'copy', '-map_metadata', '0', '-movflags', '+faststart', '-f', muxer, out], {
      nice,
      signal: ctx.signal,
      timeoutMs: 3600_000,
    });
  let maps = ['-map', '0'];
  let droppedData = false;
  try {
    try {
      await remux(maps);
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      // Stream data (timecode/telemetri) kadang tidak bisa ditulis ulang ke MP4 → ulangi tanpa stream data.
      // Audio, video & subtitle tetap disalin utuh.
      maps = ['-map', '0', '-map', '-0:d'];
      droppedData = true;
      await remux(maps);
    }

    // Bukti isi tidak berubah: indeks kini di depan, paket stream identik, metadata stream & durasi sama.
    if (moovAfterMdat(await localTopLevelBoxes(out))) throw new Error('hasil remux masih belum faststart');
    const [hashSrc, hashOut] = [await streamHashes(src, maps, ctx), await streamHashes(out, ['-map', '0'], ctx)];
    if (!hashSrc || hashSrc !== hashOut) throw new Error('verifikasi gagal: isi stream berbeda setelah remux');
    const [a, b] = [await streamSummary(src, ctx), await streamSummary(out, ctx)];
    if (a.key !== b.key) throw new Error(`verifikasi gagal: info stream berbeda (${a.key} ≠ ${b.key})`);
    if (a.durations.some((d, i) => Number.isFinite(d) && Math.abs(d - (b.durations[i] ?? NaN)) > 0.1)) {
      throw new Error('verifikasi gagal: durasi stream berbeda');
    }

    const md5 = await md5File(out);
    const outSize = (await stat(out)).size;
    const file = await replaceFileContentFromDisk(
      v.drive_file_id,
      out,
      { mimeType: v.mime_type ?? 'video/mp4', appProperties: { dvFs: md5 } },
      ctx.signal,
    );
    if (file.md5Checksum && file.md5Checksum !== md5) throw new Error('md5 di Drive tidak sama dengan file hasil (upload rusak?)');
    // Catat md5 baru SEGERA agar sinkron tidak menganggapnya "isi diganti" (lihat juga dvFs di sync/service.ts).
    await exec('UPDATE videos SET md5 = ?, size_bytes = ?, drive_modified_at = ? WHERE id = ?', [
      md5,
      Number(file.size ?? outSize),
      file.modifiedTime ? new Date(file.modifiedTime) : new Date(),
      v.id,
    ]);
    invalidateStreamCache(v.public_id);
    const pruned = await pruneOldRevisions(v.drive_file_id, md5, ctx);
    ctx.log.info(
      { publicId: v.public_id, before: size, after: outSize, droppedData, prunedRevisions: pruned },
      'faststart: file asli di Drive ditimpa (tanpa encode ulang)',
    );
    return out;
  } catch (err) {
    await rm(out, { force: true });
    throw err;
  }
}
