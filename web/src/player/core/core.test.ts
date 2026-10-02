import { describe, expect, it } from 'vitest';
import { networkCap, pickAuto, pickManual, stepDown, stepUp, shortLabel } from './quality';
import { activeCues, parseVtt, sanitizeCueText } from './vtt';

const S = [
  { q: 'orig', height: 1080, label: '1080p HD', bitrateKbps: 5000 },
  { q: '720', height: 720, label: '720p', bitrateKbps: 2500 },
  { q: '360', height: 360, label: '360p', bitrateKbps: 400 },
];

describe('kualitas', () => {
  it('auto berdasarkan tinggi pemutar × DPR', () => {
    expect(pickAuto(S, 360, 1)?.q).toBe('360');
    expect(pickAuto(S, 400, 1)?.q).toBe('720');
    expect(pickAuto(S, 400, 2)?.q).toBe('orig');
    expect(pickAuto(S, 2000, 1)?.q).toBe('orig');
  });
  it('dibatasi jaringan', () => {
    expect(pickAuto(S, 700, 1, { effectiveType: '3g' })?.q).toBe('360');
    expect(pickAuto(S, 700, 1, { saveData: true })?.q).toBe('360');
    expect(networkCap({ effectiveType: '4g' })).toBe(Infinity);
  });
  it('mengecualikan sumber gagal', () => {
    expect(pickAuto(S, 1000, 1, null, new Set(['orig']))?.q).toBe('720');
    expect(pickAuto([], 100, 1)).toBeNull();
  });
  it('manual: persis atau terdekat di bawah', () => {
    expect(pickManual(S, '720')?.q).toBe('720');
    expect(pickManual(S, '480')?.q).toBe('360');
    expect(pickManual(S, 'orig')?.q).toBe('orig');
    expect(pickManual(S.slice(1), 'orig')?.q).toBe('720');
  });
  it('step down/up', () => {
    expect(stepDown(S, S[0]!)?.q).toBe('720');
    expect(stepDown(S, S[2]!)).toBeNull();
    expect(stepUp(S, S[2]!, 1080)?.q).toBe('720');
    expect(stepUp(S, S[1]!, 720)).toBeNull();
    expect(shortLabel('1080p HD')).toBe('1080p');
  });
});

describe('vtt', () => {
  const vtt = `WEBVTT

1
00:00:01.000 --> 00:00:04.000 line:90%
Halo <i>dunia</i>

00:05.500 --> 00:07.000
<script>alert(1)</script>Baris <b>dua</b>
lanjut

00:00:08.000 --> 00:00:07.000
rusak`;
  it('parse & sanitasi', () => {
    const cues = parseVtt(vtt);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({ start: 1, end: 4, html: 'Halo <i>dunia</i>' });
    expect(cues[1]!.start).toBe(5.5);
    expect(cues[1]!.html).toBe('alert(1)Baris <b>dua</b><br>lanjut');
    expect(sanitizeCueText('<img src=x onerror=1>a & b')).toBe('a &amp; b');
  });
  it('cue aktif', () => {
    const cues = parseVtt(vtt);
    expect(activeCues(cues, 2).length).toBe(1);
    expect(activeCues(cues, 4.5).length).toBe(0);
    expect(activeCues(cues, 6).length).toBe(1);
  });
});
