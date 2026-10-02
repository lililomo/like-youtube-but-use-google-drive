import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiPost, errorMessage } from '../../lib/api';
import { invalidatePlaylists, useMyPlaylists } from '../../lib/playlistQueries';
import { useSession } from '../../stores/session';
import { toast } from '../../stores/toast';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';

const DISMISS_KEY = 'dv.importDismissed';

/** Setelah login di perangkat yang punya playlist tamu: tawarkan pindah ke akun (SPEC §14.2 import-guest). */
export function GuestImportPrompt() {
  const user = useSession((s) => s.user);
  const qc = useQueryClient();
  const mine = useMyPlaylists(Boolean(user));
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [busy, setBusy] = useState(false);
  const count = user ? (mine.data?.guestCount ?? 0) : 0;
  if (!user || dismissed || count === 0) return null;

  const close = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* abaikan */
    }
  };
  const run = async () => {
    setBusy(true);
    try {
      const res = await apiPost<{ imported: number }>('/playlists/import-guest');
      invalidatePlaylists(qc);
      toast(`${res.imported} playlist dipindahkan ke akun Anda`);
      close();
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={close}
      title="Pindahkan playlist ke akun?"
      width={420}
      actions={
        <>
          <Button variant="text" onClick={close}>
            Nanti
          </Button>
          <Button variant="cta-text" disabled={busy} onClick={() => void run()}>
            Pindahkan
          </Button>
        </>
      }
    >
      <p className="dv-text-secondary">
        Ada {count} playlist yang Anda buat di perangkat ini sebelum login. Pindahkan ke akun Anda agar bisa dibuka di perangkat lain?
      </p>
    </Dialog>
  );
}
