import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Icon } from '../components/icons/Icon';
import { Button, IconButton } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { EmptyState } from '../components/ui/misc';
import { Thumbnail } from '../components/video/Thumbnail';
import { ResultItemSkeleton } from '../components/video/VideoCards';
import { InfiniteSentinel } from '../components/video/VideoGrid';
import { useDocumentTitle } from '../hooks/useSite';
import { apiDelete, apiGet, errorMessage } from '../lib/api';
import { formatViews, groupByDay } from '../lib/format';
import type { Page, VideoSummary } from '../lib/types';
import { watchUrl } from '../lib/videoQueries';
import { useSession } from '../stores/session';
import { toast } from '../stores/toast';
import { useWatch } from '../stores/watch';

export type HistoryVideo = VideoSummary & { watchedAt: string };

/** Item histori (thumbnail di kiri, tombol hapus seperti YouTube). */
function HistoryRow({ video, onRemove }: { video: HistoryVideo; onRemove: () => void }) {
  const href = watchUrl(video.id);
  return (
    <div className="dv-history__item">
      <Link to={href} className="dv-history__thumb" tabIndex={-1} aria-hidden="true">
        <Thumbnail video={video} sizes="(max-width: 656px) 160px, 246px" />
      </Link>
      <div className="dv-history__body">
        <h3 className="dv-history__title">
          <Link to={href} className="dv-clamp-2" title={video.title}>
            {video.title}
          </Link>
        </h3>
        <div className="dv-history__meta">
          <Link to={`/@${video.channel.handle}`}>{video.channel.name}</Link>
          <span className="dv-dot">•</span>
          {formatViews(video.views)}
        </div>
      </div>
      <IconButton icon="close" label="Hapus dari histori tontonan" className="dv-history__remove" onClick={onRemove} />
    </div>
  );
}

export function HistoryPage() {
  useDocumentTitle('Histori');
  const user = useSession((s) => s.user);
  const loaded = useSession((s) => s.loaded);
  const qc = useQueryClient();
  const guestHistory = useWatch((s) => s.guestHistory);
  const removeGuest = useWatch((s) => s.removeGuest);
  const clearGuest = useWatch((s) => s.clearGuest);
  const forget = useWatch((s) => s.forget);
  const [confirmClear, setConfirmClear] = useState(false);

  const server = useInfiniteQuery({
    queryKey: ['history'],
    queryFn: ({ pageParam, signal }) => apiGet<Page<HistoryVideo>>(`/history${pageParam ? `?cursor=${pageParam}` : ''}`, signal),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(user),
    staleTime: 0,
  });

  const items: HistoryVideo[] = useMemo(
    () => (user ? (server.data?.pages.flatMap((p) => p.items) ?? []) : (guestHistory as HistoryVideo[])),
    [user, server.data, guestHistory],
  );
  const groups = useMemo(() => groupByDay(items, (v) => v.watchedAt), [items]);

  const remove = async (id: string) => {
    if (!user) {
      removeGuest(id);
      toast('Dihapus dari histori tontonan');
      return;
    }
    try {
      await apiDelete(`/history/${id}`);
      forget(id);
      qc.setQueryData<{ pages: Page<HistoryVideo>[]; pageParams: unknown[] }>(['history'], (old) =>
        old ? { ...old, pages: old.pages.map((p) => ({ ...p, items: p.items.filter((v) => v.id !== id) })) } : old,
      );
      toast('Dihapus dari histori tontonan');
    } catch (err) {
      toast(errorMessage(err));
    }
  };

  const clearAll = async () => {
    setConfirmClear(false);
    if (!user) {
      clearGuest();
    } else {
      try {
        await apiDelete('/history');
        qc.setQueryData(['history'], { pages: [{ items: [], nextCursor: null }], pageParams: [''] });
        void qc.invalidateQueries({ queryKey: ['feed'] });
      } catch (err) {
        toast(errorMessage(err));
        return;
      }
    }
    toast('Histori tontonan dihapus');
  };

  const loadMore = useCallback(() => void server.fetchNextPage(), [server]);
  const loading = !loaded || (Boolean(user) && server.isPending);

  return (
    <div className="dv-history">
      <div className="dv-history__main">
        <h1 className="dv-history__heading">Histori tontonan</h1>
        {!user && loaded && (
          <div className="dv-banner dv-banner--info dv-mb-16">
            <Icon name="info" /> Histori ini hanya tersimpan di perangkat ini. <Link to="/login?next=/feed/history">Login</Link> untuk menyimpannya ke akun Anda.
          </div>
        )}
        {loading ? (
          Array.from({ length: 6 }, (_, i) => <ResultItemSkeleton key={i} />)
        ) : items.length === 0 ? (
          <EmptyState icon="history" title="Histori tontonan Anda kosong">
            <p>Video yang Anda tonton akan muncul di sini.</p>
          </EmptyState>
        ) : (
          groups.map((g) => (
            <section key={g.label} className="dv-history__group">
              <h2 className="dv-history__day">{g.label}</h2>
              {g.items.map((v) => (
                <HistoryRow key={v.id} video={v} onRemove={() => void remove(v.id)} />
              ))}
            </section>
          ))
        )}
        {user && <InfiniteSentinel onVisible={loadMore} disabled={!server.hasNextPage || server.isFetchingNextPage} />}
      </div>
      <aside className="dv-history__side">
        <Button variant="text" icon="delete" disabled={items.length === 0} onClick={() => setConfirmClear(true)}>
          Hapus semua histori tontonan
        </Button>
      </aside>
      <Dialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="Hapus histori tontonan?"
        width={440}
        actions={
          <>
            <Button variant="text" onClick={() => setConfirmClear(false)}>
              Batal
            </Button>
            <Button variant="cta-text" onClick={() => void clearAll()}>
              Hapus histori tontonan
            </Button>
          </>
        }
      >
        <p className="dv-text-secondary">
          {user
            ? 'Histori tontonan di akun Anda akan dihapus, termasuk posisi terakhir menonton setiap video.'
            : 'Histori tontonan di perangkat ini akan dihapus.'}
        </p>
      </Dialog>
    </div>
  );
}
