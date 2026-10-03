import { describe, expect, it } from 'vitest';
import { computeStats, qualityScore } from './catalog.js';
import { buildFeatures, cosine, parseEpisode, tokenize, type ItemInput } from './features.js';
import { buildProfile, hashUnit, rankHome, rankRelated, type Candidate, type WatchRow } from './rank.js';

const NOW = Date.parse('2026-10-03T12:00:00Z');
const MIN = 60_000;
const DAY = 1440 * MIN;

function item(id: number, title: string, extra: Partial<ItemInput> = {}): ItemInput {
  return { id, title, categoryId: null, categoryParentId: null, ownerId: null, playlistId: null, playlistIndex: null, ytChannel: null, ...extra };
}

/** Katalog uji: 3 seri × 8 episode + 6 video lepas, semua di channel utama tanpa kategori (seperti produksi). */
function catalog() {
  const inputs: ItemInput[] = [];
  let id = 1;
  for (let e = 1; e <= 8; e++) inputs.push(item(id++, `Belajar Huruf Hijaiyah Eps ${e}: Huruf ${e} - Yufid Kids`, { playlistId: 'PLhija', playlistIndex: e, ytChannel: 'Yufid Kids' }));
  for (let e = 1; e <= 8; e++) inputs.push(item(id++, `I'm Best Muslim S3 - Episode ${e} - Cerita ${e}`, { playlistId: 'PLbest', playlistIndex: 9 - e, ytChannel: 'Free Quran Education' }));
  for (let e = 1; e <= 8; e++) inputs.push(item(id++, `Bing Bahasa Indonesia Episode ${e} | Bing Kartun`, { ytChannel: 'Bing Bahasa Indonesia' }));
  for (const t of ['Murottal Juz 30 Anak', 'Lagu Anak Balonku', 'Mengenal Warna untuk Balita', 'Cerita Ubay Membereskan Mainan', 'Cerita Ubay Belajar Wudhu', 'Dinosaurus Kapur Bing'])
    inputs.push(item(id++, t));
  const fs = buildFeatures(inputs);
  const cands: Candidate[] = inputs.map((it) => ({ id: it.id, f: fs.items.get(it.id)!, quality: 0, fresh: 0 }));
  return { fs, cands };
}

const seriesOf = (id: number) => (id <= 8 ? 'hija' : id <= 16 ? 'best' : id <= 24 ? 'bing' : 'misc');

describe('fitur konten', () => {
  it('tokenisasi membuang stopword, angka, dan token 1 huruf', () => {
    expect(tokenize("I'm Best Muslim - S3 - Episode 08 dan Cerita yang Seru!")).toEqual(['best', 'muslim', 's3', 'cerita', 'seru']);
    expect(tokenize('Belajar Ḥuruf Hijaiyah')).toEqual(['belajar', 'huruf', 'hijaiyah']);
  });

  it('parser episode', () => {
    expect(parseEpisode('Belajar Huruf Hijaiyah Eps 13: Huruf Mim dan Huruf Nun')).toEqual({ stem: 'belajar huruf hijaiyah', n: 13 });
    expect(parseEpisode("I'm Best Muslim S4 // Ep 01: No Galap")).toEqual({ stem: 'best muslim s4', n: 1 });
    expect(parseEpisode("I'm The Best Muslim - S2 - Ep 07 - Belajar")).toEqual({ stem: 'best muslim s2', n: 7 });
    expect(parseEpisode('Kisah Nabi #5')).toEqual({ stem: 'kisah nabi', n: 5 });
    expect(parseEpisode('Bing: Episode Terbaik ⭐ 30+ mnt')).toBeNull();
    expect(parseEpisode('Serial Mengenal Angka 6-10')).toBeNull();
  });

  it('fitur milik semua video (channel utama) nyaris tak berbobot; seri yang sama mirip', () => {
    const { fs } = catalog();
    expect(fs.items.get(1)!.vec.get('own:main') ?? 0).toBeLessThan(0.02);
    const a = fs.items.get(1)!.vec;
    expect(cosine(a, fs.items.get(2)!.vec)).toBeGreaterThan(0.6);
    expect(cosine(a, fs.items.get(10)!.vec)).toBeLessThan(0.1);
    expect(cosine(a, a)).toBeCloseTo(1, 6);
  });

  it('seri: nomor judul diutamakan daripada urutan playlist (playlist bisa terbalik)', () => {
    const { fs } = catalog();
    expect(fs.items.get(10)!.series).toEqual({ key: 'st:best muslim s3', pos: 2 });
    expect(fs.items.get(1)!.cluster).toBe('st:belajar huruf hijaiyah');
    expect(fs.items.get(17)!.cluster).toBe('st:bing bahasa');
  });

  it('vectorize video di luar katalog memakai statistik katalog', () => {
    const { fs } = catalog();
    const v = fs.vectorize(item(999, 'Belajar Huruf Hijaiyah Eps 9: Huruf Kaf', { playlistId: 'PLhija', playlistIndex: 9 }));
    expect(cosine(v.vec, fs.items.get(8)!.vec)).toBeGreaterThan(0.5);
    expect(v.series).toEqual({ key: 'st:belajar huruf hijaiyah', pos: 9 });
  });
});

