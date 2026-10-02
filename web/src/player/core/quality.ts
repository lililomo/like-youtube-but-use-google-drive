/** Pemilihan kualitas (SPEC §16.6) — fungsi murni. */
export interface QualitySource {
  q: string;
  height: number;
  label: string;
  bitrateKbps: number | null;
}

export interface Conn {
  saveData?: boolean;
  effectiveType?: string;
}

/** Batas tinggi maksimum dari kondisi jaringan. */
export function networkCap(conn?: Conn | null): number {
  if (!conn) return Infinity;
  if (conn.saveData) return 360;
  if (conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g') return 360;
  if (conn.effectiveType === '3g') return 480;
  return Infinity;
}

/**
 * Pilihan awal "Otomatis": target = min(tinggi pemutar × DPR, 1080, batas jaringan);
 * ambil kualitas terkecil yang ≥ target, kalau tidak ada ambil tertinggi yang ≤ batas jaringan.
 */
export function pickAuto<T extends QualitySource>(sources: T[], playerHeightCss: number, dpr: number, conn?: Conn | null, exclude: ReadonlySet<string> = new Set()): T | null {
  const list = sources.filter((s) => !exclude.has(s.q)).sort((a, b) => a.height - b.height);
  if (!list.length) return null;
  const cap = networkCap(conn);
  const target = Math.min(Math.max(144, playerHeightCss * dpr), 1080, cap);
  const allowed = list.filter((s) => s.height <= cap || s.height === 0);
  const pool = allowed.length ? allowed : [list[0]!];
  return pool.find((s) => s.height >= target) ?? pool[pool.length - 1]!;
}

/** Sumber untuk preferensi manual: sama persis, kalau tidak ada yang terdekat di bawahnya. */
export function pickManual<T extends QualitySource>(sources: T[], q: string, exclude: ReadonlySet<string> = new Set()): T | null {
  const list = sources.filter((s) => !exclude.has(s.q)).sort((a, b) => b.height - a.height);
  const exact = list.find((s) => s.q === q);
  if (exact) return exact;
  const wanted = Number(q);
  if (Number.isFinite(wanted)) return list.find((s) => s.height <= wanted) ?? list[list.length - 1] ?? null;
  return list[0] ?? null;
}

/** Turun satu tingkat dari kualitas sekarang (untuk ABR/fallback). */
export function stepDown<T extends QualitySource>(sources: T[], current: T, exclude: ReadonlySet<string> = new Set()): T | null {
  return sources
    .filter((s) => !exclude.has(s.q) && s.height < current.height)
    .sort((a, b) => b.height - a.height)[0] ?? null;
}

export function stepUp<T extends QualitySource>(sources: T[], current: T, maxHeight: number, exclude: ReadonlySet<string> = new Set()): T | null {
  return sources
    .filter((s) => !exclude.has(s.q) && s.height > current.height && s.height <= maxHeight)
    .sort((a, b) => a.height - b.height)[0] ?? null;
}

export function shortLabel(label: string): string {
  return label.replace(/\s+(HD|4K)$/, '');
}
