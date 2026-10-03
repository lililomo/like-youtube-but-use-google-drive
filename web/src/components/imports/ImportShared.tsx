import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { apiGet, apiPost, errorMessage } from '../../lib/api';
import { formatDuration } from '../../lib/format';
import { toast } from '../../stores/toast';
import { Icon } from '../icons/Icon';
import { Button } from '../ui/Button';
import '../../styles/imports.css';

/** Komponen impor YouTube yang dipakai Studio admin (/admin/imports) dan halaman pengguna (/my/imports). */

export type ImportStatus = 'queued' | 'downloading' | 'uploading' | 'done' | 'failed' | 'cancelled';

export interface ImportItem {
  id: number;
  url: string;
  ytId: string;
  playlist: { id: string; title: string | null; index: number | null } | null;
  title: string | null;
  channel: string | null;
  durationSec: number | null;
  quality: string | null;
  sizeBytes: number | null;
  visibility: 'public' | 'private';
  category: string | null;
  status: ImportStatus;
  progress: number;
  /** Urutan dalam antrean server (1 = berikutnya), hanya untuk yang menunggu. */
  position: number | null;
  error: string | null;
  attempts: number;
  maxAttempts: number;
  retryAt: string | null;
  createdAt: string;
  finishedAt: string | null;
  video: { id: string; title: string | null; status: string | null; thumb: string | null } | null;
  /** Hanya di respons admin: channel tujuan (null = channel utama). */
  owner?: { id: number; username: string | null; name: string | null } | null;
}

export interface QueueCounts {
  waiting: number;
  running: number;
}

export interface AddResult {
  added: number;
  skipped: { input: string; reason: string }[];
  playlists: { id: string; title: string; total: number; added: number }[];
}

interface CategoryOption {
  id: number;
  name: string;
  depth: number;
}

export const STATUS_LABEL: Record<ImportStatus, string> = {
  queued: 'Menunggu',
  downloading: 'Mengunduh',
  uploading: 'Upload ke Drive',
  done: 'Selesai',
  failed: 'Gagal',
  cancelled: 'Dibatalkan',
};

export const VIDEO_STATUS: Record<string, string> = { pending: 'menunggu diproses', processing: 'diproses', ready: 'siap ditonton', failed: 'gagal diproses' };

export const isActive = (s: ImportStatus) => s === 'queued' || s === 'downloading' || s === 'uploading';

interface ImportFormProps {
  /** '/imports' (channel sendiri) atau '/admin/imports' (channel utama). */
  endpoint: string;
  /** Query yang disegarkan setelah menambah. */
  invalidateKey: readonly unknown[];
  maxHeight: number;
  maxPlaylistItems: number;
  intro?: ReactNode;
  className?: string;
}

