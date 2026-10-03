import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { ImportForm, ImportVideoCell, STATUS_LABEL, VIDEO_STATUS, type ImportItem, type QueueCounts } from '../components/imports/ImportShared';
import { StudioTabs } from '../components/imports/StudioTabs';
import { Icon } from '../components/icons/Icon';
import { Button } from '../components/ui/Button';
import { EmptyState, Spinner } from '../components/ui/misc';
import { InfiniteSentinel } from '../components/video/VideoGrid';
import { useDocumentTitle } from '../hooks/useSite';
import { apiDelete, apiGet, apiPost, errorMessage } from '../lib/api';
import { formatBytes, formatDateTime, formatRelative } from '../lib/format';
import { useSession } from '../stores/session';
import { toast } from '../stores/toast';
import '../styles/studio.css';

interface MyImportsPage {
  items: ImportItem[];
  nextCursor: string | null;
  queue: QueueCounts;
  /** Hanya di halaman pertama. */
  active?: ImportItem[];
  summary?: Record<'queued' | 'running' | 'done' | 'failed' | 'cancelled', number>;
  enabled?: boolean;
  limits?: { maxHeight: number; maxPlaylistItems: number; maxQueued: number | null; maxFileGb: number };
}

const KEY = ['me', 'imports'] as const;

function StatusBlock({ it, queue }: { it: ImportItem; queue: QueueCounts }) {
  switch (it.status) {
    case 'queued':
      return (
        <>
          <div className="dv-imp-item__state">
            <Icon name="schedule" size={18} /> Menunggu giliran
          </div>
          <div className="dv-imp-item__sub">
            {it.position != null ? `Urutan ke-${it.position} dari ${queue.waiting} di antrean server` : 'Di antrean server'}
            {it.retryAt && ` · dicoba lagi ${formatDateTime(it.retryAt)}`}
          </div>
          {it.error && <div className="dv-imp-item__error">{it.error}</div>}
        </>
      );
    case 'downloading':
    case 'uploading':
      return (
        <>
          <div className="dv-imp-item__state dv-imp-item__state--running">
            <Spinner size={14} /> {it.status === 'downloading' ? 'Giliran Anda · mengunduh' : 'Menyimpan ke Google Drive'} {it.progress}%
          </div>
          <div className="dv-imp-progress" aria-label={`${it.progress}%`}>
            <div className="dv-imp-progress__bar" style={{ width: `${it.progress}%` }} />
          </div>
          {(it.quality || it.sizeBytes != null) && (
            <div className="dv-imp-item__sub">{[it.quality, it.sizeBytes != null ? formatBytes(it.sizeBytes) : null].filter(Boolean).join(' · ')}</div>
          )}
        </>
      );
    case 'done':
      return (
        <>
          <div className="dv-imp-item__state dv-imp-item__state--done">
            <Icon name="check" size={18} /> Selesai diimpor
          </div>
          <div className="dv-imp-item__sub">
            {it.video ? `Video ${VIDEO_STATUS[it.video.status ?? ''] ?? it.video.status}` : 'Video sudah dihapus'}
            {it.finishedAt && ` · ${formatRelative(it.finishedAt)}`}
          </div>
        </>
      );
    case 'failed':
      return (
        <>
          <div className="dv-imp-item__state dv-imp-item__state--failed">
            <Icon name="error" size={18} /> {STATUS_LABEL.failed}
          </div>
          {it.error && <div className="dv-imp-item__error">{it.error}</div>}
        </>
      );
    default:
      return (
        <>
          <div className="dv-imp-item__state">{STATUS_LABEL.cancelled}</div>
          {it.error && <div className="dv-imp-item__sub">{it.error}</div>}
        </>
      );
  }
}

function ImportRow({ it, queue, onRetry, onRemove }: { it: ImportItem; queue: QueueCounts; onRetry: (id: number) => void; onRemove: (id: number) => void }) {
  const running = it.status === 'downloading' || it.status === 'uploading';
  return (
    <li className={`dv-imp-item${running ? ' is-running' : ''}`}>
      <ImportVideoCell it={it} />
      <div className="dv-imp-item__status">
        <StatusBlock it={it} queue={queue} />
      </div>
      <div className="dv-imp-item__actions">
        {(it.status === 'failed' || it.status === 'cancelled') && (
          <Button size="sm" variant="text" onClick={() => onRetry(it.id)}>
            Coba lagi
          </Button>
        )}
        {it.status === 'done' && it.video && (
          <Link className="dv-btn dv-btn--text dv-btn--sm" to={`/watch?v=${it.video.id}`}>
            <span className="dv-btn__label">Tonton</span>
          </Link>
        )}
        {it.status === 'queued' || running ? (
          <Button size="sm" variant="text" onClick={() => onRemove(it.id)}>
            Batalkan
          </Button>
        ) : (
          <Button size="sm" variant="text" onClick={() => onRemove(it.id)} title="Hapus dari daftar (video hasil impor tetap ada)">
            Hapus
          </Button>
        )}
      </div>
    </li>
  );
}

