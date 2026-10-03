import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Icon } from '../components/icons/Icon';
import { Button, ButtonLink, IconButton } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { EmptyState, Spinner } from '../components/ui/misc';
import { StudioTabs } from '../components/imports/StudioTabs';
import { DeleteVideoDialog, RenameDialog } from '../components/video/OwnerActions';
import { Thumbnail } from '../components/video/Thumbnail';
import { InfiniteSentinel } from '../components/video/VideoGrid';
import { useDocumentTitle, useSite } from '../hooks/useSite';
import { apiDelete, apiGet, apiPatch, csrfToken, errorMessage } from '../lib/api';
import { formatBytes, formatDate, formatViews } from '../lib/format';
import type { VideoDetail, VideoSummary } from '../lib/types';
import { watchUrl } from '../lib/videoQueries';
import { useSession } from '../stores/session';
import { toast } from '../stores/toast';
import { useUploads } from '../stores/uploads';
import '../styles/studio.css';

export type StudioVideo = VideoSummary & {
  status: 'pending' | 'processing' | 'ready' | 'failed' | 'missing';
  processingError: string | null;
  processingProgress: number | null;
  sizeBytes: number;
  subtitleCount: number;
};

interface MyPage {
  items: StudioVideo[];
  total: number;
  nextCursor: string | null;
}

export function StatusCell({ v }: { v: StudioVideo }) {
  if (v.status === 'ready') return <span className="dv-status dv-status--ok">Siap</span>;
  if (v.status === 'failed')
    return (
      <span className="dv-status dv-status--error" title={v.processingError ?? ''}>
        <Icon name="error" size={16} /> Gagal diproses
      </span>
    );
  if (v.status === 'missing') return <span className="dv-status dv-status--error">Tidak ada di Drive</span>;
  return (
    <span className="dv-status dv-status--busy">
      <Spinner size={14} /> {v.status === 'pending' ? 'Menunggu proses' : `Memproses${v.processingProgress != null ? ` ${Math.round(v.processingProgress)}%` : '…'}`}
    </span>
  );
}

const LANGS: [string, string][] = [
  ['id', 'Indonesia'],
  ['en', 'Inggris'],
  ['ja', 'Jepang'],
  ['ko', 'Korea'],
  ['zh', 'Mandarin'],
  ['ar', 'Arab'],
  ['', 'Tanpa bahasa'],
];

/** Kelola subtitle satu video (daftar + hapus + upload .srt/.vtt). */
export function SubtitleDialog({ videoId, onClose }: { videoId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: ['video', videoId], queryFn: () => apiGet<VideoDetail>(`/videos/${videoId}`) });
  const input = useRef<HTMLInputElement>(null);
  const [lang, setLang] = useState('id');
  const [busy, setBusy] = useState(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['video', videoId] });
    void qc.invalidateQueries({ queryKey: ['me', 'videos'] });
  };
  const upload = async (e: FormEvent) => {
    e.preventDefault();
    const f = input.current?.files?.[0];
    if (!f) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('lang', lang);
      fd.append('file', f);
      const res = await fetch(`/api/videos/${videoId}/subtitles`, { method: 'POST', body: fd, headers: { 'X-CSRF-Token': csrfToken() }, credentials: 'same-origin' });
      const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) throw new Error(data?.error?.message ?? `Gagal (${res.status})`);
      toast('Subtitle ditambahkan');
      if (input.current) input.current.value = '';
      refresh();
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: number) => {
    try {
      await apiDelete(`/subtitles/${id}`);
      toast('Subtitle dihapus');
      refresh();
    } catch (err) {
      toast(errorMessage(err));
    }
  };
  return (
    <Dialog open onClose={onClose} title="Subtitle" width={480} showClose>
      {detail.isPending ? (
        <Spinner />
      ) : (
        <>
          {(detail.data?.subtitles ?? []).length === 0 ? (
            <p className="dv-text-secondary">Belum ada subtitle.</p>
          ) : (
            <ul className="dv-sublist">
              {detail.data!.subtitles.map((s) => (
                <li key={s.id}>
                  <span>{s.label}</span>
                  {s.isDefault && <span className="dv-chip-tag">Default</span>}
                  <IconButton icon="delete" label={`Hapus ${s.label}`} size={32} onClick={() => void remove(s.id)} />
                </li>
              ))}
            </ul>
          )}
          <form className="dv-subform" onSubmit={upload}>
            <input ref={input} type="file" accept=".srt,.vtt" required />
            <select className="dv-select" value={lang} onChange={(e) => setLang(e.target.value)}>
              {LANGS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <Button type="submit" variant="primary" disabled={busy}>
              Tambah
            </Button>
          </form>
          <p className="dv-text-secondary dv-subform__hint">File .srt / .vtt maks 2 MB, disimpan di folder video di Google Drive.</p>
        </>
      )}
    </Dialog>
  );
}

