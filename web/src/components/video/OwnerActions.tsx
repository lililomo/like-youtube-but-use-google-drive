import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { apiDelete, apiPatch, errorMessage } from '../../lib/api';
import type { VideoDetail } from '../../lib/types';
import { videoKey } from '../../lib/videoQueries';
import { toast } from '../../stores/toast';
import { Icon } from '../icons/Icon';
import { Button, IconButton } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { TextField } from '../ui/misc';
import { MenuItem, Popup } from '../ui/Popup';

export const TITLE_MAX = 100;

/** Dialog ubah judul (judul = nama file di Google Drive). */
export function RenameDialog({
  open,
  onClose,
  initial,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  initial: string;
  onSave: (title: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSave(title.trim());
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
      title="Ubah judul"
      width={480}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            Batal
          </Button>
          <Button variant="cta-text" type="submit" form="dv-rename-form" disabled={busy || !title.trim() || title.trim() === initial}>
            Simpan
          </Button>
        </>
      }
    >
      <form id="dv-rename-form" onSubmit={submit} className="dv-form">
        <TextField
          label="Judul (wajib diisi)"
          value={title}
          maxLength={TITLE_MAX}
          onChange={(e) => setTitle(e.target.value)}
          error={error}
          helper={`${title.length}/${TITLE_MAX} · Nama file di Google Drive ikut berubah`}
          autoFocus
        />
      </form>
    </Dialog>
  );
}

/** Konfirmasi hapus video. */
export function DeleteVideoDialog({ open, onClose, title, onConfirm }: { open: boolean; onClose: () => void; title: string; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Hapus video ini?"
      width={440}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            Batal
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onClose();
              } catch (err) {
                toast(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            Hapus
          </Button>
        </>
      }
    >
      <p className="dv-text-secondary">
        <b className="dv-text">{title}</b> akan dihapus dari situs dan filenya dipindahkan ke Sampah Google Drive (bisa dipulihkan dari Drive selama 30 hari).
      </p>
    </Dialog>
  );
}

/** Pill Publik/Privat + menu ⋯ (Ubah judul, Hapus) untuk pemilik/admin di halaman tonton. */
export function OwnerActions({ video, onDeleted }: { video: VideoDetail; onDeleted: () => void }) {
  const qc = useQueryClient();
  const visAnchor = useRef<HTMLButtonElement>(null);
  const moreAnchor = useRef<HTMLButtonElement>(null);
  const [visOpen, setVisOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const patch = async (body: Partial<Pick<VideoDetail, 'title' | 'visibility'>>) => {
    const fresh = await apiPatch<VideoDetail>(`/videos/${video.id}`, body);
    qc.setQueryData(videoKey(video.id), fresh);
    void qc.invalidateQueries({ queryKey: ['feed'] });
    void qc.invalidateQueries({ queryKey: ['me', 'videos'] });
    return fresh;
  };

  const setVisibility = async (visibility: 'public' | 'private') => {
    setVisOpen(false);
    if (visibility === video.visibility) return;
    try {
      await patch({ visibility });
      toast(visibility === 'private' ? 'Video sekarang Privat' : 'Video sekarang Publik');
    } catch (err) {
      toast(errorMessage(err));
    }
  };

  const isPrivate = video.visibility === 'private';
  return (
    <>
      <Button ref={visAnchor} variant="tonal" icon={isPrivate ? 'lock' : 'public'} onClick={() => setVisOpen(!visOpen)} aria-haspopup="menu">
        {isPrivate ? 'Privat' : 'Publik'}
        <Icon name="expand-more" size={20} className="dv-btn__caret" />
      </Button>
      <Popup open={visOpen} onClose={() => setVisOpen(false)} anchorRef={visAnchor} align="left" className="dv-vis-menu">
        <MenuItem icon="public" checked={!isPrivate} onClick={() => void setVisibility('public')}>
          <span className="dv-vis-menu__title">Publik</span>
          <span className="dv-vis-menu__desc">Semua orang dapat menonton video ini</span>
        </MenuItem>
        <MenuItem icon="lock" checked={isPrivate} onClick={() => void setVisibility('private')}>
          <span className="dv-vis-menu__title">Privat</span>
          <span className="dv-vis-menu__desc">Hanya Anda (dan admin) yang dapat menonton</span>
        </MenuItem>
      </Popup>
      <IconButton ref={moreAnchor} icon="more-horiz" label="Tindakan lainnya" className="dv-watch__more" onClick={() => setMoreOpen(!moreOpen)} />
      <Popup open={moreOpen} onClose={() => setMoreOpen(false)} anchorRef={moreAnchor} align="right">
        <MenuItem
          icon="edit"
          onClick={() => {
            setMoreOpen(false);
            setRenaming(true);
          }}
        >
          Ubah judul
        </MenuItem>
        <MenuItem
          icon="delete"
          onClick={() => {
            setMoreOpen(false);
            setDeleting(true);
          }}
        >
          Hapus
        </MenuItem>
      </Popup>
      {renaming && (
        <RenameDialog
          open
          onClose={() => setRenaming(false)}
          initial={video.title}
          onSave={async (title) => {
            await patch({ title });
            toast('Judul diubah');
          }}
        />
      )}
      <DeleteVideoDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title={video.title}
        onConfirm={async () => {
          await apiDelete(`/videos/${video.id}`);
          qc.removeQueries({ queryKey: videoKey(video.id) });
          void qc.invalidateQueries({ queryKey: ['feed'] });
          toast('Video dihapus');
          onDeleted();
        }}
      />
    </>
  );
}
