import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ImportForm, ImportVideoCell, STATUS_LABEL, VIDEO_STATUS, type ImportItem, type QueueCounts } from '../../components/imports/ImportShared';
import { Button } from '../../components/ui/Button';
import { EmptyState, Spinner } from '../../components/ui/misc';
import { useDocumentTitle, useSite } from '../../hooks/useSite';
import { apiDelete, apiGet, apiPost, errorMessage } from '../../lib/api';
import { formatBytes, formatDateTime, formatRelative } from '../../lib/format';
import { toast } from '../../stores/toast';

interface ImportsResponse {
  items: ImportItem[];
  nextCursor: string | null;
  queue: QueueCounts;
  summary: Record<'queued' | 'running' | 'done' | 'failed' | 'cancelled', number>;
  maxHeight: number;
  maxPlaylistItems: number;
}

const PILL: Record<ImportItem['status'], string> = {
  queued: '',
  downloading: 'running',
  uploading: 'running',
  done: 'done',
  failed: 'failed',
  cancelled: '',
};

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
  const site = useSite();
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
      <ImportForm
        className="dv-studio-card"
        endpoint="/admin/imports"
        invalidateKey={['admin', 'imports']}
        maxHeight={data?.maxHeight ?? 1080}
        maxPlaylistItems={data?.maxPlaylistItems ?? 500}
        intro={
          <>
            Video dari form ini masuk ke <b>channel utama (@{site.channelHandle})</b>. Pengguna mengimpor ke channel masing-masing lewat tombol Upload →
            Impor dari YouTube; semua impor memakai antrean yang sama di bawah ini.
          </>
        }
      />
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
                <th>Channel</th>
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
                    <ImportVideoCell it={it} />
                  </td>
                  <td>
                    {it.owner ? (
                      <Link className="dv-link" to={`/@${it.owner.username}`} title={it.owner.name ?? undefined}>
                        @{it.owner.username}
                      </Link>
                    ) : it.owner === null ? (
                      <span className="dv-text-secondary">Channel utama</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    <span className={`dv-pill ${PILL[it.status] ? `dv-pill--${PILL[it.status]}` : ''}`}>{STATUS_LABEL[it.status]}</span>
                    {it.status === 'queued' && it.position != null && (
                      <div className="dv-text-secondary" style={{ fontSize: '1.2rem', marginTop: 4 }}>
                        urutan ke-{it.position} dari {data.queue.waiting}
                      </div>
                    )}
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
                      <div className={it.status === 'cancelled' ? 'dv-text-secondary' : 'dv-table__error'} title={it.error} style={{ fontSize: '1.2rem' }}>
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
