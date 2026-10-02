import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Icon } from '../components/icons/Icon';
import { Button, IconButton } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { EmptyState, Skeleton, TextField } from '../components/ui/misc';
import { MenuItem, Popup } from '../components/ui/Popup';
import { Thumbnail } from '../components/video/Thumbnail';
import { ShareDialog } from '../components/video/ShareDialog';
import { useDocumentTitle } from '../hooks/useSite';
import { ApiError, apiDelete, apiPatch, apiPut, errorMessage } from '../lib/api';
import { formatRelative, formatVideoCount, formatViews } from '../lib/format';
import { fetchPlaylist, invalidatePlaylists, playlistKey, playlistWatchUrl } from '../lib/playlistQueries';
import type { PlaylistDetail, VideoSummary } from '../lib/types';
import { useSession } from '../stores/session';
import { toast } from '../stores/toast';
import { NotFoundPage } from './NotFound';

const isPlaylistId = (s: string) => /^PL[A-Za-z0-9_-]{22}$/.test(s);

function ItemMenu({ onRemove }: { onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <IconButton ref={anchor} icon="more-vert" label="Menu tindakan" tooltip={false} onClick={() => setOpen(!open)} />
      <Popup open={open} onClose={() => setOpen(false)} anchorRef={anchor} align="right">
        <MenuItem
          icon="delete"
          onClick={() => {
            setOpen(false);
            onRemove();
          }}
        >
          Hapus dari playlist
        </MenuItem>
      </Popup>
    </>
  );
}

