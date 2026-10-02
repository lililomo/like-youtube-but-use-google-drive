import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Icon } from '../../components/icons/Icon';
import { Button, IconButton } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { EmptyState, Spinner } from '../../components/ui/misc';
import { DeleteVideoDialog, RenameDialog } from '../../components/video/OwnerActions';
import { Thumbnail } from '../../components/video/Thumbnail';
import { InfiniteSentinel } from '../../components/video/VideoGrid';
import { useDocumentTitle } from '../../hooks/useSite';
import { apiDelete, apiGet, apiPatch, apiPost, errorMessage } from '../../lib/api';
import { formatBytes, formatDate } from '../../lib/format';
import { watchUrl } from '../../lib/videoQueries';
import { toast } from '../../stores/toast';
import { StatusCell, SubtitleDialog, type StudioVideo } from '../MyVideos';
import type { AdminUser } from './Users';

type AdminVideo = StudioVideo & { owner: { id: number; username: string; name: string | null } | null; categoryId: number | null };
interface Page {
  items: AdminVideo[];
  total: number;
  nextCursor: string | null;
}
interface CategoryOption {
  id: number;
  name: string;
  depth: number;
}

function CategoryDialog({ video, categories, onClose, onSaved }: { video: AdminVideo; categories: CategoryOption[]; onClose: () => void; onSaved: () => void }) {
  const [cat, setCat] = useState<number | null>(video.categoryId);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Pindahkan kategori"
      width={420}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            Batal
          </Button>
          <Button
            variant="cta-text"
            disabled={busy || cat === video.categoryId}
            onClick={async () => {
              setBusy(true);
              try {
                await apiPatch(`/videos/${video.id}`, { categoryId: cat });
                toast('Video dipindahkan (folder di Google Drive ikut berubah)');
                onSaved();
                onClose();
              } catch (err) {
                toast(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            Simpan
          </Button>
        </>
      }
    >
      <select className="dv-select" value={cat ?? ''} onChange={(e) => setCat(e.target.value ? Number(e.target.value) : null)}>
        <option value="">Tanpa kategori (folder utama)</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {'— '.repeat(Math.max(0, c.depth - 1))}
            {c.name}
          </option>
        ))}
      </select>
    </Dialog>
  );
}

