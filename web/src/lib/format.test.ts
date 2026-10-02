import { describe, expect, it } from 'vitest';
import { groupByDay, historyDayLabel } from './format';
import { formatBytes, formatCount, formatDuration, formatRelative, formatVideoCount, formatViews } from './format';
import { safeNext } from './url';

describe('formatCount / formatViews', () => {
  it.each([
    [0, 'Belum ditonton'],
    [1, '1 x ditonton'],
    [999, '999 x ditonton'],
    [1000, '1 rb x ditonton'],
    [1234, '1,2 rb x ditonton'],
    [9999, '9,9 rb x ditonton'],
    [12_345, '12 rb x ditonton'],
    [999_999, '999 rb x ditonton'],
    [1_200_000, '1,2 jt x ditonton'],
    [45_000_000, '45 jt x ditonton'],
    [1_500_000_000, '1,5 M x ditonton'],
  ])('%i → %s', (n, expected) => {
    expect(formatViews(n)).toBe(expected);
  });

  it('formatCount angka negatif/NaN → 0', () => {
    expect(formatCount(-5)).toBe('0');
    expect(formatCount(Number.NaN)).toBe('0');
  });
});

describe('formatRelative', () => {
  const now = Date.UTC(2026, 9, 2, 12, 0, 0);
  it.each([
    [now - 10_000, 'baru saja'],
    [now - 5 * 60_000, '5 menit yang lalu'],
    [now - 3 * 3600_000, '3 jam yang lalu'],
    [now - 2 * 86400_000, '2 hari yang lalu'],
    [now - 15 * 86400_000, '2 minggu yang lalu'],
    [now - 65 * 86400_000, '2 bulan yang lalu'],
    [now - 800 * 86400_000, '2 tahun yang lalu'],
  ])('%i → %s', (t, expected) => {
    expect(formatRelative(t, now)).toBe(expected);
  });
  it('tanggal masa depan dianggap baru saja', () => {
    expect(formatRelative(now + 60_000, now)).toBe('baru saja');
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '0:00'],
    [5, '0:05'],
    [75, '1:15'],
    [600, '10:00'],
    [3725, '1:02:05'],
    [36000, '10:00:00'],
  ])('%i → %s', (s, expected) => {
    expect(formatDuration(s)).toBe(expected);
  });
  it('null/negatif → kosong', () => {
    expect(formatDuration(null)).toBe('');
    expect(formatDuration(-1)).toBe('');
  });
});

describe('lainnya', () => {
  it('formatBytes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1,5 KB');
    expect(formatBytes(5 * 1024 ** 3)).toBe('5 GB');
  });
  it('formatVideoCount', () => {
    expect(formatVideoCount(0)).toBe('Tidak ada video');
    expect(formatVideoCount(12)).toBe('12 video');
  });
  it('safeNext hanya path internal', () => {
    expect(safeNext('/watch?v=abc')).toBe('/watch?v=abc');
    expect(safeNext('//evil.com')).toBe('/');
    expect(safeNext('https://evil.com')).toBe('/');
    expect(safeNext('/\\evil.com')).toBe('/');
    expect(safeNext(null)).toBe('/');
    expect(safeNext('/login?next=/x')).toBe('/');
  });
});

describe('histori per hari', () => {
  const now = new Date(2026, 9, 2, 10, 0); // Jumat 2 Okt 2026, waktu lokal
  it('label hari', () => {
    expect(historyDayLabel(new Date(2026, 9, 2, 0, 5), now)).toBe('Hari ini');
    expect(historyDayLabel(new Date(2026, 9, 1, 23, 59), now)).toBe('Kemarin');
    expect(historyDayLabel(new Date(2026, 8, 28, 12), now)).toBe('Senin');
    expect(historyDayLabel(new Date(2026, 8, 12, 12), now)).toMatch(/12 Sep/);
    expect(historyDayLabel(new Date(2025, 11, 30, 12), now)).toMatch(/2025/);
  });
  it('groupByDay menjaga urutan', () => {
    const items = [new Date(2026, 9, 2, 9), new Date(2026, 9, 2, 8), new Date(2026, 9, 1, 8), new Date(2026, 8, 12)].map((d, i) => ({ i, at: d.toISOString() }));
    const g = groupByDay(items, (x) => x.at, now);
    expect(g.map((x) => [x.label, x.items.length])).toEqual([['Hari ini', 2], ['Kemarin', 1], [expect.stringMatching(/12 Sep/), 1]]);
  });
});