/** Impor YouTube milik pengguna (/my/imports): video masuk ke channel sendiri; antrean server dipakai bersama semua pengguna. */
export function MyImportsPage() {
  useDocumentTitle('Impor dari YouTube');
  const qc = useQueryClient();
  const user = useSession((s) => s.user);
  const list = useInfiniteQuery({
    queryKey: KEY,
    queryFn: ({ pageParam, signal }) => apiGet<MyImportsPage>(`/imports?${new URLSearchParams({ limit: '50', ...(pageParam ? { cursor: pageParam } : {}) })}`, signal),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // Cepat saat ada impor milik sendiri di antrean (giliran langsung terlihat), lambat saat tidak ada.
    refetchInterval: (q) => ((q.state.data?.pages[0]?.active?.length ?? 0) > 0 ? 2500 : 15_000),
  });
  const first = list.data?.pages[0];
  const active = first?.active ?? [];
  const history = list.data?.pages.flatMap((p) => p.items) ?? [];
  const queue = first?.queue ?? { waiting: 0, running: 0 };
  const loadMore = useCallback(() => void list.fetchNextPage(), [list]);
  const refresh = () => qc.invalidateQueries({ queryKey: KEY });
  const retry = useMutation({ mutationFn: (id: number) => apiPost(`/imports/${id}/retry`), onSuccess: refresh, onError: (e) => toast(errorMessage(e)) });
  const remove = useMutation({ mutationFn: (id: number) => apiDelete(`/imports/${id}`), onSuccess: refresh, onError: (e) => toast(errorMessage(e)) });

  // Beri tahu saat giliran tiba / impor selesai (status berubah di antara dua penyegaran).
  const prev = useRef<Map<number, string> | null>(null);
  useEffect(() => {
    if (!first?.active) return;
    const now = new Map(first.active.map((i) => [i.id, i.status]));
    const before = prev.current;
    if (before) {
      for (const it of first.active) {
        if ((it.status === 'downloading' || it.status === 'uploading') && before.get(it.id) === 'queued') toast(`Giliran Anda: “${it.title ?? it.ytId}” mulai diunduh`);
      }
      const finished = [...before.keys()].filter((id) => !now.has(id));
      const done = history.filter((i) => finished.includes(i.id) && i.status === 'done');
      if (done.length === 1) toast(`Selesai diimpor: “${done[0]!.title ?? done[0]!.ytId}”`);
      else if (done.length > 1) toast(`${done.length} video selesai diimpor`);
      if (done.length) void useSession.getState().load(); // pemakaian penyimpanan berubah
    }
    prev.current = now;
  }, [first, history]);

  const enabled = first?.enabled ?? true;
  const limits = first?.limits;
  const mineWaiting = active.length;

  return (
    <div className="dv-myvideos">
      <StudioTabs />
      <div className="dv-myvideos__head">
        <h1 className="dv-plgrid-page__title">Impor dari YouTube</h1>
      </div>
      <p className="dv-text-secondary dv-mb-16">
        Video yang diimpor masuk ke channel Anda{user ? ` (@${user.username})` : ''} dan diperlakukan seperti video yang Anda upload: muncul di Video Anda,
        bisa diubah judul/visibilitasnya, dan memakai kuota penyimpanan Anda
        {limits ? ` (maksimal ${limits.maxFileGb} GB per video)` : ''}.
      </p>

      {!enabled ? (
        <div className="dv-banner dv-banner--warning dv-mb-16">Impor YouTube sedang dinonaktifkan oleh admin. Daftar impor Anda tetap bisa dilihat.</div>
      ) : (
        <ImportForm
          endpoint="/imports"
          invalidateKey={KEY}
          maxHeight={limits?.maxHeight ?? 1080}
          maxPlaylistItems={limits?.maxPlaylistItems ?? 500}
        />
      )}

      <div className="dv-imp-stats" aria-live="polite">
        <div className="dv-imp-stat">
          <div className="dv-imp-stat__value">{(queue.waiting + queue.running).toLocaleString('id-ID')}</div>
          <div className="dv-imp-stat__label">Antrean server</div>
          <div className="dv-imp-stat__sub">semua pengguna</div>
        </div>
        <div className="dv-imp-stat">
          <div className="dv-imp-stat__value">{mineWaiting.toLocaleString('id-ID')}</div>
          <div className="dv-imp-stat__label">Milik Anda</div>
          <div className="dv-imp-stat__sub">{limits?.maxQueued != null ? `maks ${limits.maxQueued} menunggu` : 'di antrean'}</div>
        </div>
      </div>
      <p className="dv-imp-note">Server mengimpor satu video per satu waktu untuk semua pengguna, sesuai urutan masuk. Halaman ini diperbarui otomatis.</p>

      {list.isPending && <Spinner />}
      {list.error && <div className="dv-banner dv-banner--error">{errorMessage(list.error)}</div>}

      {active.length > 0 && (
        <section className="dv-imp-section">
          <h2 className="dv-imp-section__title">Antrean Anda</h2>
          <ul className="dv-imp-list">
            {active.map((it) => (
              <ImportRow key={it.id} it={it} queue={queue} onRetry={(id) => retry.mutate(id)} onRemove={(id) => remove.mutate(id)} />
            ))}
          </ul>
        </section>
      )}

      {first && (history.length > 0 || active.length === 0) && (
        <section className="dv-imp-section">
          <h2 className="dv-imp-section__title">Riwayat impor</h2>
          {history.length === 0 ? (
            <EmptyState icon="download" title="Belum ada impor">
              <p>Tempel link video atau playlist YouTube di atas untuk mulai.</p>
            </EmptyState>
          ) : (
            <ul className="dv-imp-list">
              {history.map((it) => (
                <ImportRow key={it.id} it={it} queue={queue} onRetry={(id) => retry.mutate(id)} onRemove={(id) => remove.mutate(id)} />
              ))}
            </ul>
          )}
          {list.isFetchingNextPage && <Spinner />}
          <InfiniteSentinel onVisible={loadMore} disabled={!list.hasNextPage || list.isFetchingNextPage} />
        </section>
      )}
    </div>
  );
}
