import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Icon } from '../components/icons/Icon';
import { Button } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { EmptyState, TextField } from '../components/ui/misc';
import { PlaylistGrid } from '../components/playlist/PlaylistCard';
import { InfiniteSentinel } from '../components/video/VideoGrid';
import { useDocumentTitle } from '../hooks/useSite';
import { apiGet, apiPost, errorMessage } from '../lib/api';
import { invalidatePlaylists, playlistUrl, useMyPlaylists } from '../lib/playlistQueries';
import type { Page, PlaylistSummary } from '../lib/types';
import { useSession } from '../stores/session';
import { toast } from '../stores/toast';

export function CreatePlaylistDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const user = useSession((s) => s.user);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiPost<{ playlist: PlaylistSummary }>('/playlists', { title: title.trim(), visibility: user ? visibility : 'private' });
      invalidatePlaylists(qc);
      onClose();
      setTitle('');
      navigate(playlistUrl(res.playlist.id));
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Playlist baru"
      width={420}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            Batal
          </Button>
          <Button variant="cta-text" type="submit" form="dv-pl-new" disabled={busy || !title.trim()}>
            Buat
          </Button>
        </>
      }
    >
      <form id="dv-pl-new" className="dv-form" onSubmit={submit}>
        <TextField label="Judul" value={title} maxLength={150} autoFocus onChange={(e) => setTitle(e.target.value)} helper={`${title.length}/150`} />
        {user ? (
          <label className="dv-save__select">
            <span>Visibilitas</span>
            <select className="dv-select" value={visibility} onChange={(e) => setVisibility(e.target.value as 'private' | 'public')}>
              <option value="private">Privat</option>
              <option value="public">Publik</option>
            </select>
          </label>
        ) : (
          <p className="dv-text-secondary">Playlist tamu hanya tersimpan di perangkat ini dan selalu privat.</p>
        )}
      </form>
    </Dialog>
  );
}

/** /feed/playlists — playlist milik user, atau playlist perangkat ini untuk tamu. */
export function MyPlaylistsPage() {
  useDocumentTitle('Playlist');
  const user = useSession((s) => s.user);
  const mine = useMyPlaylists();
  const [creating, setCreating] = useState(false);
  const items = mine.data?.items ?? [];
  const guestBlocked = !user && mine.data && !mine.data.guestAllowed;
  return (
    <div className="dv-plgrid-page">
      <div className="dv-plgrid-page__head">
        <h1 className="dv-plgrid-page__title">Playlist</h1>
        {!guestBlocked && (
          <Button icon="add" onClick={() => setCreating(true)}>
            Playlist baru
          </Button>
        )}
      </div>
      {!user && (
        <div className="dv-banner dv-banner--info dv-mb-16">
          <Icon name="info" /> Playlist tamu hanya ada di perangkat ini. <Link to="/login?next=/feed/playlists">Login</Link> untuk menyimpannya ke akun.
        </div>
      )}
      {!mine.isPending && items.length === 0 ? (
        <EmptyState icon="playlist-play" title="Belum ada playlist">
          <p>Simpan video ke playlist lewat tombol Simpan di halaman tonton.</p>
        </EmptyState>
      ) : (
        <PlaylistGrid playlists={items} loading={mine.isPending} />
      )}
      <CreatePlaylistDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

/** /feed/playlists/public — Jelajahi Playlist publik. */
export function PublicPlaylistsPage() {
  useDocumentTitle('Jelajahi Playlist');
  const q = useInfiniteQuery({
    queryKey: ['playlists', 'public'],
    queryFn: ({ pageParam, signal }) => apiGet<Page<PlaylistSummary>>(`/playlists/public${pageParam ? `?cursor=${pageParam}` : ''}`, signal),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 60_000,
    meta: { page: true },
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const loadMore = useCallback(() => void q.fetchNextPage(), [q]);
  return (
    <div className="dv-plgrid-page">
      <div className="dv-plgrid-page__head">
        <h1 className="dv-plgrid-page__title">Jelajahi Playlist</h1>
      </div>
      {!q.isPending && items.length === 0 ? (
        <EmptyState icon="explore" title="Belum ada playlist publik">
          <p>Playlist yang dibuat publik oleh pengguna akan muncul di sini.</p>
        </EmptyState>
      ) : (
        <PlaylistGrid playlists={items} loading={q.isPending || q.isFetchingNextPage} />
      )}
      <InfiniteSentinel onVisible={loadMore} disabled={!q.hasNextPage || q.isFetchingNextPage} />
    </div>
  );
}