/** Form tambah link video/playlist YouTube ke antrean. */
export function ImportForm({ endpoint, invalidateKey, maxHeight, maxPlaylistItems, intro, className = 'dv-imp-card' }: ImportFormProps) {
  const qc = useQueryClient();
  const [urls, setUrls] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [playlistMode, setPlaylistMode] = useState<'all' | 'video'>('all');
  const [result, setResult] = useState<AddResult | null>(null);
  const cats = useQuery({ queryKey: ['categories', 'all'], queryFn: () => apiGet<{ items: CategoryOption[] }>('/categories/all'), staleTime: 60_000 });
  const add = useMutation({
    mutationFn: () => apiPost<AddResult>(endpoint, { urls, visibility, categoryId, playlistMode }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: invalidateKey });
      toast(`${res.added} video masuk antrean${res.skipped.length ? ` · ${res.skipped.length} dilewati` : ''}`);
      setResult(res);
      if (res.added) setUrls('');
    },
    onError: (e) => toast(errorMessage(e)),
  });
  const count = urls.split(/[\s,]+/).filter(Boolean).length;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (count) add.mutate();
  };
  const cardTitle = className === 'dv-studio-card' ? 'dv-studio-card__title' : 'dv-imp-card__title';
  const cardSub = className === 'dv-studio-card' ? 'dv-studio-card__subtitle' : 'dv-imp-card__subtitle';

  return (
    <form className={className} onSubmit={submit}>
      <h2 className={cardTitle}>Tambah link</h2>
      <p className={cardSub}>
        {intro}
        {intro ? ' ' : ''}Video diunduh satu per satu di server dengan kualitas tertinggi sampai {maxHeight}p, lalu disimpan ke Google Drive dan diproses seperti video
        lain. Pastikan Anda berhak mengunduh dan menayangkan video tersebut.
      </p>
      <div className="dv-form">
        <textarea
          className="dv-textarea"
          rows={5}
          value={urls}
          onChange={(e) => setUrls(e.target.value)}
          placeholder={'Tempel link video atau playlist YouTube, satu per baris\nhttps://www.youtube.com/watch?v=…\nhttps://youtu.be/…\nhttps://www.youtube.com/playlist?list=…'}
          aria-label="Link YouTube"
          spellCheck={false}
        />
        <div className="dv-imp-form__opts">
          <select className="dv-select" value={visibility} onChange={(e) => setVisibility(e.target.value as 'public' | 'private')} aria-label="Visibilitas">
            <option value="public">Publik</option>
            <option value="private">Privat</option>
          </select>
          <select className="dv-select" value={categoryId ?? ''} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)} aria-label="Kategori">
            <option value="">Tanpa kategori (folder utama)</option>
            {(cats.data?.items ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {'— '.repeat(Math.max(0, c.depth - 1))}
                {c.name}
              </option>
            ))}
          </select>
          <select
            className="dv-select"
            value={playlistMode}
            onChange={(e) => setPlaylistMode(e.target.value as 'all' | 'video')}
            aria-label="Link berisi playlist"
            title="Untuk link video yang juga berisi playlist (…watch?v=…&list=…)"
          >
            <option value="all">Link berisi playlist: unduh semua</option>
            <option value="video">Link berisi playlist: video itu saja</option>
          </select>
          <Button type="submit" variant="primary" disabled={!count || add.isPending}>
            {add.isPending ? 'Menambahkan…' : count > 1 ? `Tambah ${count} link ke antrean` : 'Tambah ke antrean'}
          </Button>
        </div>
        <p className="dv-text-secondary dv-imp-form__hint">
          Playlist dibuka otomatis (maksimal {maxPlaylistItems} video per playlist) dan diunduh sesuai urutannya. Mix/Radio YouTube dan playlist pribadi
          (Tonton Nanti/Disukai) tidak didukung.
        </p>
        {result && (result.playlists.length > 0 || result.skipped.length > 0) && (
          <div className="dv-banner dv-banner--info dv-import-result">
            {result.playlists.map((p) => (
              <div key={p.id}>
                Playlist <strong>{p.title}</strong>: {p.added} dari {p.total} video masuk antrean
              </div>
            ))}
            {result.skipped.length > 0 && (
              <details>
                <summary>{result.skipped.length} dilewati</summary>
                <ul>
                  {result.skipped.map((x, i) => (
                    <li key={i}>
                      <span className="dv-import-result__name">{x.input}</span> — {x.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <Button size="sm" variant="text" onClick={() => setResult(null)}>
              Tutup
            </Button>
          </div>
        )}
      </div>
    </form>
  );
}

/** Thumbnail + judul + keterangan satu impor. */
export function ImportVideoCell({ it, extraMeta }: { it: ImportItem; extraMeta?: ReactNode }) {
  return (
    <div className="dv-import-row">
      <div className="dv-import-row__thumb">
        {it.video?.thumb ? <img src={it.video.thumb} alt="" loading="lazy" /> : <Icon name="download" />}
        {it.durationSec != null && <span className="dv-import-row__dur">{formatDuration(it.durationSec)}</span>}
      </div>
      <div className="dv-import-row__text">
        <div className="dv-table__primary dv-import-row__title" title={it.title ?? it.url}>
          {it.video ? (
            <Link className="dv-link" to={`/watch?v=${it.video.id}`}>
              {it.video.title ?? it.title}
            </Link>
          ) : (
            (it.title ?? it.ytId)
          )}
        </div>
        <div className="dv-text-secondary dv-import-row__meta">
          {it.channel && <span>{it.channel} · </span>}
          <a className="dv-link" href={it.url} target="_blank" rel="noreferrer noopener">
            youtube.com/…{it.ytId}
          </a>
          {' · '}
          {it.visibility === 'private' ? 'Privat' : 'Publik'}
          {it.category && ` · ${it.category}`}
        </div>
        {it.playlist && (
          <div className="dv-text-secondary dv-import-row__meta" title={it.playlist.title ?? it.playlist.id}>
            Playlist: {it.playlist.title ?? it.playlist.id}
            {it.playlist.index != null && ` · #${it.playlist.index}`}
          </div>
        )}
        {extraMeta}
      </div>
    </div>
  );
}
