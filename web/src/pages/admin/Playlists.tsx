import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Button, IconButton } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { EmptyState, Spinner } from '../../components/ui/misc';
import { InfiniteSentinel } from '../../components/video/VideoGrid';
import { useDocumentTitle } from '../../hooks/useSite';
import { apiDelete, apiGet, apiPatch, errorMessage } from '../../lib/api';
import { formatRelative } from '../../lib/format';
import { playlistUrl } from '../../lib/playlistQueries';
import type { PlaylistSummary } from '../../lib/types';
import { toast } from '../../stores/toast';

type AdminPlaylist = PlaylistSummary & { createdAt: string };

/** Studio → Playlist: semua playlist (user & tamu), ubah visibilitas, hapus. */
export function AdminPlaylistsPage() {
  useDocumentTitle('Playlist - Studio');
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [qd, setQd] = useState('');
  const [visibility, setVisibility] = useState('');
  const [kind, setKind] = useState('');
  const [deleting, setDeleting] = useState<AdminPlaylist | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setQd(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const qs = new URLSearchParams({ ...(qd ? { q: qd } : {}), ...(visibility ? { visibility } : {}), ...(kind ? { kind } : {}) }).toString();
  const list = useInfiniteQuery({
    queryKey: ['admin', 'playlists', qs],
    queryFn: ({ pageParam, signal }) => apiGet<{ items: AdminPlaylist[]; total: number; nextCursor: string | null }>(`/admin/playlists?${qs}${pageParam ? `&cursor=${pageParam}` : ''}`, signal),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const loadMore = useCallback(() => void list.fetchNextPage(), [list]);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin', 'playlists'] });

  return (
    <div className="dv-studio-page dv-studio-page--wide">
      <h1 className="dv-studio-page__title">Playlist</h1>
      <div className="dv-myvideos__filters">
        <div className="dv-studio-search">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari judul playlist" aria-label="Cari playlist" />
        </div>
        <select className="dv-select dv-select--sm" value={visibility} onChange={(e) => setVisibility(e.target.value)} aria-label="Visibilitas">
          <option value="">Semua visibilitas</option>
          <option value="public">Publik</option>
          <option value="private">Privat</option>
        </select>
        <select className="dv-select dv-select--sm" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Pemilik">
          <option value="">Semua pemilik</option>
          <option value="user">Pengguna</option>
          <option value="guest">Tamu (perangkat)</option>
        </select>
        <span className="dv-text-secondary">{(list.data?.pages[0]?.total ?? 0).toLocaleString('id-ID')} playlist</span>
      </div>
      {list.isPending ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState icon="playlist-play" title="Tidak ada playlist" />
      ) : (
        <div className="dv-table-wrap">
          <table className="dv-table">
            <thead>
              <tr>
                <th>Playlist</th>
                <th>Pemilik</th>
                <th>Visibilitas</th>
                <th>Video</th>
                <th>Diperbarui</th>
                <th aria-label="Aksi" />
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id}>
                  <td className="dv-table__title">
                    <Link className="dv-link" to={playlistUrl(p.id)}>
                      {p.title}
                    </Link>
                  </td>
                  <td>{p.owner ? <Link to={`/@${p.owner.handle}`}>@{p.owner.handle}</Link> : <span className="dv-text-secondary">Tamu</span>}</td>
                  <td>
                    <select
                      className="dv-select dv-select--sm"
                      value={p.visibility}
                      disabled={p.isGuest}
                      title={p.isGuest ? 'Playlist tamu selalu privat' : undefined}
                      aria-label="Visibilitas"
                      onChange={async (e) => {
                        try {
                          await apiPatch(`/playlists/${p.id}`, { visibility: e.target.value });
                          toast('Visibilitas playlist diubah');
                          refresh();
                        } catch (err) {
                          toast(errorMessage(err));
                        }
                      }}
                    >
                      <option value="public">Publik</option>
                      <option value="private">Privat</option>
                    </select>
                  </td>
                  <td>{p.itemCount.toLocaleString('id-ID')}</td>
                  <td className="dv-text-secondary">{formatRelative(p.updatedAt)}</td>
                  <td>
                    <IconButton icon="delete" label="Hapus playlist" size={32} onClick={() => setDeleting(p)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <InfiniteSentinel onVisible={loadMore} disabled={!list.hasNextPage || list.isFetchingNextPage} />
      <Dialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Hapus playlist?"
        width={420}
        actions={
          <>
            <Button variant="text" onClick={() => setDeleting(null)}>
              Batal
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                try {
                  await apiDelete(`/playlists/${deleting!.id}`);
                  toast('Playlist dihapus');
                  refresh();
                } catch (err) {
                  toast(errorMessage(err));
                }
                setDeleting(null);
              }}
            >
              Hapus
            </Button>
          </>
        }
      >
        <p className="dv-text-secondary">
          <b className="dv-text">{deleting?.title}</b> akan dihapus permanen. Video di dalamnya tidak ikut terhapus.
        </p>
      </Dialog>
    </div>
  );
}
