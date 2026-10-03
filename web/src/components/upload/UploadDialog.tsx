import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router';
import { useSite } from '../../hooks/useSite';
import { apiGet } from '../../lib/api';
import { formatBytes } from '../../lib/format';
import { useSession } from '../../stores/session';
import { toast } from '../../stores/toast';
import { useUploads } from '../../stores/uploads';
import { Icon } from '../icons/Icon';
import { Button, IconButton } from '../ui/Button';
import { Dialog } from '../ui/Dialog';

interface CategoryOption {
  id: number;
  name: string;
  path: string;
  depth: number;
}

const DEFAULT_EXT = ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'wmv', 'flv', 'ts', 'mts', 'm2ts', '3gp', 'mpg', 'mpeg', 'ogv'];
const ext = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';

interface Picked {
  file: File;
  subtitle: { file: File; lang: string } | null;
}

/** Dialog Upload gaya YouTube Studio: area drop + PILIH FILE → detail (visibilitas, kategori, subtitle opsional). */
export function UploadDialog() {
  const open = useUploads((s) => s.dialogOpen);
  const close = useUploads((s) => s.closeDialog);
  const add = useUploads((s) => s.add);
  const user = useSession((s) => s.user);
  const site = useSite();
  const navigate = useNavigate();
  const canImport = site.importEnabled || user?.role === 'admin';
  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const cats = useQuery({ queryKey: ['categories', 'all'], queryFn: () => apiGet<{ items: CategoryOption[] }>('/categories/all'), enabled: open && Boolean(user), staleTime: 60_000 });

  useEffect(() => {
    if (!open) {
      setPicked([]);
      setDragOver(false);
      setCategoryId(null);
    }
  }, [open]);

  const accept = (files: FileList | File[]) => {
    const list = Array.from(files);
    const ok = list.filter((f) => DEFAULT_EXT.includes(ext(f.name)));
    const bad = list.length - ok.length;
    if (bad) toast(`${bad} file dilewati: format tidak didukung`);
    if (ok.length) setPicked((p) => [...p, ...ok.map((file) => ({ file, subtitle: null }))].slice(0, 20));
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) accept(e.dataTransfer.files);
  };

  const start = () => {
    add(picked, { visibility, categoryId });
    close();
  };

  const totalSize = picked.reduce((a, p) => a + p.file.size, 0);
  const quota = user?.storageQuotaBytes ?? null;
  const free = quota == null ? null : Math.max(0, quota - (user?.storageUsedBytes ?? 0));

  return (
    <Dialog open={open} onClose={close} title="Upload video" width={picked.length ? 720 : 960} showClose className="dv-upload-dialog">
      {!site.uploadEnabled ? (
        <p className="dv-text-secondary">Upload sedang dinonaktifkan oleh admin.</p>
      ) : picked.length === 0 ? (
        <div
          className={`dv-upload-drop${dragOver ? ' is-over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <button type="button" className="dv-upload-drop__icon" onClick={() => input.current?.click()} aria-label="Pilih file">
            <Icon name="upload" size={64} />
          </button>
          <p className="dv-upload-drop__title">Tarik lalu lepas file video untuk diupload</p>
          <p className="dv-upload-drop__sub">Video Anda bersifat privat atau publik sesuai pilihan di langkah berikutnya.</p>
          <Button variant="primary" onClick={() => input.current?.click()}>
            PILIH FILE
          </Button>
          <p className="dv-upload-drop__hint">
            Format: {DEFAULT_EXT.join(', ')}
            {free != null && <> · Sisa kuota: {formatBytes(free)}</>}
          </p>
          {canImport && (
            <Button
              variant="cta-text"
              icon="download"
              onClick={() => {
                close();
                navigate('/my/imports');
              }}
            >
              Atau impor dari link YouTube
            </Button>
          )}
        </div>
      ) : (
        <div className="dv-upload-details">
          <div className="dv-upload-details__files">
            {picked.map((p, i) => (
              <div key={`${p.file.name}-${i}`} className="dv-upload-file">
                <Icon name="your-videos" />
                <div className="dv-upload-file__body">
                  <div className="dv-upload-file__name">{p.file.name}</div>
                  <div className="dv-upload-file__meta">{formatBytes(p.file.size)}</div>
                  <label className="dv-upload-file__sub">
                    <span>Subtitle (opsional):</span>
                    <input
                      type="file"
                      accept=".srt,.vtt"
                      onChange={(e) => {
                        const f = e.target.files?.[0] ?? null;
                        setPicked((all) => all.map((x, j) => (j === i ? { ...x, subtitle: f ? { file: f, lang: x.subtitle?.lang ?? 'id' } : null } : x)));
                      }}
                    />
                    {p.subtitle && (
                      <select
                        className="dv-select dv-select--sm"
                        value={p.subtitle.lang}
                        onChange={(e) => setPicked((all) => all.map((x, j) => (j === i && x.subtitle ? { ...x, subtitle: { ...x.subtitle, lang: e.target.value } } : x)))}
                      >
                        <option value="id">Indonesia</option>
                        <option value="en">Inggris</option>
                        <option value="ja">Jepang</option>
                        <option value="ko">Korea</option>
                        <option value="zh">Mandarin</option>
                        <option value="ar">Arab</option>
                        <option value="">Lainnya</option>
                      </select>
                    )}
                  </label>
                </div>
                <IconButton icon="close" label="Hapus dari daftar" onClick={() => setPicked((all) => all.filter((_, j) => j !== i))} />
              </div>
            ))}
            <Button variant="text" icon="add" onClick={() => input.current?.click()}>
              Tambah file
            </Button>
          </div>
          <div className="dv-upload-details__opts">
            <h3 className="dv-upload-details__heading">Visibilitas</h3>
            <label className="dv-radio">
              <input type="radio" name="dv-up-vis" checked={visibility === 'public'} onChange={() => setVisibility('public')} />
              <span>
                <span className="dv-radio__title">Publik</span>
                <span className="dv-radio__desc">Semua orang dapat menonton video Anda, termasuk tamu.</span>
              </span>
            </label>
            <label className="dv-radio">
              <input type="radio" name="dv-up-vis" checked={visibility === 'private'} onChange={() => setVisibility('private')} />
              <span>
                <span className="dv-radio__title">Privat</span>
                <span className="dv-radio__desc">Hanya Anda (dan admin) yang dapat menonton video ini.</span>
              </span>
            </label>
            <h3 className="dv-upload-details__heading">Kategori</h3>
            <select className="dv-select" value={categoryId ?? ''} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Tanpa kategori (folder utama)</option>
              {(cats.data?.items ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {'— '.repeat(Math.max(0, c.depth - 1))}
                  {c.name}
                </option>
              ))}
            </select>
            <p className="dv-text-secondary dv-upload-details__note">
              Total {formatBytes(totalSize)}
              {free != null && totalSize > free && <b className="dv-text-error"> · melebihi sisa kuota ({formatBytes(free)})</b>}
            </p>
            <div className="dv-form__actions">
              <Button variant="primary" onClick={start} disabled={!picked.length}>
                Upload {picked.length > 1 ? `${picked.length} video` : ''}
              </Button>
            </div>
          </div>
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept={DEFAULT_EXT.map((e) => `.${e}`).join(',') + ',video/*'}
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) accept(e.target.files);
          e.target.value = '';
        }}
      />
    </Dialog>
  );
}
