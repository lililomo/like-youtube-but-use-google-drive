import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Icon } from '../../components/icons/Icon';
import { Button } from '../../components/ui/Button';
import { EmptyState, Spinner } from '../../components/ui/misc';
import { useDocumentTitle } from '../../hooks/useSite';
import { apiDelete, apiGet, apiPost, errorMessage } from '../../lib/api';
import { formatBytes, formatDateTime, formatDuration, formatRelative } from '../../lib/format';
import { toast } from '../../stores/toast';

type Status = 'queued' | 'downloading' | 'uploading' | 'done' | 'failed' | 'cancelled';

interface ImportItem {
  id: number;
  url: string;
  ytId: string;
  title: string | null;
  channel: string | null;
  durationSec: number | null;
  quality: string | null;
  sizeBytes: number | null;
  visibility: 'public' | 'private';
  category: string | null;
  status: Status;
  progress: number;
  error: string | null;
  attempts: number;
  maxAttempts: number;
  retryAt: string | null;
  createdAt: string;
  finishedAt: string | null;
  video: { id: string; title: string | null; status: string | null; thumb: string | null } | null;
}

interface ImportsResponse {
  items: ImportItem[];
  nextCursor: string | null;
  summary: Record<'queued' | 'running' | 'done' | 'failed' | 'cancelled', number>;
  maxHeight: number;
}

interface CategoryOption {
  id: number;
  name: string;
  depth: number;
}

const STATUS_LABEL: Record<Status, string> = {
  queued: 'Menunggu',
  downloading: 'Mengunduh',
  uploading: 'Upload ke Drive',
  done: 'Selesai',
  failed: 'Gagal',
  cancelled: 'Dibatalkan',
};
const PILL: Record<Status, string> = {
  queued: '',
  downloading: 'running',
  uploading: 'running',
  done: 'done',
  failed: 'failed',
  cancelled: '',
};
const VIDEO_STATUS: Record<string, string> = { pending: 'menunggu diproses', processing: 'diproses', ready: 'siap ditonton', failed: 'gagal diproses' };

function AddForm({ maxHeight }: { maxHeight: number }) {
  const qc = useQueryClient();
  const [urls, setUrls] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const cats = useQuery({ queryKey: ['categories', 'all'], queryFn: () => apiGet<{ items: CategoryOption[] }>('/categories/all'), staleTime: 60_000 });
  const add = useMutation({
    mutationFn: () => apiPost<{ added: number; skipped: { input: string; reason: string }[] }>('/admin/imports', { urls, visibility, categoryId }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['admin', 'imports'] });
      const skip = res.skipped.length ? ` · ${res.skipped.length} dilewati (${res.skipped.map((s) => `${s.input.slice(0, 40)}: ${s.reason}`).join('; ')})` : '';
      toast(`${res.added} video masuk antrean${skip}`);
      if (res.added) setUrls(res.skipped.map((s) => s.input).join('\n'));
    },
    onError: (e) => toast(errorMessage(e)),
  });
  const count = urls.split(/[\s,]+/).filter(Boolean).length;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (count) add.mutate();
  };

  return (
    <form className="dv-studio-card" onSubmit={submit}>
      <h2 className="dv-studio-card__title">Tambah link</h2>
      <p className="dv-studio-card__subtitle">
        Video diunduh satu per satu di server dengan kualitas tertinggi sampai {maxHeight}p (utamakan H.264 + AAC agar langsung bisa diputar di semua
        perangkat), lalu diupload ke folder Google Drive dan diproses seperti video lain. Pastikan Anda berhak mengunduh dan menayangkan video tersebut.
      </p>
      <div className="dv-form">
        <textarea
          className="dv-textarea"
          rows={6}
          value={urls}
          onChange={(e) => setUrls(e.target.value)}
          placeholder={'Tempel link YouTube, satu per baris\nhttps://www.youtube.com/watch?v=…\nhttps://youtu.be/…\nhttps://www.youtube.com/shorts/…'}
          aria-label="Link YouTube"
          spellCheck={false}
        />
        <div className="dv-row" style={{ flexWrap: 'wrap', gap: 12 }}>
          <select className="dv-select" style={{ width: 170 }} value={visibility} onChange={(e) => setVisibility(e.target.value as 'public' | 'private')} aria-label="Visibilitas">
            <option value="public">Publik</option>
            <option value="private">Privat</option>
          </select>
          <select
            className="dv-select"
            style={{ width: 260 }}
            value={categoryId ?? ''}
            onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}
            aria-label="Kategori"
          >
            <option value="">Tanpa kategori (folder utama)</option>
            {(cats.data?.items ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {'— '.repeat(Math.max(0, c.depth - 1))}
                {c.name}
              </option>
            ))}
          </select>
          <Button type="submit" variant="primary" disabled={!count || add.isPending}>
            {add.isPending ? 'Menambahkan…' : count > 1 ? `Tambah ${count} link ke antrean` : 'Tambah ke antrean'}
          </Button>
        </div>
      </div>
    </form>
  );
}