function Row({ v }: { v: StudioVideo }) {
  const qc = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [subs, setSubs] = useState(false);
  const patch = async (body: { title?: string; visibility?: 'public' | 'private' }) => {
    await apiPatch(`/videos/${v.id}`, body);
    void qc.invalidateQueries({ queryKey: ['me', 'videos'] });
    void qc.invalidateQueries({ queryKey: ['video', v.id] });
    void qc.invalidateQueries({ queryKey: ['feed'] });
  };
  return (
    <tr className="dv-studio-table__row">
      <td className="dv-studio-table__video">
        <Link to={watchUrl(v.id)} className="dv-studio-table__thumb" tabIndex={-1} aria-hidden="true">
          <Thumbnail video={v} sizes="120px" />
        </Link>
        <div className="dv-studio-table__titlecell">
          <Link to={watchUrl(v.id)} className="dv-studio-table__title dv-clamp-2" title={v.title}>
            {v.title}
          </Link>
          <div className="dv-studio-table__actions">
            <IconButton icon="edit" label="Ubah judul" size={32} onClick={() => setRenaming(true)} />
            <IconButton icon="description" label={`Subtitle (${v.subtitleCount})`} size={32} onClick={() => setSubs(true)} />
            <IconButton icon="play-arrow" label="Tonton" size={32} onClick={() => window.open(watchUrl(v.id), '_self')} />
            <IconButton icon="delete" label="Hapus" size={32} onClick={() => setDeleting(true)} />
          </div>
        </div>
      </td>
      <td>
        <select
          className="dv-select dv-select--sm"
          value={v.visibility}
          aria-label="Visibilitas"
          onChange={async (e) => {
            try {
              await patch({ visibility: e.target.value as 'public' | 'private' });
              toast(e.target.value === 'private' ? 'Video sekarang Privat' : 'Video sekarang Publik');
            } catch (err) {
              toast(errorMessage(err));
            }
          }}
        >
          <option value="public">Publik</option>
          <option value="private">Privat</option>
        </select>
      </td>
      <td>
        <StatusCell v={v} />
      </td>
      <td className="dv-studio-table__num">{formatDate(v.publishedAt)}</td>
      <td className="dv-studio-table__num">{formatViews(v.views).replace(' x ditonton', '').replace('Belum ditonton', '0')}</td>
      <td className="dv-studio-table__num">{formatBytes(v.sizeBytes)}</td>
      {renaming && (
        <RenameDialog
          open
          onClose={() => setRenaming(false)}
          initial={v.title}
          onSave={async (title) => {
            await patch({ title });
            toast('Judul diubah');
          }}
        />
      )}
      <DeleteVideoDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title={v.title}
        onConfirm={async () => {
          await apiDelete(`/videos/${v.id}`);
          void qc.invalidateQueries({ queryKey: ['me', 'videos'] });
          void useSession.getState().load();
          toast('Video dihapus');
        }}
      />
      {subs && <SubtitleDialog videoId={v.id} onClose={() => setSubs(false)} />}
    </tr>
  );
}