/** Studio → Video: semua video (termasuk privat semua user). */
export function AdminVideosPage() {
  useDocumentTitle('Video - Studio');
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [qd, setQd] = useState('');
  const status = params.get('status') ?? '';
  const visibility = params.get('visibility') ?? '';
  const owner = params.get('owner') ?? '';
  const category = params.get('category') ?? '';
  const sort = params.get('sort') ?? 'latest';
  const setParam = (k: string, v: string) => {
    if (v) params.set(k, v);
    else params.delete(k);
    setParams(params, { replace: true });
  };
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<AdminVideo | null>(null);
  const [deleting, setDeleting] = useState<AdminVideo | null>(null);
  const [subs, setSubs] = useState<AdminVideo | null>(null);
  const [moving, setMoving] = useState<AdminVideo | null>(null);
  const [bulkDelete, setBulkDelete] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setQd(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const users = useQuery({ queryKey: ['admin', 'users', ''], queryFn: () => apiGet<{ items: AdminUser[] }>('/admin/users'), staleTime: 60_000 });
  const cats = useQuery({ queryKey: ['categories', 'all'], queryFn: () => apiGet<{ items: CategoryOption[] }>('/categories/all'), staleTime: 60_000 });
  const qs = useMemo(
    () => new URLSearchParams({ ...(qd ? { q: qd } : {}), ...(status ? { status } : {}), ...(visibility ? { visibility } : {}), ...(owner ? { owner } : {}), ...(category ? { category } : {}), sort }),
    [qd, status, visibility, owner, category, sort],
  );
  const list = useInfiniteQuery({
    queryKey: ['admin', 'videos', qs.toString()],
    queryFn: ({ pageParam, signal }) => apiGet<Page>(`/admin/videos?${qs}${pageParam ? `&cursor=${pageParam}` : ''}`, signal),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: (query) => (query.state.data?.pages.some((p) => p.items.some((v) => v.status === 'pending' || v.status === 'processing')) ? 5000 : false),
  });
  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const total = list.data?.pages[0]?.total ?? 0;
  const loadMore = useCallback(() => void list.fetchNextPage(), [list]);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'videos'] });
    void qc.invalidateQueries({ queryKey: ['feed'] });
  };
  useEffect(() => setSelected(new Set()), [qs]);

  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  };
  const allSelected = items.length > 0 && items.every((v) => selected.has(v.id));

  const bulk = async (action: 'public' | 'private' | 'reprocess' | 'delete') => {
    const ids = [...selected];
    try {
      const res = await apiPost<{ done: number; failed: { id: string; error: string }[] }>('/admin/videos/bulk', { ids, action });
      toast(res.failed.length ? `${res.done} berhasil, ${res.failed.length} gagal: ${res.failed[0]!.error}` : `${res.done} video diperbarui`);
      setSelected(new Set());
      refresh();
    } catch (err) {
      toast(errorMessage(err));
    }
  };

  const patch = async (v: AdminVideo, body: Record<string, unknown>, msg: string) => {
    try {
      await apiPatch(`/videos/${v.id}`, body);
      toast(msg);
      refresh();
    } catch (err) {
      toast(errorMessage(err));
    }
  };

  return (
    <div className="dv-studio-page dv-studio-page--wide">
      <h1 className="dv-studio-page__title">Video</h1>
      <div className="dv-myvideos__filters">
        <div className="dv-studio-search">
          <Icon name="filter" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari judul atau ID video" aria-label="Cari video" />
        </div>
        <select className="dv-select dv-select--sm" value={status} onChange={(e) => setParam('status', e.target.value)} aria-label="Status">
          <option value="">Semua status</option>
          <option value="ready">Siap</option>
          <option value="processing">Diproses</option>
          <option value="failed">Gagal</option>
          <option value="missing">Hilang dari Drive</option>
        </select>
        <select className="dv-select dv-select--sm" value={visibility} onChange={(e) => setParam('visibility', e.target.value)} aria-label="Visibilitas">
          <option value="">Semua visibilitas</option>
          <option value="public">Publik</option>
          <option value="private">Privat</option>
        </select>
        <select className="dv-select dv-select--sm" value={owner} onChange={(e) => setParam('owner', e.target.value)} aria-label="Pemilik">
          <option value="">Semua pemilik</option>
          <option value="main">Channel utama (Drive)</option>
          {(users.data?.items ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              @{u.username}
            </option>
          ))}
        </select>
        <select className="dv-select dv-select--sm" value={category} onChange={(e) => setParam('category', e.target.value)} aria-label="Kategori">
          <option value="">Semua kategori</option>
          {(cats.data?.items ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {'— '.repeat(Math.max(0, c.depth - 1))}
              {c.name}
            </option>
          ))}
        </select>
        <select className="dv-select dv-select--sm" value={sort} onChange={(e) => setParam('sort', e.target.value === 'latest' ? '' : e.target.value)} aria-label="Urutkan">
          <option value="latest">Terbaru</option>
          <option value="oldest">Terlama</option>
          <option value="views">Tayangan terbanyak</option>
          <option value="size">Ukuran terbesar</option>
        </select>
        <span className="dv-text-secondary">{total.toLocaleString('id-ID')} video</span>
      </div>
      {selected.size > 0 && (
        <div className="dv-bulkbar">
          <span>{selected.size} dipilih</span>
          <Button size="sm" icon="public" onClick={() => void bulk('public')}>
            Publik
          </Button>
          <Button size="sm" icon="lock" onClick={() => void bulk('private')}>
            Privat
          </Button>
          <Button size="sm" icon="refresh" onClick={() => void bulk('reprocess')}>
            Proses ulang
          </Button>
          <Button size="sm" icon="delete" variant="danger" onClick={() => setBulkDelete(true)}>
            Hapus
          </Button>
          <Button size="sm" variant="text" onClick={() => setSelected(new Set())}>
            Batal pilih
          </Button>
        </div>
      )}
      {!list.isPending && items.length === 0 ? (
        <EmptyState icon="your-videos" title="Tidak ada video" />
      ) : (
        <div className="dv-studio-table-wrap">
          <table className="dv-studio-table">
            <thead>
              <tr>
                <th>
                  <input type="checkbox" aria-label="Pilih semua" checked={allSelected} onChange={(e) => setSelected(e.target.checked ? new Set(items.map((v) => v.id)) : new Set())} />
                </th>
                <th>Video</th>
                <th>Visibilitas</th>
                <th>Status</th>
                <th>Pemilik</th>
                <th>Kategori</th>
                <th>Tanggal</th>
                <th>Tayangan</th>
                <th>Ukuran</th>
              </tr>
            </thead>
            <tbody>
              {items.map((v) => (
                <tr key={v.id} className={`dv-studio-table__row${selected.has(v.id) ? ' is-selected' : ''}`}>
                  <td>
                    <input type="checkbox" aria-label={`Pilih ${v.title}`} checked={selected.has(v.id)} onChange={(e) => toggle(v.id, e.target.checked)} />
                  </td>
                  <td className="dv-studio-table__video">
                    <Link to={watchUrl(v.id)} className="dv-studio-table__thumb" tabIndex={-1} aria-hidden="true">
                      <Thumbnail video={v} sizes="120px" />
                    </Link>
                    <div className="dv-studio-table__titlecell">
                      <Link to={watchUrl(v.id)} className="dv-studio-table__title dv-clamp-2" title={v.title}>
                        {v.title}
                      </Link>
                      <div className="dv-studio-table__actions">
                        <IconButton icon="edit" label="Ubah judul" size={32} onClick={() => setRenaming(v)} />
                        <IconButton icon="folder" label="Pindahkan kategori" size={32} onClick={() => setMoving(v)} />
                        <IconButton icon="description" label={`Subtitle (${v.subtitleCount})`} size={32} onClick={() => setSubs(v)} />
                        <IconButton icon="refresh" label="Proses ulang" size={32} onClick={() => void apiPost(`/admin/videos/${v.id}/reprocess`, { only: 'all' }).then(() => (toast('Diantrekan untuk diproses ulang'), refresh())).catch((e) => toast(errorMessage(e)))} />
                        <IconButton icon="delete" label="Hapus" size={32} onClick={() => setDeleting(v)} />
                      </div>
                    </div>
                  </td>
                  <td>
                    <select
                      className="dv-select dv-select--sm"
                      value={v.visibility}
                      aria-label="Visibilitas"
                      onChange={(e) => void patch(v, { visibility: e.target.value }, e.target.value === 'private' ? 'Video sekarang Privat' : 'Video sekarang Publik')}
                    >
                      <option value="public">Publik</option>
                      <option value="private">Privat</option>
                    </select>
                  </td>
                  <td>
                    <StatusCell v={v} />
                  </td>
                  <td className="dv-studio-table__num">{v.owner ? <Link to={`/@${v.owner.username}`}>@{v.owner.username}</Link> : <span className="dv-text-secondary">Channel utama</span>}</td>
                  <td className="dv-studio-table__num">{v.category?.name ?? <span className="dv-text-secondary">—</span>}</td>
                  <td className="dv-studio-table__num">{formatDate(v.publishedAt)}</td>
                  <td className="dv-studio-table__num">{v.views.toLocaleString('id-ID')}</td>
                  <td className="dv-studio-table__num">{formatBytes(v.sizeBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.isPending && (
            <div className="dv-center dv-p-16">
              <Spinner />
            </div>
          )}
        </div>
      )}
      <InfiniteSentinel onVisible={loadMore} disabled={!list.hasNextPage || list.isFetchingNextPage} />

      {renaming && (
        <RenameDialog
          open
          onClose={() => setRenaming(null)}
          initial={renaming.title}
          onSave={async (title) => {
            await apiPatch(`/videos/${renaming.id}`, { title });
            toast('Judul diubah');
            refresh();
          }}
        />
      )}
      {moving && <CategoryDialog video={moving} categories={cats.data?.items ?? []} onClose={() => setMoving(null)} onSaved={refresh} />}
      {subs && <SubtitleDialog videoId={subs.id} onClose={() => setSubs(null)} />}
      <DeleteVideoDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={deleting?.title ?? ''}
        onConfirm={async () => {
          await apiDelete(`/videos/${deleting!.id}`);
          toast('Video dihapus');
          refresh();
        }}
      />
      <DeleteVideoDialog
        open={bulkDelete}
        onClose={() => setBulkDelete(false)}
        title={`${selected.size} video`}
        onConfirm={async () => {
          await bulk('delete');
        }}
      />
    </div>
  );
}