function ToolCard() {
  const qc = useQueryClient();
  const tool = useQuery({ queryKey: ['admin', 'imports', 'tool'], queryFn: () => apiGet<{ installed: boolean; version: string | null; path: string }>('/admin/imports/tool') });
  const update = useMutation({
    mutationFn: () => apiPost<{ version: string; message: string }>('/admin/imports/tool/update'),
    onSuccess: (r) => {
      toast(r.message || `yt-dlp ${r.version}`);
      void qc.invalidateQueries({ queryKey: ['admin', 'imports', 'tool'] });
    },
    onError: (e) => toast(errorMessage(e)),
  });
  if (!tool.data) return null;
  return (
    <div className={`dv-banner ${tool.data.installed ? 'dv-banner--info' : 'dv-banner--error'}`} style={{ marginBottom: 16 }}>
      <div className="dv-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <span>
          {tool.data.installed ? (
            <>
              Pengunduh: <strong>yt-dlp {tool.data.version ?? '?'}</strong> — diperbarui otomatis setiap hari. Bila banyak impor gagal dengan pesan
              &ldquo;bukan bot&rdquo; atau dibatasi umur, simpan cookies akun YouTube (format Netscape) di server:{' '}
              <code className="dv-code">storage/private/youtube-cookies.txt</code>.
            </>
          ) : (
            <>
              yt-dlp belum terpasang. Di server jalankan <code className="dv-code">bash scripts/ops/install-yt-dlp.sh</code>.
            </>
          )}
        </span>
        {tool.data.installed && (
          <Button size="sm" variant="text" onClick={() => update.mutate()} disabled={update.isPending}>
            {update.isPending ? 'Memperbarui…' : 'Perbarui sekarang'}
          </Button>
        )}
      </div>
    </div>
  );
}

export function ImportsPage() {
  useDocumentTitle('Impor YouTube - Studio');
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'imports'],
    queryFn: () => apiGet<ImportsResponse>('/admin/imports?limit=200'),
    refetchInterval: (q) => (q.state.data && (q.state.data.summary.running || q.state.data.summary.queued) ? 2000 : 10_000),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'imports'] });
  const retry = useMutation({ mutationFn: (id: number) => apiPost(`/admin/imports/${id}/retry`), onSuccess: refresh, onError: (e) => toast(errorMessage(e)) });
  const remove = useMutation({ mutationFn: (id: number) => apiDelete(`/admin/imports/${id}`), onSuccess: refresh, onError: (e) => toast(errorMessage(e)) });

  return (
    <div className="dv-studio-page">
      <h1 className="dv-studio-page__title">Impor dari YouTube</h1>
      <ToolCard />
      <AddForm maxHeight={data?.maxHeight ?? 1080} />
      {data && (
        <div className="dv-stat-row" style={{ marginTop: 24 }}>
          {(
            [
              ['running', 'Berjalan'],
              ['queued', 'Menunggu'],
              ['failed', 'Gagal'],
              ['done', 'Selesai'],
            ] as const
          ).map(([k, label]) => (
            <div className="dv-stat" key={k}>
              <div className="dv-stat__value">{data.summary[k]}</div>
              <div className="dv-stat__label">{label}</div>
            </div>
          ))}
        </div>
      )}
      {isLoading && <Spinner />}
      {error && <div className="dv-banner dv-banner--error">{errorMessage(error)}</div>}
      {data && data.items.length === 0 && <EmptyState icon="download" title="Belum ada impor" />}
      {data && data.items.length > 0 && (
        <div className="dv-table-wrap">
          <table className="dv-table">
            <thead>
              <tr>
                <th>Video</th>
                <th>Status</th>
                <th>Kualitas</th>
                <th>Waktu</th>
                <th aria-label="Aksi" />
              </tr>
            </thead>
            <tbody>
              {data.items.map((it) => (
                <tr key={it.id}>
                  <td className="dv-table__title">
                    <div className="dv-import-row">
                      <div className="dv-import-row__thumb">
                        {it.video?.thumb ? <img src={it.video.thumb} alt="" loading="lazy" /> : <Icon name="download" />}
                        {it.durationSec != null && <span className="dv-import-row__dur">{formatDuration(it.durationSec)}</span>}
                      </div>
                      <div style={{ minWidth: 0 }}>
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
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`dv-pill ${PILL[it.status] ? `dv-pill--${PILL[it.status]}` : ''}`}>{STATUS_LABEL[it.status]}</span>
                    {(it.status === 'downloading' || it.status === 'uploading') && (
                      <div className="dv-progress" aria-label={`${it.progress}%`}>
                        <div className="dv-progress__bar" style={{ width: `${it.progress}%` }} />
                      </div>
                    )}
                    {it.status === 'done' && it.video?.status && it.video.status !== 'ready' && (
                      <div className="dv-text-secondary" style={{ fontSize: '1.2rem', marginTop: 4 }}>
                        Video {VIDEO_STATUS[it.video.status] ?? it.video.status}
                      </div>
                    )}
                    {it.retryAt && <div className="dv-text-secondary">dicoba lagi {formatDateTime(it.retryAt)}</div>}
                    {it.error && (
                      <div className="dv-table__error" title={it.error}>
                        {it.error}
                      </div>
                    )}
                  </td>
                  <td>
                    <div>{it.quality ?? '—'}</div>
                    {it.sizeBytes != null && <div className="dv-text-secondary">{formatBytes(it.sizeBytes)}</div>}
                  </td>
                  <td title={formatDateTime(it.createdAt)}>{formatRelative(it.finishedAt ?? it.createdAt)}</td>
                  <td className="dv-table__actions">
                    {(it.status === 'failed' || it.status === 'cancelled') && (
                      <Button size="sm" variant="text" onClick={() => retry.mutate(it.id)}>
                        Coba lagi
                      </Button>
                    )}
                    {it.status === 'queued' || it.status === 'downloading' || it.status === 'uploading' ? (
                      <Button size="sm" variant="text" onClick={() => remove.mutate(it.id)}>
                        Batalkan
                      </Button>
                    ) : (
                      <Button size="sm" variant="text" onClick={() => remove.mutate(it.id)} title="Hapus dari daftar (video hasil impor tetap ada)">
                        Hapus
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
