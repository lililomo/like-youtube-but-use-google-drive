import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { apiDelete, apiGet, apiPost, errorMessage } from '../../lib/api';
import { invalidatePlaylists, mineKey, useMyPlaylists } from '../../lib/playlistQueries';
import type { PlaylistSummary } from '../../lib/types';
import { useSession } from '../../stores/session';
import { toast } from '../../stores/toast';
import { Icon } from '../icons/Icon';
import { Button } from '../ui/Button';
import { Checkbox, Spinner, TextField } from '../ui/misc';
import { Dialog } from '../ui/Dialog';

const TITLE_MAX = 150;

/** Dialog "Simpan video ke…" (SPEC §15.6): toggle langsung tersimpan (optimistic) + buat playlist baru. */
export function SaveDialog({ open, onClose, videoId }: { open: boolean; onClose: () => void; videoId: string }) {
  const qc = useQueryClient();
  const user = useSession((s) => s.user);
  const mine = useMyPlaylists(open);
  const contains = useQuery({
    queryKey: ['playlists', 'contains', videoId, user?.id ?? 'guest'],
    queryFn: ({ signal }) => apiGet<{ ids: string[] }>(`/playlists/contains/${videoId}`, signal),
    enabled: open,
    staleTime: 0,
  });
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (contains.data) setChecked(new Set(contains.data.ids));
  }, [contains.data]);
  useEffect(() => {
    if (!open) {
      setCreating(false);
      setTitle('');
      setVisibility('private');
    }
  }, [open]);

  const toggle = async (p: PlaylistSummary, on: boolean) => {
    const prev = new Set(checked);
    const next = new Set(checked);
    if (on) next.add(p.id);
    else next.delete(p.id);
    setChecked(next);
    try {
      if (on) await apiPost(`/playlists/${p.id}/items`, { videoId });
      else await apiDelete(`/playlists/${p.id}/items/${videoId}`);
      toast(on ? `Disimpan ke ${p.title}` : `Dihapus dari ${p.title}`);
      invalidatePlaylists(qc, p.id);
    } catch (err) {
      setChecked(prev);
      toast(errorMessage(err));
    }
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      const res = await apiPost<{ playlist: PlaylistSummary }>('/playlists', { title: title.trim(), visibility: user ? visibility : 'private', videoId });
      toast(`Disimpan ke ${res.playlist.title}`);
      invalidatePlaylists(qc);
      void qc.invalidateQueries({ queryKey: mineKey(user?.id) });
      onClose();
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const guestBlocked = !user && mine.data && !mine.data.guestAllowed;
  const items = mine.data?.items ?? [];

  return (
    <Dialog open={open} onClose={onClose} title="Simpan video ke…" width={320} showClose className="dv-save">
      {guestBlocked ? (
        <p className="dv-text-secondary">
          <Link to="/login">Login</Link> untuk menyimpan video ke playlist.
        </p>
      ) : mine.isPending || contains.isPending ? (
        <div className="dv-center dv-p-16">
          <Spinner size={28} />
        </div>
      ) : (
        <>
          {items.length > 0 && (
            <div className="dv-save__list" role="list">
              {items.map((p) => (
                <div key={p.id} className="dv-save__row" role="listitem">
                  <Checkbox checked={checked.has(p.id)} onChange={(on) => void toggle(p, on)}>
                    <span className="dv-save__title">{p.title}</span>
                  </Checkbox>
                  <Icon name={p.visibility === 'public' ? 'public' : 'lock'} size={20} className="dv-save__vis" />
                </div>
              ))}
            </div>
          )}
          {!user && <p className="dv-save__note">Playlist tamu hanya tersimpan di perangkat ini dan selalu privat.</p>}
          {creating ? (
            <form onSubmit={create} className="dv-form dv-save__create">
              <TextField
                label="Nama"
                value={title}
                maxLength={TITLE_MAX}
                autoFocus
                onChange={(e) => setTitle(e.target.value)}
                helper={`${title.length}/${TITLE_MAX}`}
              />
              {user && (
                <label className="dv-save__select">
                  <span>Visibilitas</span>
                  <select className="dv-select" value={visibility} onChange={(e) => setVisibility(e.target.value as 'private' | 'public')}>
                    <option value="private">Privat</option>
                    <option value="public">Publik</option>
                  </select>
                </label>
              )}
              <div className="dv-form__actions">
                <Button type="submit" variant="cta-text" disabled={busy || !title.trim()}>
                  Buat
                </Button>
              </div>
            </form>
          ) : (
            <button type="button" className="dv-save__new" onClick={() => setCreating(true)}>
              <Icon name="add" /> Buat playlist baru
            </button>
          )}
        </>
      )}
    </Dialog>
  );
}
