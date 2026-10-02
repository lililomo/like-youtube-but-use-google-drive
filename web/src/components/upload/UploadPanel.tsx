import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { formatBytes } from '../../lib/format';
import { watchUrl } from '../../lib/videoQueries';
import { useSession } from '../../stores/session';
import { toast } from '../../stores/toast';
import { useUploads, type UploadItem } from '../../stores/uploads';
import { Icon } from '../icons/Icon';
import { Button, IconButton } from '../ui/Button';
import { UploadDialog } from './UploadDialog';

function statusText(it: UploadItem): string {
  const pct = it.size ? Math.floor((it.received / it.size) * 100) : 0;
  switch (it.status) {
    case 'queued':
      return 'Menunggu…';
    case 'starting':
      return 'Memulai…';
    case 'uploading':
      return `Mengupload ${pct}%${it.speed ? ` · ${formatBytes(it.speed)}/dtk` : ''}`;
    case 'retrying':
      return `Koneksi terputus — mencoba lagi${it.retryAt ? ` dalam ${Math.max(1, Math.ceil((it.retryAt - Date.now()) / 1000))} dtk` : ''} (${pct}%)`;
    case 'paused':
      return `Dijeda (${pct}%)`;
    case 'needs-file':
      return `Belum selesai (${pct}%) — pilih file lagi untuk melanjutkan`;
    case 'done':
      return 'Upload selesai · sedang diproses';
    case 'error':
      return it.error ?? 'Gagal';
    case 'cancelled':
      return 'Dibatalkan';
  }
}

function Row({ it }: { it: UploadItem }) {
  const cancel = useUploads((s) => s.cancel);
  const retry = useUploads((s) => s.retry);
  const remove = useUploads((s) => s.remove);
  const provide = useUploads((s) => s.provideFile);
  const pick = useRef<HTMLInputElement>(null);
  const pct = it.size ? (it.received / it.size) * 100 : 0;
  const active = ['queued', 'starting', 'uploading', 'retrying'].includes(it.status);
  return (
    <div className={`dv-upitem is-${it.status}`}>
      <Icon name={it.status === 'done' ? 'check-circle' : it.status === 'error' ? 'error' : 'upload-outline'} className="dv-upitem__icon" />
      <div className="dv-upitem__body">
        <div className="dv-upitem__name" title={it.name}>
          {it.status === 'done' && it.videoId ? <Link to={watchUrl(it.videoId)}>{it.name}</Link> : it.name}
        </div>
        <div className="dv-upitem__status">{statusText(it)}</div>
        {(active || it.status === 'paused' || it.status === 'needs-file') && (
          <div className="dv-upitem__bar" role="progressbar" aria-valuenow={Math.floor(pct)} aria-valuemin={0} aria-valuemax={100}>
            <div style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      <div className="dv-upitem__actions">
        {it.status === 'paused' && (
          <Button size="sm" variant="cta-text" onClick={() => retry(it.key)}>
            Coba lagi
          </Button>
        )}
        {it.status === 'needs-file' && (
          <>
            <Button size="sm" variant="cta-text" onClick={() => pick.current?.click()}>
              Pilih file lagi
            </Button>
            <input
              ref={pick}
              type="file"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                const err = provide(it.key, f);
                if (err) toast(err);
              }}
            />
          </>
        )}
        {active || it.status === 'paused' || it.status === 'needs-file' ? (
          <IconButton icon="close" label="Batalkan upload" size={32} onClick={() => cancel(it.key)} />
        ) : (
          <IconButton icon="close" label="Hapus dari daftar" size={32} onClick={() => remove(it.key)} />
        )}
      </div>
    </div>
  );
}

/** Panel UploadManager di pojok kanan bawah (global, tetap ada saat pindah halaman). */
export function UploadPanel() {
  const user = useSession((s) => s.user);
  const items = useUploads((s) => s.items);
  const open = useUploads((s) => s.panelOpen);
  const collapsed = useUploads((s) => s.collapsed);
  const setCollapsed = useUploads((s) => s.setCollapsed);
  const closePanel = useUploads((s) => s.closePanel);
  const restore = useUploads((s) => s.restore);
  const completed = useUploads((s) => s.completed);
  const qc = useQueryClient();

  useEffect(() => {
    if (user) void restore();
  }, [user, restore]);
  useEffect(() => {
    if (!completed) return;
    void qc.invalidateQueries({ queryKey: ['me', 'videos'] });
    void qc.invalidateQueries({ queryKey: ['feed'] });
    void useSession.getState().load();
  }, [completed, qc]);

  const active = items.filter((i) => ['queued', 'starting', 'uploading', 'retrying'].includes(i.status)).length;
  const done = items.filter((i) => i.status === 'done').length;
  const title = active ? `Mengupload ${active} video` : done ? `${done} upload selesai` : 'Upload';

  return (
    <>
      {user && <UploadDialog />}
      {user && open && items.length > 0 && (
        <section className={`dv-uppanel${collapsed ? ' is-collapsed' : ''}`} aria-label="Upload">
          <header className="dv-uppanel__head">
            <span className="dv-uppanel__title">{title}</span>
            <IconButton icon={collapsed ? 'expand-less' : 'expand-more'} label={collapsed ? 'Buka' : 'Lipat'} size={32} onClick={() => setCollapsed(!collapsed)} />
            {active === 0 && <IconButton icon="close" label="Tutup" size={32} onClick={closePanel} />}
          </header>
          {!collapsed && (
            <div className="dv-uppanel__list">
              {items.map((it) => (
                <Row key={it.key} it={it} />
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}