function Row({ video, index, listId, editable, onRemove }: { video: VideoSummary; index: number; listId: string; editable: boolean; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: video.id, disabled: !editable });
  const href = playlistWatchUrl(video.id, listId, index + 1);
  return (
    <div
      ref={setNodeRef}
      className={`dv-plitem${isDragging ? ' is-dragging' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      {editable ? (
        <button type="button" ref={setActivatorNodeRef} className="dv-plitem__handle" aria-label={`Pindahkan ${video.title}`} {...attributes} {...listeners}>
          <Icon name="drag-handle" />
        </button>
      ) : (
        <span className="dv-plitem__index">{index + 1}</span>
      )}
      <Link to={href} className="dv-plitem__thumb" tabIndex={-1} aria-hidden="true">
        <Thumbnail video={video} sizes="160px" />
      </Link>
      <div className="dv-plitem__body">
        <h3 className="dv-plitem__title">
          <Link to={href} className="dv-clamp-2" title={video.title}>
            {video.title}
          </Link>
        </h3>
        <div className="dv-plitem__meta">
          <Link to={`/@${video.channel.handle}`}>{video.channel.name}</Link>
          <span className="dv-dot">•</span>
          {formatViews(video.views)}
          <span className="dv-dot">•</span>
          {formatRelative(video.publishedAt)}
        </div>
      </div>
      {editable && (
        <div className="dv-plitem__menu">
          <ItemMenu onRemove={onRemove} />
        </div>
      )}
    </div>
  );
}

function EditDialog({ open, onClose, detail, onSaved }: { open: boolean; onClose: () => void; detail: PlaylistDetail; onSaved: (d: PlaylistDetail['playlist']) => void }) {
  const p = detail.playlist;
  const user = useSession((s) => s.user);
  const [title, setTitle] = useState(p.title);
  const [visibility, setVisibility] = useState(p.visibility);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setTitle(p.title);
      setVisibility(p.visibility);
      setError(null);
    }
  }, [open, p.title, p.visibility]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body: Record<string, string> = {};
      if (title.trim() !== p.title) body.title = title.trim();
      if (visibility !== p.visibility) body.visibility = visibility;
      if (Object.keys(body).length) {
        const res = await apiPatch<{ playlist: PlaylistDetail['playlist'] }>(`/playlists/${p.id}`, body);
        onSaved({ ...p, ...res.playlist });
        toast('Playlist diperbarui');
      }
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Ubah playlist"
      width={440}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            Batal
          </Button>
          <Button variant="cta-text" type="submit" form="dv-pl-edit" disabled={busy || !title.trim()}>
            Simpan
          </Button>
        </>
      }
    >
      <form id="dv-pl-edit" className="dv-form" onSubmit={submit}>
        <TextField label="Judul" value={title} maxLength={150} onChange={(e) => setTitle(e.target.value)} helper={`${title.length}/150`} error={error} />
        {user && !p.isGuest && (
          <label className="dv-save__select">
            <span>Visibilitas</span>
            <select className="dv-select" value={visibility} onChange={(e) => setVisibility(e.target.value as 'public' | 'private')}>
              <option value="private">Privat — hanya Anda</option>
              <option value="public">Publik — semua orang</option>
            </select>
          </label>
        )}
      </form>
    </Dialog>
  );
}

/** Halaman playlist (/playlist?list=) gaya YouTube: panel sampul kiri + daftar item (drag & drop untuk pemilik). */
export function PlaylistPage() {
  const [params] = useSearchParams();
  const id = params.get('list') ?? '';
  const valid = isPlaylistId(id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: playlistKey(id),
    queryFn: ({ signal }) => fetchPlaylist(id, signal),
    enabled: valid,
    staleTime: 15_000,
    meta: { page: true },
    retry: (n, err) => !(err instanceof ApiError && err.status === 404) && n < 1,
  });
  const [items, setItems] = useState<VideoSummary[]>([]);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const moreAnchor = useRef<HTMLButtonElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    if (q.data) setItems(q.data.items);
  }, [q.data]);
  useDocumentTitle(q.data?.playlist.title ?? (valid ? null : 'Playlist'));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (!valid || (q.error instanceof ApiError && q.error.status === 404)) return <NotFoundPage />;
  const d = q.data;
  const p = d?.playlist;
  const editable = Boolean(p?.canEdit);

  const setDetail = (fn: (old: PlaylistDetail) => PlaylistDetail) => qc.setQueryData<PlaylistDetail>(playlistKey(id), (old) => (old ? fn(old) : old));

  const onDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = items.findIndex((v) => v.id === active.id);
    const to = items.findIndex((v) => v.id === over.id);
    const prev = items;
    const next = arrayMove(items, from, to);
    setItems(next);
    try {
      await apiPut(`/playlists/${id}/order`, { videoIds: next.map((v) => v.id) });
      setDetail((old) => ({ ...old, items: next }));
      invalidatePlaylists(qc);
    } catch (err) {
      setItems(prev);
      toast(errorMessage(err));
    }
  };

  const removeItem = async (video: VideoSummary) => {
    const prev = items;
    setItems(items.filter((v) => v.id !== video.id));
    try {
      await apiDelete(`/playlists/${id}/items/${video.id}`);
      setDetail((old) => ({ ...old, items: old.items.filter((v) => v.id !== video.id), playlist: { ...old.playlist, itemCount: Math.max(0, old.playlist.itemCount - 1) } }));
      invalidatePlaylists(qc);
      toast(`Dihapus dari ${p?.title ?? 'playlist'}`);
    } catch (err) {
      setItems(prev);
      toast(errorMessage(err));
    }
  };

  const playAll = (shuffle = false) => {
    if (!items.length) return;
    const start = shuffle ? items[Math.floor(Math.random() * items.length)]! : items[0]!;
    navigate(playlistWatchUrl(start.id, id, items.indexOf(start) + 1) + (shuffle ? '&shuffle=1' : ''));
  };

  const cover = p?.thumb?.hd ?? items[0]?.thumb?.hd ?? null;

  return (
    <div className="dv-plpage">
      <aside className="dv-plpage__header" style={cover ? ({ '--dv-pl-cover': `url("${cover}")` } as React.CSSProperties) : undefined}>
        <div className="dv-plpage__header-inner">
          {p ? (
            <>
              <div className="dv-plpage__cover">
                {cover ? <img src={cover} alt="" /> : <Icon name="playlist-play" size={64} />}
                {items.length > 0 && (
                  <button type="button" className="dv-plpage__cover-play" onClick={() => playAll()}>
                    <Icon name="play-arrow" /> PUTAR SEMUA
                  </button>
                )}
              </div>
              <h1 className="dv-plpage__title">{p.title}</h1>
              <div className="dv-plpage__owner">{p.owner ? <Link to={`/@${p.owner.handle}`}>oleh {p.owner.name}</Link> : p.isGuest ? 'Playlist di perangkat ini' : null}</div>
              <div className="dv-plpage__stats">
                <span>
                  <Icon name={p.visibility === 'public' ? 'public' : 'lock'} size={16} /> {p.visibility === 'public' ? 'Publik' : 'Privat'}
                </span>
                <span>{formatVideoCount(p.itemCount)}</span>
                <span>Diperbarui {formatRelative(p.updatedAt)}</span>
              </div>
              <div className="dv-plpage__actions">
                {editable && <IconButton icon="edit" label="Ubah playlist" className="dv-plpage__icon" onClick={() => setEditing(true)} />}
                {p.visibility === 'public' && <IconButton icon="share" label="Bagikan" className="dv-plpage__icon" onClick={() => setSharing(true)} />}
                {editable && (
                  <>
                    <IconButton ref={moreAnchor} icon="more-vert" label="Lainnya" className="dv-plpage__icon" onClick={() => setMoreOpen(!moreOpen)} />
                    <Popup open={moreOpen} onClose={() => setMoreOpen(false)} anchorRef={moreAnchor} align="left">
                      <MenuItem
                        icon="delete"
                        onClick={() => {
                          setMoreOpen(false);
                          setDeleting(true);
                        }}
                      >
                        Hapus playlist
                      </MenuItem>
                    </Popup>
                  </>
                )}
              </div>
              <div className="dv-plpage__play">
                <Button variant="inverse" icon="play-arrow" disabled={!items.length} onClick={() => playAll()}>
                  Putar semua
                </Button>
                <Button variant="tonal" icon="shuffle" disabled={items.length < 2} onClick={() => playAll(true)}>
                  Acak
                </Button>
              </div>
            </>
          ) : (
            <>
              <Skeleton className="dv-plpage__cover" radius={12} />
              <Skeleton height={32} width="80%" className="dv-mt-12" />
            </>
          )}
        </div>
      </aside>

      <section className="dv-plpage__list">
        {d && d.hiddenCount > 0 && (
          <div className="dv-banner dv-banner--info dv-mb-16">
            <Icon name="visibility-off" /> {d.hiddenCount} video tidak tersedia disembunyikan
          </div>
        )}
        {q.isPending ? (
          Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="dv-plitem">
              <Skeleton width={160} height={90} radius={8} />
              <Skeleton height={20} width="50%" />
            </div>
          ))
        ) : items.length === 0 ? (
          <EmptyState icon="playlist-play" title="Belum ada video di playlist ini">
            <p>Simpan video lewat tombol Simpan di halaman tonton.</p>
          </EmptyState>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => void onDragEnd(e)}>
            <SortableContext items={items.map((v) => v.id)} strategy={verticalListSortingStrategy}>
              {items.map((v, i) => (
                <Row key={v.id} video={v} index={i} listId={id} editable={editable} onRemove={() => void removeItem(v)} />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </section>

      {d && editable && (
        <EditDialog open={editing} onClose={() => setEditing(false)} detail={d} onSaved={(pl) => setDetail((old) => ({ ...old, playlist: pl }))} />
      )}
      {p && <ShareDialog open={sharing} onClose={() => setSharing(false)} video={{ id: p.firstVideoId ?? '', title: p.title }} playlistId={p.id} />}
      <Dialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title="Hapus playlist?"
        width={420}
        actions={
          <>
            <Button variant="text" onClick={() => setDeleting(false)}>
              Batal
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                try {
                  await apiDelete(`/playlists/${id}`);
                  invalidatePlaylists(qc);
                  qc.removeQueries({ queryKey: playlistKey(id) });
                  toast('Playlist dihapus');
                  navigate('/feed/playlists', { replace: true });
                } catch (err) {
                  toast(errorMessage(err));
                }
              }}
            >
              Hapus
            </Button>
          </>
        }
      >
        <p className="dv-text-secondary">
          <b className="dv-text">{p?.title}</b> akan dihapus permanen. Video di dalamnya tidak ikut terhapus.
        </p>
      </Dialog>
    </div>
  );
}
