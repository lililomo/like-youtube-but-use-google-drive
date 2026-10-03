/**
 * Peringkat rekomendasi (REKOMENDASI.md §3–5) — fungsi murni: profil viewer, beranda, kolom kanan halaman tonton.
 */
import { addScaled, cosine, normalize, type ItemFeatures, type SparseVec } from './features.js';

export interface Candidate {
  id: number;
  f: ItemFeatures;
  /** 0..1 — popularitas + tren. */
  quality: number;
  /** 0..1 — exp(−umur/14 hari). */
  fresh: number;
}

/** video → (video → skor co-watch 0..1). */
export type CoWatch = Map<number, Map<number, number>>;

export interface WatchRow {
  videoId: number;
  maxPos: number;
  duration: number;
  plays: number;
  watchedAt: number;
}

export interface WatchSignal {
  completion: number;
  plays: number;
  ageMin: number;
  skip: boolean;
}

export interface Profile {
  /** Ada tontonan positif → mode personal (selain itu cold start). */
  personal: boolean;
  long: SparseVec | null;
  session: SparseVec | null;
  watched: Map<number, WatchSignal>;
  /** [videoId, bobot] tontonan positif — untuk co-watch. */
  weights: [number, number][];
  dislikedIds: Set<number>;
  dislikedVecs: SparseVec[];
  /** seri → episode terjauh yang ditonton ≥ 70% dalam 30 hari ("lanjutkan seri"). */
  seriesDone: Map<string, number>;
}

const DAY_MIN = 1440;

// ---------------------------------------------------------------------------
// Acak deterministik: seed sama → urutan sama (infinite scroll & tombol Kembali konsisten).
// ---------------------------------------------------------------------------