/** Halaman Video Anda (/my/videos) gaya YouTube Studio "Konten". */
export function MyVideosPage() {
  useDocumentTitle('Video Anda');
  const [params, setParams] = useSearchParams();
  const openUpload = useUploads((s) => s.openDialog);
  const user = useSession((s) => s.user);
  const site = useSite();
  const canImport = site.importEnabled || user?.role === 'admin';
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [visibility, setVisibility] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (params.get('upload') === '1') {
      openUpload();
      params.delete('upload');
      setParams(params, { replace: true });
    }
  }, [params, setParams, openUpload]);
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const list = useInfiniteQuery({
    queryKey: ['me', 'videos', qDebounced, visibility, status],
    queryFn: ({ pageParam, signal }) =>
      apiGet<MyPage>(
        `/me/videos?${new URLSearchParams({ ...(qDebounced ? { q: qDebounced } : {}), ...(visibility ? { visibility } : {}), ...(status ? { status } : {}), ...(pageParam ? { cursor: pageParam } : {}) })}`,
        signal,
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // Segarkan berkala selama ada video yang diproses.
    refetchInterval: (query) => (query.state.data?.pages.some((p) => p.items.some((v) => v.status === 'pending' || v.status === 'processing')) ? 5000 : false),
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;
  const loadMore = useCallback(() => void list.fetchNextPage(), [list]);
  const quota = user?.storageQuotaBytes ?? null;

  return (
    <div className="dv-myvideos">
      <StudioTabs />
      <div className="dv-myvideos__head">
        <h1 className="dv-plgrid-page__title">Video Anda</h1>
        <div className="dv-row">
          {canImport && (
            <ButtonLink to="/my/imports" icon="download">
              Impor YouTube
            </ButtonLink>
          )}
          <Button variant="primary" icon="upload" onClick={openUpload}>
            Upload video
          </Button>
        </div>
      </div>
      {user && (
        <p className="dv-text-secondary dv-mb-16">
          Penyimpanan terpakai {formatBytes(user.storageUsedBytes)}
          {quota != null ? ` dari ${formatBytes(quota)}` : ' (tanpa batas kuota)'}
        </p>
      )}
      <div className="dv-myvideos__filters">
        <div className="dv-studio-search">
          <Icon name="filter" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter judul" aria-label="Filter judul" />
        </div>
        <select className="dv-select dv-select--sm" value={visibility} onChange={(e) => setVisibility(e.target.value)} aria-label="Visibilitas">
          <option value="">Semua visibilitas</option>
          <option value="public">Publik</option>
          <option value="private">Privat</option>
        </select>
        <select className="dv-select dv-select--sm" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">Semua status</option>
          <option value="ready">Siap</option>
          <option value="processing">Diproses</option>
          <option value="failed">Gagal</option>
        </select>
        <span className="dv-text-secondary">{total.toLocaleString('id-ID')} video</span>
      </div>
      {!list.isPending && items.length === 0 ? (
        <EmptyState icon="your-videos" title={qDebounced || visibility || status ? 'Tidak ada video yang cocok' : 'Belum ada video'}>
          {!qDebounced && !visibility && !status && (
            <>
              <p>Upload video pertama Anda.</p>
              <Button variant="primary" onClick={openUpload}>
                Upload video
              </Button>
            </>
          )}
        </EmptyState>
      ) : (
        <div className="dv-studio-table-wrap">
          <table className="dv-studio-table">
            <thead>
              <tr>
                <th>Video</th>
                <th>Visibilitas</th>
                <th>Status</th>
                <th>Tanggal</th>
                <th>Tayangan</th>
                <th>Ukuran</th>
              </tr>
            </thead>
            <tbody>
              {items.map((v) => (
                <Row key={v.id} v={v} />
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
    </div>
  );
}