describe('kualitas', () => {
  it('data sedikit → 1 tayangan tidak mendominasi; data banyak → populer tinggi', () => {
    expect(qualityScore(1, 1, 0, 0)).toBeLessThan(0.2);
    expect(qualityScore(5000, 5000, 0, 0)).toBeCloseTo(1, 6);
    expect(qualityScore(50, 5000, 0, 0)).toBeLessThan(qualityScore(500, 5000, 0, 0));
    expect(qualityScore(0, 100, 40, 40)).toBeCloseTo(0.5, 6);
  });
});

describe('acak deterministik', () => {
  it('hashUnit 0..1 & stabil', () => {
    const x = hashUnit('abc');
    expect(x).toBe(hashUnit('abc'));
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThan(1);
    expect(hashUnit('abd')).not.toBe(x);
  });
});

describe('beranda', () => {
  it('cold start: seed sama → urutan sama, seed beda → urutan beda, semua video tampil', () => {
    const { cands } = catalog();
    const a = rankHome(cands, null, new Map(), 's1');
    expect(rankHome(cands, null, new Map(), 's1')).toEqual(a);
    expect(rankHome(cands, null, new Map(), 's2')).not.toEqual(a);
    expect(new Set(a).size).toBe(cands.length);
  });

  it('cold start: beragam (tidak ada 3 video seri yang sama berturut-turut di 12 teratas)', () => {
    const { cands } = catalog();
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      const top = rankHome(cands, null, new Map(), seed).slice(0, 12).map(seriesOf);
      for (let i = 2; i < top.length; i++) expect(top[i] === top[i - 1] && top[i] === top[i - 2] && top[i] !== 'misc').toBe(false);
    }
  });

  it('cold start: episode pertama lebih sering di atas', () => {
    const { cands } = catalog();
    let firsts = 0;
    for (let i = 0; i < 40; i++) {
      const top = rankHome(cands, null, new Map(), `x${i}`).slice(0, 8);
      firsts += top.filter((id) => id === 1 || id === 9 + 7 || id === 17).length;
    }
    // 3 dari 30 video = 10% → tanpa dorongan rata-rata ±0,8 per 8 teratas.
    expect(firsts / 40).toBeGreaterThan(1.1);
  });

  it('personal: penonton seri Hijaiyah → seri itu dominan, tetap ada seri lain & slot eksplorasi', () => {
    const { fs, cands } = catalog();
    const rows: WatchRow[] = [1, 2, 3].map((id, i) => ({ videoId: id, maxPos: 300, duration: 300, plays: 1, watchedAt: NOW - (i + 1) * DAY }));
    const profile = buildProfile(rows, fs.items, [], NOW);
    expect(profile.personal).toBe(true);
    const top = rankHome(cands, profile, new Map(), 'p').slice(0, 12);
    const hija = top.filter((id) => seriesOf(id) === 'hija').length;
    expect(hija).toBeGreaterThanOrEqual(4);
    expect(hija).toBeLessThan(12);
    // Episode berikutnya yang belum ditonton ("lanjutkan seri") ada di 3 teratas.
    expect(top.slice(0, 3)).toContain(4);
    // Yang sudah selesai ditonton tidak di atas.
    expect(top.slice(0, 6)).not.toContain(1);
  });

  it('Tidak tertarik: video dibuang & seri mirip turun', () => {
    const { fs, cands } = catalog();
    const profile = buildProfile([], fs.items, [17], NOW);
    const ids = rankHome(cands, profile, new Map(), 'q');
    expect(ids).not.toContain(17);
    let bingTop = 0;
    for (let i = 0; i < 20; i++) bingTop += rankHome(cands, profile, new Map(), `q${i}`).slice(0, 8).filter((id) => seriesOf(id) === 'bing').length;
    expect(bingTop / 20).toBeLessThan(2);
  });
});

