/**
 * Fitur konten video untuk rekomendasi (REKOMENDASI.md §2) — fungsi murni, mudah dites.
 * Vektor = token judul + seri (playlist YouTube asal, batang judul, channel YouTube asal) + kategori + pemilik,
 * tiap kelompok berbobot lalu × IDF, sehingga fitur yang dimiliki hampir semua video (mis. channel utama) otomatis lemah.
 */

export type SparseVec = Map<string, number>;

export interface ItemInput {
  id: number;
  title: string;
  categoryId: number | null;
  categoryParentId: number | null;
  ownerId: number | null;
  playlistId: string | null;
  playlistIndex: number | null;
  ytChannel: string | null;
}

export interface Series {
  key: string;
  pos: number;
}

export interface ItemFeatures {
  id: number;
  /** L2-normal; bisa kosong bila tidak ada fitur yang dibagi dengan video lain. */
  vec: SparseVec;
  /** Kelompok untuk keragaman beranda (seri/channel/kategori). */
  cluster: string;
  /** Posisi dalam seri (episode), bila diketahui. */
  series: Series | null;
}

const GROUP_WEIGHT: Record<string, number> = { t: 1, pl: 1.6, st: 1.4, yc: 1, cat: 1.2, catp: 0.6, own: 0.5 };

// Kata umum (ID/EN) & kata teknis judul yang tidak membedakan isi video.
const STOPWORDS = new Set(
  (
    'dan yang di ke dari untuk dengan ini itu atau pada dalam adalah akan juga tidak ada bisa sudah saja kita kamu aku saya anda dia ' +
    'mereka para oleh karena jadi agar supaya tentang sebagai seperti lebih sangat bagi si sang nya pun lah kah mau ayo yuk cara ' +
    'the an of and or to in on for with by at is are be from your you my our this that it as how what why ' +
    'full hd video videos official new terbaru baru eps ep episode part bagian seri vol volume chapter bab jilid mnt menit min ' +
    'jam detik sub subtitle indo indonesia english lagu'
  ).split(/\s+/),
);

/** Token judul: huruf kecil tanpa diakritik, ≥ 2 karakter, bukan angka murni, bukan stopword. */
export function tokenize(title: string): string[] {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2 && !/^\d+$/.test(t) && !STOPWORDS.has(t));
}

const EPISODE = /^(.*?)(?:\b(?:episode|eps|ep|part|bagian|seri|chapter|bab|vol|volume|jilid)\b\.?\s*|#\s*)(\d{1,4})(?!\d)/i;

/** Nomor episode dari judul + "batang" judul sebelum penanda (nama seri), mis. "Huruf Hijaiyah Eps 13: …" → {stem, 13}. */
export function parseEpisode(title: string): { stem: string | null; n: number } | null {
  const m = EPISODE.exec(title);
  if (!m) return null;
  const n = Number(m[2]);
  if (!Number.isFinite(n)) return null;
  const stem = tokenize(m[1] ?? '').join(' ');
  return { stem: stem.length >= 4 ? stem : null, n };
}

function rawFeatures(it: ItemInput): { feats: Map<string, number>; series: Series | null } {
  const feats = new Map<string, number>();
  for (const t of tokenize(it.title)) feats.set(`t:${t}`, GROUP_WEIGHT.t!);
  const ep = parseEpisode(it.title);
  if (it.playlistId) feats.set(`pl:${it.playlistId}`, GROUP_WEIGHT.pl!);
  if (ep?.stem) feats.set(`st:${ep.stem}`, GROUP_WEIGHT.st!);
  const yc = it.ytChannel?.trim().toLowerCase();
  if (yc) feats.set(`yc:${yc}`, GROUP_WEIGHT.yc!);
  if (it.categoryId != null) feats.set(`cat:${it.categoryId}`, GROUP_WEIGHT.cat!);
  if (it.categoryParentId != null) feats.set(`catp:${it.categoryParentId}`, GROUP_WEIGHT.catp!);
  feats.set(`own:${it.ownerId ?? 'main'}`, GROUP_WEIGHT.own!);
  // Nomor di judul lebih andal daripada urutan playlist (playlist bisa terbalik, terbaru dulu).
  const series: Series | null =
    ep?.stem != null ? { key: `st:${ep.stem}`, pos: ep.n } : it.playlistId && it.playlistIndex != null ? { key: `pl:${it.playlistId}`, pos: it.playlistIndex } : null;
  return { feats, series };
}

export function normalize(vec: SparseVec): SparseVec {
  let sum = 0;
  for (const w of vec.values()) sum += w * w;
  if (sum <= 0) return new Map();
  const inv = 1 / Math.sqrt(sum);
  const out: SparseVec = new Map();
  for (const [k, w] of vec) out.set(k, w * inv);
  return out;
}

/** Kosinus dua vektor yang sudah L2-normal. */
export function cosine(a: SparseVec, b: SparseVec): number {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [k, w] of small) {
    const o = big.get(k);
    if (o !== undefined) dot += w * o;
  }
  return dot;
}

/** acc += w · vec (vektor jarang). */
export function addScaled(acc: SparseVec, vec: SparseVec, w: number): void {
  for (const [k, x] of vec) acc.set(k, (acc.get(k) ?? 0) + w * x);
}

export interface FeatureSet {
  items: Map<number, ItemFeatures>;
  /** Vektor untuk video di luar katalog (mis. video privat yang sedang ditonton pemiliknya) memakai statistik katalog. */
  vectorize(it: ItemInput): ItemFeatures;
}

export function buildFeatures(inputs: ItemInput[]): FeatureSet {
  const raws = inputs.map((it) => ({ it, ...rawFeatures(it) }));
  const df = new Map<string, number>();
  for (const r of raws) for (const k of r.feats.keys()) df.set(k, (df.get(k) ?? 0) + 1);
  const N = raws.length;
  const idf = (k: string, minDf: number): number => {
    const d = df.get(k) ?? 0;
    return d >= minDf ? Math.log((N + 1) / d) : 0;
  };

  const make = (it: ItemInput, feats: Map<string, number>, series: Series | null, minDf: number): ItemFeatures => {
    const vec: SparseVec = new Map();
    let topToken: [string, number] | null = null;
    for (const [k, g] of feats) {
      const w = idf(k, minDf);
      if (w <= 0) continue;
      vec.set(k, g * w);
      if (k.startsWith('t:') && (!topToken || w > topToken[1])) topToken = [k, w];
    }
    // Klaster: seri yang dibagi dengan video lain — nama seri dari judul dulu (konsisten walau sebagian episode diimpor
    // satu per satu dan sebagian dari playlist), lalu playlist, channel YouTube, kategori.
    const shared = (prefix: string) => [...feats.keys()].find((k) => k.startsWith(prefix) && (df.get(k) ?? 0) >= minDf);
    const cluster =
      shared('st:') ?? shared('pl:') ?? shared('yc:') ?? shared('cat:') ?? (topToken ? `own:${it.ownerId ?? 'main'}|${topToken[0]}` : `id:${it.id}`);
    return { id: it.id, vec: normalize(vec), cluster, series };
  };

  const items = new Map<number, ItemFeatures>();
  // df ≥ 2: fitur yang hanya dimiliki satu video tidak bisa mencocokkan apa pun, hanya mengencerkan vektor.
  for (const r of raws) items.set(r.it.id, make(r.it, r.feats, r.series, 2));
  return {
    items,
    vectorize(it) {
      const { feats, series } = rawFeatures(it);
      return make(it, feats, series, 1);
    },
  };
}
