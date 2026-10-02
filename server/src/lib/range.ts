/**
 * Validasi header Range untuk diteruskan ke Drive. Hanya satu range "bytes=" yang didukung;
 * multi-range → pakai range pertama. Mengembalikan header yang dinormalisasi, undefined bila tidak ada,
 * atau null bila tidak valid.
 */
export function normalizeRange(header: string | undefined): string | undefined | null {
  if (header === undefined || header === '') return undefined;
  const m = /^bytes=\s*(.+)$/i.exec(header.trim());
  if (!m) return null;
  const first = (m[1] ?? '').split(',')[0]!.trim();
  const r = /^(\d*)-(\d*)$/.exec(first);
  if (!r) return null;
  const [, a = '', b = ''] = r;
  if (!a && !b) return null;
  if (a && b && Number(a) > Number(b)) return null;
  if (a.length > 15 || b.length > 15) return null;
  return `bytes=${a}-${b}`;
}
