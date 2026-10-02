/** Aturan media murni (SPEC §10) — mudah dites. */
import type { ProbeResult } from '../../lib/ffmpeg.js';

export interface ProbeSummary {
  hasVideo: boolean;
  width: number | null;
  height: number | null;
  rotation: number | null;
  durationSec: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  pixFmt: string | null;
  container: string | null;
  bitrateKbps: number | null;
}

export function summarizeProbe(p: ProbeResult): ProbeSummary {
  const streams = p.streams ?? [];
  const vs = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const as = streams.find((s) => s.codec_type === 'audio');
  let w = vs?.width ?? null;
  let h = vs?.height ?? null;
  const rotRaw = Number(vs?.tags?.rotate ?? vs?.side_data_list?.find((d) => d.rotation != null)?.rotation ?? 0);
  const rotation = Number.isFinite(rotRaw) ? ((Math.round(rotRaw) % 360) + 360) % 360 : 0;
  if (rotation === 90 || rotation === 270) [w, h] = [h, w];
  const dur = Number(p.format?.duration ?? vs?.duration ?? NaN);
  const br = Number(p.format?.bit_rate ?? NaN);
  return {
    hasVideo: Boolean(vs),
    width: w,
    height: h,
    rotation: rotation || null,
    durationSec: Number.isFinite(dur) && dur > 0 ? dur : null,
    videoCodec: vs?.codec_name ?? null,
    audioCodec: as?.codec_name ?? null,
    pixFmt: vs?.pix_fmt ?? null,
    container: p.format?.format_name ?? null,
    bitrateKbps: Number.isFinite(br) ? Math.round(br / 1000) : null,
  };
}

const EIGHT_BIT = new Set(['yuv420p', 'yuvj420p']);

/**
 * Apakah file asli bisa diputar langsung di semua browser utama (Chrome, Firefox, Safari)?
 * MP4/MOV: H.264 8-bit 4:2:0 + AAC/MP3/tanpa audio. WebM: VP8/VP9/AV1 + Opus/Vorbis/tanpa audio.
 */
export function isBrowserPlayable(s: ProbeSummary, fileName: string): boolean {
  if (!s.hasVideo) return false;
  const c = s.container ?? '';
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  const audioOk = (ok: string[]) => !s.audioCodec || ok.includes(s.audioCodec);
  if (c.includes('mp4') || c.includes('mov')) {
    return s.videoCodec === 'h264' && EIGHT_BIT.has(s.pixFmt ?? '') && audioOk(['aac', 'mp3']);
  }
  if (c.includes('webm') && ext === 'webm') {
    return ['vp8', 'vp9', 'av1'].includes(s.videoCodec ?? '') && audioOk(['opus', 'vorbis']);
  }
  return false;
}

export interface RenditionTarget {
  height: number;
  kind: 'quality' | 'compat';
}

/** Target rendition: kualitas < sisi pendek sumber, plus compat bila sumber tidak bisa diputar. */
export function planRenditions(
  shortSide: number,
  playable: boolean,
  wanted: readonly number[],
  compatMax: number,
): RenditionTarget[] {
  const out: RenditionTarget[] = [];
  let compatHeight = 0;
  if (!playable) {
    compatHeight = Math.max(144, Math.min(shortSide || compatMax, compatMax));
    compatHeight -= compatHeight % 2;
    out.push({ height: compatHeight, kind: 'compat' });
  }
  for (const h of [...new Set(wanted)].sort((a, b) => b - a)) {
    if (h < shortSide && h !== compatHeight) out.push({ height: h, kind: 'quality' });
  }
  return out;
}

/** Parameter encode per tinggi (SPEC §10.4). */
export function encodeParams(height: number): { crf: number; maxrate: string; bufsize: string; audio: string; profile: string } {
  if (height >= 1080) return { crf: 22, maxrate: '5000k', bufsize: '10000k', audio: '160k', profile: 'high' };
  if (height >= 720) return { crf: 23, maxrate: '3000k', bufsize: '6000k', audio: '128k', profile: 'high' };
  if (height >= 480) return { crf: 24, maxrate: '1500k', bufsize: '3000k', audio: '112k', profile: 'main' };
  return { crf: 26, maxrate: '900k', bufsize: '1800k', audio: '96k', profile: 'main' };
}

/** Lebar keluaran (genap) untuk tinggi sisi pendek tertentu, menjaga rasio. */
export function outputSize(srcW: number, srcH: number, target: number): { width: number; height: number } {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  if (srcH > srcW) return { width: target, height: even((srcH * target) / srcW) };
  return { width: even((srcW * target) / srcH), height: target };
}

export function storyboardInterval(durationSec: number): number {
  return Math.max(2, Math.ceil(durationSec / 300));
}
