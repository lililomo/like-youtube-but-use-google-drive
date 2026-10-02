/** Format angka & waktu ala YouTube Indonesia (SPEC §15.7). */

function compact(n: number, unit: number, suffix: string): string {
  const v = n / unit;
  if (v < 10) {
    const one = Math.floor(v * 10) / 10;
    return `${one.toLocaleString('id-ID', { maximumFractionDigits: 1 })} ${suffix}`;
  }
  return `${Math.floor(v).toLocaleString('id-ID')} ${suffix}`;
}

/** 1234 → "1,2 rb", 12_345_678 → "12 jt". */
export function formatCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n < 1000) return String(Math.floor(n));
  if (n < 1_000_000) return compact(n, 1000, 'rb');
  if (n < 1_000_000_000) return compact(n, 1_000_000, 'jt');
  return compact(n, 1_000_000_000, 'M');
}

export function formatViews(n: number): string {
  if (!n) return 'Belum ditonton';
  return `${formatCount(n)} x ditonton`;
}

const UNITS: [number, string][] = [
  [365 * 24 * 3600, 'tahun'],
  [30 * 24 * 3600, 'bulan'],
  [7 * 24 * 3600, 'minggu'],
  [24 * 3600, 'hari'],
  [3600, 'jam'],
  [60, 'menit'],
];

/** "3 hari yang lalu", "baru saja". */
export function formatRelative(date: string | number | Date, now: number = Date.now()): string {
  const t = new Date(date).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = Math.max(0, Math.floor((now - t) / 1000));
  for (const [sec, label] of UNITS) {
    if (diff >= sec) return `${Math.floor(diff / sec)} ${label} yang lalu`;
  }
  return 'baru saja';
}

/** 75 → "1:15", 3725 → "1:02:05". */
export function formatDuration(totalSec: number | null | undefined): string {
  if (totalSec == null || !Number.isFinite(totalSec) || totalSec < 0) return '';
  const s = Math.floor(totalSec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toLocaleString('id-ID', { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 })} ${units[i]}`;
}

export function formatDate(date: string | number | Date): string {
  const d = new Date(date);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(date: string | number | Date): string {
  const d = new Date(date);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatVideoCount(n: number): string {
  return n === 0 ? 'Tidak ada video' : `${n.toLocaleString('id-ID')} video`;
}