describe('kolom kanan', () => {
  it('episode berikutnya di urutan pertama, lalu seri yang sama', () => {
    const { fs, cands } = catalog();
    for (const seed of ['a', 'b', 'c']) {
      const ids = rankRelated(fs.items.get(3)!, cands, null, new Map(), seed);
      expect(ids[0]).toBe(4);
      expect(ids).not.toContain(3);
      expect(ids.slice(0, 6).filter((id) => seriesOf(id) === 'hija').length).toBeGreaterThanOrEqual(4);
    }
    // Seri playlist terbalik: nomor judul tetap benar (Episode 2 → Episode 3 = id 11).
    expect(rankRelated(fs.items.get(10)!, cands, null, new Map(), 'z')[0]).toBe(11);
  });

  it('video yang baru saja ditonton turun; kebiasaan viewer ikut menentukan', () => {
    const { fs, cands } = catalog();
    const justWatched = buildProfile([{ videoId: 4, maxPos: 300, duration: 300, plays: 1, watchedAt: NOW - 10 * MIN }], fs.items, [], NOW);
    expect(rankRelated(fs.items.get(3)!, cands, justWatched, new Map(), 'a')[0]).not.toBe(4);
    // Dari video lepas: penggemar Bing mendapat Bing lebih tinggi daripada penonton baru.
    const bingFan = buildProfile(
      [17, 18, 19, 20].map((id, i) => ({ videoId: id, maxPos: 200, duration: 200, plays: 2, watchedAt: NOW - (i + 2) * DAY })),
      fs.items,
      [],
      NOW,
    );
    const base = fs.items.get(25)!;
    const bingIn = (ids: number[]) => ids.slice(0, 8).filter((id) => seriesOf(id) === 'bing').length;
    expect(bingIn(rankRelated(base, cands, bingFan, new Map(), 'a'))).toBeGreaterThan(bingIn(rankRelated(base, cands, null, new Map(), 'a')));
  });

  it('co-watch: yang sering ditonton bersama naik', () => {
    const { fs, cands } = catalog();
    const rows = [];
    for (let v = 0; v < 5; v++) {
      rows.push({ k: `g${v}`, videoId: 25, maxPos: 100, duration: 100, at: NOW - v * DAY });
      rows.push({ k: `g${v}`, videoId: 30, maxPos: 100, duration: 100, at: NOW - v * DAY + 5 * MIN });
    }
    const st = computeStats(rows, NOW);
    expect(st.cow.get(25)!.get(30)).toBeGreaterThan(0.5);
    expect(st.trend.get(25)).toBe(5);
    expect(rankRelated(fs.items.get(25)!, cands, null, st.cow, 'a').slice(0, 3)).toContain(30);
  });

  it('filter Terkait hanya yang mirip', () => {
    const { fs, cands } = catalog();
    const ids = rankRelated(fs.items.get(3)!, cands, null, new Map(), 'a', 'related');
    expect(ids.every((id) => seriesOf(id) === 'hija')).toBe(true);
    expect(ids[0]).toBe(4);
  });
});
