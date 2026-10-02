import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '../../components/ui/Button';
import { EmptyState, Spinner } from '../../components/ui/misc';
import { useDocumentTitle } from '../../hooks/useSite';
import { apiDelete, apiGet, apiPost, errorMessage } from '../../lib/api';
import { formatDateTime, formatRelative } from '../../lib/format';
import { toast } from '../../stores/toast';

interface Job {
  id: number;
  type: 'probe' | 'thumbnail' | 'media' | 'delete_assets';
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  attempts: number;
  maxAttempts: number;
  progress: number;
  lastError: string | null;
  runAfter: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string | null;
  video: { id: string; title: string | null } | null;
}

interface JobsResponse {
  items: Job[];
  nextCursor: string | null;
  summary: { queued: number; running: number; failed: number; done: number };
}

const TYPE_LABEL: Record<Job['type'], string> = {
  probe: 'Analisis',
  thumbnail: 'Thumbnail',
  media: 'Konversi & storyboard',
  delete_assets: 'Hapus aset',
};
const STATUS_LABEL: Record<Job['status'], string> = {
  queued: 'Menunggu',
  running: 'Berjalan',
  done: 'Selesai',
  failed: 'Gagal',
  cancelled: 'Dibatalkan',
};

export function JobsPage() {
  useDocumentTitle('Antrean - Studio');
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const params = new URLSearchParams({ limit: '100', ...(status ? { status } : {}), ...(type ? { type } : {}) });
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'jobs', status, type],
    queryFn: () => apiGet<JobsResponse>(`/admin/jobs?${params}`),
    refetchInterval: 5000,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'jobs'] });
  const retry = useMutation({ mutationFn: (id: number) => apiPost(`/admin/jobs/${id}/retry`), onSuccess: refresh, onError: (e) => toast(errorMessage(e)) });
  const cancel = useMutation({ mutationFn: (id: number) => apiDelete(`/admin/jobs/${id}`), onSuccess: refresh, onError: (e) => toast(errorMessage(e)) });

  return (
    <div className="dv-studio-page">
      <h1 className="dv-studio-page__title">Antrean pemrosesan</h1>
      {data && (
        <div className="dv-stat-row">
          <div className="dv-stat">
            <div className="dv-stat__value">{data.summary.running}</div>
            <div className="dv-stat__label">Berjalan</div>
          </div>
          <div className="dv-stat">
            <div className="dv-stat__value">{data.summary.queued}</div>
            <div className="dv-stat__label">Menunggu</div>
          </div>
          <div className="dv-stat">
            <div className="dv-stat__value">{data.summary.failed}</div>
            <div className="dv-stat__label">Gagal</div>
          </div>
          <div className="dv-stat">
            <div className="dv-stat__value">{data.summary.done}</div>
            <div className="dv-stat__label">Selesai</div>
          </div>
        </div>
      )}
      <div className="dv-row" style={{ marginBottom: 16 }}>
        <select className="dv-select" style={{ width: 180 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter status">
          <option value="">Semua status</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select className="dv-select" style={{ width: 220 }} value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter tipe">
          <option value="">Semua tipe</option>
          {Object.entries(TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      {isLoading && <Spinner />}
      {error && <div className="dv-banner dv-banner--error">{errorMessage(error)}</div>}
      {data && data.items.length === 0 && <EmptyState icon="list" title="Antrean kosong" />}
      {data && data.items.length > 0 && (
        <div className="dv-table-wrap">
          <table className="dv-table">
            <thead>
              <tr>
                <th>Tugas</th>
                <th>Video</th>
                <th>Status</th>
                <th>Percobaan</th>
                <th>Waktu</th>
                <th aria-label="Aksi" />
              </tr>
            </thead>
            <tbody>
              {data.items.map((j) => (
                <tr key={j.id}>
                  <td>
                    <div className="dv-table__primary">{TYPE_LABEL[j.type] ?? j.type}</div>
                    <div className="dv-text-secondary">#{j.id}</div>
                  </td>
                  <td className="dv-table__title">
                    {j.video ? (
                      <Link className="dv-link" to={`/watch?v=${j.video.id}`}>
                        {j.video.title ?? j.video.id}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    <span className={`dv-pill dv-pill--${j.status}`}>{STATUS_LABEL[j.status]}</span>
                    {j.status === 'running' && (
                      <div className="dv-progress" aria-label={`${j.progress}%`}>
                        <div className="dv-progress__bar" style={{ width: `${j.progress}%` }} />
                      </div>
                    )}
                    {j.lastError && (
                      <div className="dv-table__error" title={j.lastError}>
                        {j.lastError}
                      </div>
                    )}
                  </td>
                  <td>
                    {j.attempts}/{j.maxAttempts}
                  </td>
                  <td title={j.createdAt ? formatDateTime(j.createdAt) : ''}>
                    {j.status === 'queued' && j.runAfter && new Date(j.runAfter) > new Date()
                      ? `dijadwalkan ${formatDateTime(j.runAfter)}`
                      : j.finishedAt
                        ? formatRelative(j.finishedAt)
                        : j.createdAt
                          ? formatRelative(j.createdAt)
                          : ''}
                  </td>
                  <td className="dv-table__actions">
                    {(j.status === 'failed' || j.status === 'cancelled') && (
                      <Button size="sm" variant="text" onClick={() => retry.mutate(j.id)}>
                        Coba lagi
                      </Button>
                    )}
                    {(j.status === 'queued' || j.status === 'running') && (
                      <Button size="sm" variant="text" onClick={() => cancel.mutate(j.id)}>
                        Batalkan
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
