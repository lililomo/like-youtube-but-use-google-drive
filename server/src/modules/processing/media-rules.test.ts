import { describe, expect, it } from 'vitest';
import { encodeParams, isBrowserPlayable, outputSize, planRenditions, storyboardInterval, summarizeProbe, type ProbeSummary } from './media-rules.js';

const base: ProbeSummary = {
  hasVideo: true, width: 1920, height: 1080, rotation: null, durationSec: 60, videoCodec: 'h264', audioCodec: 'aac',
  pixFmt: 'yuv420p', container: 'mov,mp4,m4a,3gp,3g2,mj2', bitrateKbps: 5000,
};

describe('isBrowserPlayable', () => {
  it.each<[string, Partial<ProbeSummary>, string, boolean]>([
    ['mp4 h264 aac', {}, 'a.mp4', true],
    ['mp4 h264 tanpa audio', { audioCodec: null }, 'a.mp4', true],
    ['mov h264 aac', {}, 'a.mov', true],
    ['mp4 hevc', { videoCodec: 'hevc' }, 'a.mp4', false],
    ['mp4 h264 10-bit', { pixFmt: 'yuv420p10le' }, 'a.mp4', false],
    ['mp4 h264 ac3', { audioCodec: 'ac3' }, 'a.mp4', false],
    ['webm vp9 opus', { videoCodec: 'vp9', audioCodec: 'opus', container: 'matroska,webm' }, 'a.webm', true],
    ['mkv vp9 (bukan .webm)', { videoCodec: 'vp9', audioCodec: 'opus', container: 'matroska,webm' }, 'a.mkv', false],
    ['mkv h264', { container: 'matroska,webm' }, 'a.mkv', false],
    ['avi', { container: 'avi', videoCodec: 'mpeg4' }, 'a.avi', false],
    ['tanpa video', { hasVideo: false }, 'a.mp4', false],
  ])('%s', (_n, o, name, expected) => {
    expect(isBrowserPlayable({ ...base, ...o }, name)).toBe(expected);
  });
});

describe('summarizeProbe', () => {
  it('rotasi 90 menukar dimensi & mengabaikan cover art', () => {
    const s = summarizeProbe({
      streams: [
        { codec_type: 'video', codec_name: 'mjpeg', width: 300, height: 300, disposition: { attached_pic: 1 } },
        { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, pix_fmt: 'yuv420p', side_data_list: [{ rotation: -90 }] },
        { codec_type: 'audio', codec_name: 'aac' },
      ],
      format: { format_name: 'mov,mp4', duration: '12.5', bit_rate: '4000000' },
    });
    expect(s).toMatchObject({ width: 1080, height: 1920, rotation: 270, durationSec: 12.5, videoCodec: 'h264', audioCodec: 'aac', bitrateKbps: 4000 });
  });
});

describe('planRenditions', () => {
  it('1080p playable → 720 & 360', () => {
    expect(planRenditions(1080, true, [720, 360], 1080)).toEqual([
      { height: 720, kind: 'quality' },
      { height: 360, kind: 'quality' },
    ]);
  });
  it('720p playable → hanya 360 (tidak upscale/duplikat)', () => {
    expect(planRenditions(720, true, [720, 360], 1080)).toEqual([{ height: 360, kind: 'quality' }]);
  });
  it('HEVC 720p → compat 720 + 360', () => {
    expect(planRenditions(720, false, [720, 360], 1080)).toEqual([
      { height: 720, kind: 'compat' },
      { height: 360, kind: 'quality' },
    ]);
  });
  it('4K tak terputar → compat dibatasi 1080', () => {
    expect(planRenditions(2160, false, [720], 1080)).toEqual([
      { height: 1080, kind: 'compat' },
      { height: 720, kind: 'quality' },
    ]);
  });
  it('sumber kecil 240p → tidak ada rendition kualitas', () => {
    expect(planRenditions(240, true, [720, 360], 1080)).toEqual([]);
  });
});

describe('ukuran & parameter', () => {
  it('outputSize', () => {
    expect(outputSize(1920, 1080, 720)).toEqual({ width: 1280, height: 720 });
    expect(outputSize(1080, 1920, 720)).toEqual({ width: 720, height: 1280 });
    expect(outputSize(1000, 562, 360)).toEqual({ width: 640, height: 360 });
  });
  it('encodeParams & storyboard', () => {
    expect(encodeParams(720).crf).toBe(23);
    expect(encodeParams(360).maxrate).toBe('900k');
    expect(storyboardInterval(30)).toBe(2);
    expect(storyboardInterval(3600)).toBe(12);
  });
});

import { frameScore } from './handlers.js';
describe('frameScore', () => {
  it('frame biru polos lebih baik dari hitam polos', () => {
    const black = { entropy: 0, channels: [{ mean: 0, stdev: 0 }, { mean: 0, stdev: 0 }, { mean: 0, stdev: 0 }] };
    const blue = { entropy: 0, channels: [{ mean: 0, stdev: 0 }, { mean: 0, stdev: 0 }, { mean: 255, stdev: 0 }] };
    const busy = { entropy: 6, channels: [{ mean: 120, stdev: 60 }, { mean: 110, stdev: 50 }, { mean: 100, stdev: 70 }] };
    expect(frameScore(blue)).toBeGreaterThan(frameScore(black));
    expect(frameScore(busy)).toBeGreaterThan(frameScore(blue));
  });
});