export function hashUnit(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Pengaduk akhir (murmur3 fmix32) agar seed yang mirip tidak menghasilkan angka yang mirip.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// Profil
// ---------------------------------------------------------------------------

export function buildProfile(rows: WatchRow[], feats: Map<number, ItemFeatures>, dislikedIds: number[], now = Date.now()): Profile {
  const long: SparseVec = new Map();
  const session: SparseVec = new Map();
  const watched = new Map<number, WatchSignal>();
  const weights: [number, number][] = [];
  const seriesDone = new Map<string, number>();
  for (const r of rows) {
    const completion = r.duration > 0 ? Math.min(1, r.maxPos / r.duration) : r.maxPos > 60 ? 0.5 : 0.2;
    const ageMin = Math.max(0, (now - r.watchedAt) / 60_000);
    // Klik lalu pergi (bukan tontonan yang baru saja dimulai).
    const skip = r.maxPos < 15 && completion < 0.2 && ageMin > 30;
    watched.set(r.videoId, { completion, plays: r.plays, ageMin, skip });
    const f = feats.get(r.videoId);
    if (!f || !f.vec.size) continue;
    if (skip) {
      addScaled(long, f.vec, -0.3);
      continue;
    }
    const engagement = 0.3 + 0.7 * completion;
    const rewatch = 1 + 0.3 * Math.min(Math.max(r.plays - 1, 0), 5);
    const w = engagement * rewatch * 0.5 ** (ageMin / DAY_MIN / 30);
    addScaled(long, f.vec, w);
    weights.push([r.videoId, w]);
    if (ageMin <= 180) addScaled(session, f.vec, engagement * 0.5 ** (ageMin / 60));
    if (f.series && completion >= 0.7 && ageMin <= 30 * DAY_MIN) {
      seriesDone.set(f.series.key, Math.max(seriesDone.get(f.series.key) ?? -Infinity, f.series.pos));
    }
  }
  const dislikedVecs: SparseVec[] = [];
  for (const id of dislikedIds) {
    const f = feats.get(id);
    if (!f || !f.vec.size) continue;
    addScaled(long, f.vec, -0.6);
    dislikedVecs.push(f.vec);
  }
  const personal = weights.length > 0;
  const l = normalize(long);
  const s = normalize(session);
  return {
    personal,
    long: personal && l.size ? l : null,
    session: s.size ? s : null,
    watched,
    weights,
    dislikedIds: new Set(dislikedIds),
    dislikedVecs,
    seriesDone,
  };
}

/** Rata-rata berbobot co-watch dari video yang ditonton ke setiap kandidat (0..1). */
function collaborative(profile: Profile, cow: CoWatch): Map<number, number> {
  const out = new Map<number, number>();
  let total = 0;
  for (const [id, w] of profile.weights) {
    total += w;
    const nb = cow.get(id);
    if (!nb) continue;
    for (const [other, s] of nb) out.set(other, (out.get(other) ?? 0) + w * s);
  }
  if (total > 0) for (const [k, v] of out) out.set(k, v / total);
  return out;
}

const pos0 = (x: number) => (x > 0 ? x : 0);

function seriesDelta(base: ItemFeatures, c: ItemFeatures): number | null {
  return base.series && c.series && base.series.key === c.series.key ? c.series.pos - base.series.pos : null;
}

// ---------------------------------------------------------------------------
// Keragaman (greedy): klaster yang sama berturut-turut diturunkan.
// ---------------------------------------------------------------------------

interface Scored {
  c: Candidate;
  s: number;
}

function diversify(
  sorted: Scored[],
  opts: { window: number; decay: number; adjacent: number; lookahead: number; limit: number; pinFirst?: boolean; topic?: number },
): Scored[] {
  const rest = sorted.slice();
  const out: Scored[] = [];
  if (opts.pinFirst && rest.length) out.push(rest.shift()!);
  while (rest.length && out.length < opts.limit) {
    const recent = out.slice(-opts.window);
    const prev = out[out.length - 1];
    let best = 0;
    let bestScore = -Infinity;
    const n = Math.min(rest.length, opts.lookahead);
    for (let i = 0; i < n; i++) {
      const it = rest[i]!;
      const same = recent.reduce((a, r) => a + (r.c.f.cluster === it.c.f.cluster ? 1 : 0), 0);
      let adj = it.s * opts.decay ** same;
      if (prev && prev.c.f.cluster === it.c.f.cluster) adj *= opts.adjacent;
      // Topik mirip dengan yang baru dipilih (walau beda seri) ikut diturunkan (MMR).
      if (opts.topic) {
        let maxSim = 0;
        for (let r = Math.max(0, out.length - 4); r < out.length; r++) maxSim = Math.max(maxSim, cosine(out[r]!.c.f.vec, it.c.f.vec));
        adj *= 1 - opts.topic * maxSim;
      }
      if (adj > bestScore) {
        bestScore = adj;
        best = i;
      }
    }
    out.push(rest.splice(best, 1)[0]!);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Beranda
// ---------------------------------------------------------------------------

function homeWatchFactor(w: WatchSignal | undefined): number {
  if (!w) return 1;
  if (w.skip) return 0.4;
  if (w.completion >= 0.9) {
    if (w.ageMin <= 180) return 0.1;
    return w.plays >= 3 ? 0.6 : 0.25;
  }
  if (w.completion >= 0.1) return w.ageMin <= 30 * DAY_MIN ? 0.85 : 0.5;
  return 0.7;
}

export const HOME_LIMIT = 600;
const EXPLORE_EVERY = 6;

export function rankHome(cands: Candidate[], profile: Profile | null, cow: CoWatch, seed: string, limit = HOME_LIMIT): number[] {
  const p = profile?.personal ? profile : null;
  const cf = p ? collaborative(p, cow) : new Map<number, number>();
  const scored: Scored[] = [];
  const explore: Scored[] = [];
  for (const c of cands) {
    if (profile?.dislikedIds.has(c.id)) continue;
    const u1 = hashUnit(`${seed}:${c.id}:a`);
    const u2 = hashUnit(`${seed}:${c.id}:b`);
    let s: number;
    if (p) {
      const cosP = p.long ? pos0(cosine(p.long, c.f.vec)) : 0;
      const cosS = p.session ? pos0(cosine(p.session, c.f.vec)) : 0;
      const w = p.watched.get(c.id);
      s = 0.4 * cosP + 0.2 * cosS + 0.2 * (cf.get(c.id) ?? 0) + 0.1 * c.quality + 0.1 * c.fresh;
      const done = c.f.series ? p.seriesDone.get(c.f.series.key) : undefined;
      if (!w && done !== undefined && c.f.series!.pos === done + 1) s += 0.25;
      s *= homeWatchFactor(w);
      if (p.dislikedVecs.some((v) => cosine(v, c.f.vec) > 0.5)) s *= 0.5;
      s = s * (0.8 + 0.4 * u1) + 0.06 * u2;
      // Di luar minat & belum ditonton → kandidat slot eksplorasi.
      if (cosP < 0.15 && !w) explore.push({ c, s: 0.4 * c.quality + 0.3 * c.fresh + 0.6 * u2 });
    } else {
      const starter = c.f.series?.pos === 1 ? 1 : 0;
      s = 0.3 * c.quality + 0.2 * c.fresh + 0.15 * starter + 0.35 * u1;
      const w = profile?.watched.get(c.id);
      if (w) s *= homeWatchFactor(w);
      if (profile?.dislikedVecs.some((v) => cosine(v, c.f.vec) > 0.5)) s *= 0.5;
    }
    scored.push({ c, s });
  }
  scored.sort((a, b) => b.s - a.s);
  const main = diversify(scored, { window: 6, decay: 0.6, adjacent: 0.5, lookahead: 40, limit, topic: 0.35 });
  if (!p || !explore.length) return main.map((x) => x.c.id);

  explore.sort((a, b) => b.s - a.s);
  const out: number[] = [];
  const used = new Set<number>();
  let mi = 0;
  let ei = 0;
  while (out.length < limit && (mi < main.length || ei < explore.length)) {
    const wantExplore = out.length % EXPLORE_EVERY === EXPLORE_EVERY - 2;
    let id: number | undefined;
    if (wantExplore) {
      while (ei < explore.length && used.has(explore[ei]!.c.id)) ei++;
      id = explore[ei]?.c.id;
      if (id !== undefined) ei++;
    }
    if (id === undefined) {
      while (mi < main.length && used.has(main[mi]!.c.id)) mi++;
      id = main[mi]?.c.id;
      if (id === undefined) break;
      mi++;
    }
    used.add(id);
    out.push(id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Kolom kanan halaman tonton
// ---------------------------------------------------------------------------

function relatedWatchFactor(w: WatchSignal | undefined): number {
  if (!w) return 1;
  if (w.ageMin <= 180) return 0.3;
  if (w.skip) return 0.5;
  if (w.completion >= 0.9) return w.plays >= 3 ? 0.6 : 0.35;
  return 0.9;
}

function seriesBoost(delta: number | null): number {
  if (delta === null) return 0;
  if (delta === 1) return 0.8;
  if (delta >= 2 && delta <= 5) return 0.1 * (1 - (delta - 2) / 4);
  if (delta === -1) return 0.05;
  return 0;
}

export const RELATED_LIMIT = 60;

export function rankRelated(
  base: ItemFeatures,
  cands: Candidate[],
  profile: Profile | null,
  cow: CoWatch,
  seed: string,
  filter: 'all' | 'related' = 'all',
  limit = RELATED_LIMIT,
): number[] {
  const nb = cow.get(base.id);
  const p = profile?.personal ? profile : null;
  const scored: Scored[] = [];
  for (const c of cands) {
    if (c.id === base.id || profile?.dislikedIds.has(c.id)) continue;
    const sim = cosine(base.vec, c.f.vec);
    const cw = nb?.get(c.id) ?? 0;
    const delta = seriesDelta(base, c.f);
    if (filter === 'related') {
      if (sim < 0.15 && cw < 0.1 && delta === null) continue;
      scored.push({ c, s: 0.7 * sim + 0.3 * cw + (delta === 1 ? 0.8 : 0) });
      continue;
    }
    let s = 0.45 * sim + 0.2 * cw + 0.08 * c.quality + 0.07 * c.fresh;
    if (p) {
      if (p.long) s += 0.15 * pos0(cosine(p.long, c.f.vec));
      if (p.session) s += 0.05 * pos0(cosine(p.session, c.f.vec));
    }
    s += seriesBoost(delta);
    s *= relatedWatchFactor(profile?.watched.get(c.id));
    s *= 0.9 + 0.2 * hashUnit(`${seed}:${c.id}:r`);
    scored.push({ c, s });
  }
  scored.sort((a, b) => b.s - a.s);
  if (filter === 'related') return scored.slice(0, limit).map((x) => x.c.id);
  return diversify(scored, { window: 4, decay: 0.85, adjacent: 1, lookahead: 30, limit, pinFirst: true }).map((x) => x.c.id);
}
