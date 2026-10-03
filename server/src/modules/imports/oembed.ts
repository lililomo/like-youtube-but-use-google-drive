/**
 * Judul & channel cepat lewat oEmbed YouTube (±100 ms, tanpa yt-dlp) untuk link video tunggal, agar antrean impor
 * langsung menampilkan judul asli, bukan hanya ID. Judul final tetap dari yt-dlp saat unduhan dimulai.
 */
import type { FastifyBaseLogger } from 'fastify';
import { request } from 'undici';
import { exec, query } from '../../db.js';
import { canonicalUrl } from './url.js';

const CONCURRENCY = 4;
/** Impor yang sudah dicoba tidak dicoba lagi sebelum jeda ini (video privat/dihapus → oEmbed selalu gagal). */
const RETRY_MS = 60 * 60_000;
const tried = new Map<number, number>();

export function parseOembed(raw: unknown): { title: string; channel: string | null } | null {
  if (!raw || typeof raw !== 'object') return null;
  const { title, author_name } = raw as { title?: unknown; author_name?: unknown };
  const t = typeof title === 'string' ? title.replace(/\s+/g, ' ').trim() : '';
  if (!t) return null;
  const c = typeof author_name === 'string' ? author_name.trim() : '';
  return { title: t.slice(0, 500), channel: c ? c.slice(0, 200) : null };
}

export async function fetchOembed(ytId: string): Promise<{ title: string; channel: string | null } | null> {
  const res = await request(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(canonicalUrl(ytId))}`, {
    headersTimeout: 10_000,
    bodyTimeout: 10_000,
  });
  if (res.statusCode !== 200) {
    await res.body.dump();
    return null;
  }
  return parseOembed(await res.body.json());
}

async function fillTitles(ids: number[], log: FastifyBaseLogger): Promise<void> {
  const rows = await query<{ id: number; yt_id: string }>('SELECT id, yt_id FROM youtube_imports WHERE id IN (?) AND title IS NULL', [ids]);
  const worker = async () => {
    for (let r = rows.shift(); r; r = rows.shift()) {
      try {
        const meta = await fetchOembed(r.yt_id);
        // `title IS NULL`: judul dari yt-dlp (job sudah berjalan) tidak ditimpa.
        if (meta) await exec('UPDATE youtube_imports SET title = ?, channel = COALESCE(channel, ?) WHERE id = ? AND title IS NULL', [meta.title, meta.channel, r.id]);
      } catch (err) {
        log.debug({ err, importId: r.id }, 'oEmbed YouTube gagal');
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

/** Isi judul impor yang masih kosong di latar belakang (tidak menunda respons API). */
export function fillTitlesSoon(ids: number[], log: FastifyBaseLogger): void {
  const now = Date.now();
  if (tried.size > 5000) for (const [id, at] of tried) if (at < now - RETRY_MS) tried.delete(id);
  const todo = ids.filter((id) => (tried.get(id) ?? 0) < now - RETRY_MS);
  if (!todo.length) return;
  for (const id of todo) tried.set(id, now);
  fillTitles(todo, log).catch((err) => log.warn({ err }, 'gagal mengisi judul impor YouTube'));
}
