import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Button, IconButton } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Avatar, EmptyState, PasswordField, Spinner, TextField } from '../../components/ui/misc';
import { copyText } from '../../components/video/VideoMenu';
import { useDocumentTitle } from '../../hooks/useSite';
import { apiDelete, apiGet, apiPatch, apiPost, errorMessage } from '../../lib/api';
import { formatBytes, formatRelative } from '../../lib/format';
import { useSession } from '../../stores/session';
import { toast } from '../../stores/toast';

export interface AdminUser {
  id: number;
  username: string;
  displayName: string;
  role: 'admin' | 'user';
  status: 'active' | 'disabled';
  avatarColor: string;
  avatarUrl: string | null;
  storageQuotaBytes: number | null;
  storageUsedBytes: number;
  videoCount: number;
  lastLoginAt: string | null;
  createdAt: string;
}

const GB = 1024 ** 3;

/** Password acak mudah dibaca (tanpa karakter mirip: 0/O, 1/l/I). */
export function generatePassword(len = 14): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => chars[n % chars.length]).join('');
}

function UserDialog({ user, onClose }: { user: AdminUser | null; onClose: () => void }) {
  const qc = useQueryClient();
  const isNew = !user;
  const [username, setUsername] = useState(user?.username ?? '');
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [password, setPassword] = useState(isNew ? generatePassword() : '');
  const [role, setRole] = useState<'admin' | 'user'>(user?.role ?? 'user');
  const [status, setStatus] = useState<'active' | 'disabled'>(user?.status ?? 'active');
  const [quota, setQuota] = useState(user?.storageQuotaBytes != null ? String(+(user.storageQuotaBytes / GB).toFixed(2)) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const quotaGb = quota.trim() === '' ? null : Number(quota.replace(',', '.'));
    if (quotaGb != null && (!Number.isFinite(quotaGb) || quotaGb < 0)) {
      setError('Kuota harus angka (GB) atau kosong untuk tanpa batas');
      setBusy(false);
      return;
    }
    try {
      if (isNew) {
        await apiPost('/admin/users', { username: username.trim(), displayName: displayName.trim(), password, role, status, quotaGb });
        await copyText(password).catch(() => {});
        toast(`User ${username} dibuat — password disalin ke papan klip`);
      } else {
        await apiPatch(`/admin/users/${user.id}`, { displayName: displayName.trim(), role, status, quotaGb });
        toast('User diperbarui');
      }
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={isNew ? 'Tambah pengguna' : `Ubah ${user.username}`}
      width={480}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            Batal
          </Button>
          <Button variant="cta-text" type="submit" form="dv-user-form" disabled={busy}>
            {isNew ? 'Buat' : 'Simpan'}
          </Button>
        </>
      }
    >
      <form id="dv-user-form" className="dv-form" onSubmit={submit}>
        {isNew && (
          <TextField
            label="Username"
            value={username}
            maxLength={32}
            autoComplete="off"
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            helper="3–32 karakter: huruf kecil, angka, titik, garis bawah"
          />
        )}
        <TextField label="Nama tampilan" value={displayName} maxLength={64} onChange={(e) => setDisplayName(e.target.value)} />
        {isNew && (
          <div className="dv-row">
            <div style={{ flex: 1 }}>
              <PasswordField label="Password" value={password} autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} helper="Minimal 8 karakter" />
            </div>
            <Button onClick={() => setPassword(generatePassword())}>Buat acak</Button>
          </div>
        )}
        <div className="dv-row">
          <label className="dv-field-inline">
            <span>Role</span>
            <select className="dv-select" value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'user')}>
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <label className="dv-field-inline">
            <span>Status</span>
            <select className="dv-select" value={status} onChange={(e) => setStatus(e.target.value as 'active' | 'disabled')}>
              <option value="active">Aktif</option>
              <option value="disabled">Nonaktif</option>
            </select>
          </label>
        </div>
        <TextField label="Kuota penyimpanan (GB)" value={quota} inputMode="decimal" onChange={(e) => setQuota(e.target.value)} helper="Kosongkan untuk tanpa batas" error={error} />
      </form>
    </Dialog>
  );
}

function ResetDialog({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const [password, setPassword] = useState(generatePassword());
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Reset password ${user.username}`}
      width={440}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            Batal
          </Button>
          <Button
            variant="cta-text"
            disabled={busy || password.length < 8}
            onClick={async () => {
              setBusy(true);
              try {
                await apiPost(`/admin/users/${user.id}/reset-password`, { password });
                await copyText(password).catch(() => {});
                toast('Password direset dan disalin — semua sesi user dikeluarkan');
                onClose();
              } catch (err) {
                toast(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            Reset
          </Button>
        </>
      }
    >
      <div className="dv-row">
        <div style={{ flex: 1 }}>
          <PasswordField label="Password baru" value={password} autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} />
        </div>
        <Button onClick={() => setPassword(generatePassword())}>Buat acak</Button>
      </div>
    </Dialog>
  );
}

function DeleteUserDialog({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const qc = useQueryClient();
  const [videos, setVideos] = useState<'transfer' | 'delete'>('transfer');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Hapus ${user.username}?`}
      width={480}
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
                const res = await apiDelete<{ videosAffected: number }>(`/admin/users/${user.id}`, { videos });
                toast(`User dihapus (${res.videosAffected} video ${videos === 'delete' ? 'dihapus' : 'dialihkan'})`);
                void qc.invalidateQueries({ queryKey: ['admin'] });
                onClose();
              } catch (err) {
                toast(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            Hapus user
          </Button>
        </>
      }
    >
      <p className="dv-text-secondary dv-mb-16">
        User ini punya {user.videoCount} video. Playlist & histori milik user ikut terhapus.
      </p>
      <div className="dv-radio-group">
        <label className="dv-radio">
          <input type="radio" checked={videos === 'transfer'} onChange={() => setVideos('transfer')} />
          <span>
            <span className="dv-radio__title">Alihkan video ke channel utama</span>
            <span className="dv-radio__desc">File tetap di Google Drive, tampil atas nama channel utama.</span>
          </span>
        </label>
        <label className="dv-radio">
          <input type="radio" checked={videos === 'delete'} onChange={() => setVideos('delete')} />
          <span>
            <span className="dv-radio__title">Hapus semua videonya</span>
            <span className="dv-radio__desc">File dipindahkan ke Sampah Google Drive.</span>
          </span>
        </label>
      </div>
    </Dialog>
  );
}

/** Studio → Pengguna. */
export function UsersPage() {
  useDocumentTitle('Pengguna - Studio');
  const qc = useQueryClient();
  const me = useSession((s) => s.user);
  const [q, setQ] = useState('');
  const [qd, setQd] = useState('');
  const [editing, setEditing] = useState<AdminUser | 'new' | null>(null);
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState<AdminUser | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setQd(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const users = useQuery({ queryKey: ['admin', 'users', qd], queryFn: () => apiGet<{ items: AdminUser[] }>(`/admin/users${qd ? `?q=${encodeURIComponent(qd)}` : ''}`) });

  const removeAvatar = async (u: AdminUser) => {
    try {
      await apiDelete(`/admin/users/${u.id}/avatar`);
      toast('Foto profil dihapus');
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    } catch (err) {
      toast(errorMessage(err));
    }
  };

  return (
    <div className="dv-studio-page">
      <div className="dv-row dv-row--between">
        <h1 className="dv-studio-page__title">Pengguna</h1>
        <Button variant="primary" icon="add" onClick={() => setEditing('new')}>
          Tambah pengguna
        </Button>
      </div>
      <div className="dv-studio-search dv-mb-16">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari username atau nama" aria-label="Cari pengguna" />
      </div>
      {users.isPending ? (
        <Spinner />
      ) : users.isError ? (
        <div className="dv-banner dv-banner--error">{errorMessage(users.error)}</div>
      ) : users.data.items.length === 0 ? (
        <EmptyState icon="group" title="Tidak ada pengguna" />
      ) : (
        <div className="dv-table-wrap">
          <table className="dv-table">
            <thead>
              <tr>
                <th>Pengguna</th>
                <th>Role</th>
                <th>Status</th>
                <th>Video</th>
                <th>Penyimpanan</th>
                <th>Login terakhir</th>
                <th aria-label="Aksi" />
              </tr>
            </thead>
            <tbody>
              {users.data.items.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="dv-row" style={{ flexWrap: 'nowrap' }}>
                      <Avatar name={u.displayName} color={u.avatarColor} src={u.avatarUrl} size={36} />
                      <div>
                        <div className="dv-table__primary">{u.displayName}</div>
                        <Link className="dv-text-secondary" to={`/@${u.username}`}>
                          @{u.username}
                        </Link>
                      </div>
                    </div>
                  </td>
                  <td>{u.role === 'admin' ? 'Admin' : 'User'}</td>
                  <td>
                    <span className={`dv-pill ${u.status === 'active' ? 'dv-pill--done' : 'dv-pill--failed'}`}>{u.status === 'active' ? 'Aktif' : 'Nonaktif'}</span>
                  </td>
                  <td>{u.videoCount.toLocaleString('id-ID')}</td>
                  <td>
                    {formatBytes(u.storageUsedBytes)}
                    <span className="dv-text-secondary"> / {u.storageQuotaBytes == null ? '∞' : formatBytes(u.storageQuotaBytes)}</span>
                  </td>
                  <td className="dv-text-secondary">{u.lastLoginAt ? formatRelative(u.lastLoginAt) : 'Belum pernah'}</td>
                  <td>
                    <div className="dv-table__actions">
                      <IconButton icon="edit" label="Ubah" size={32} onClick={() => setEditing(u)} />
                      <IconButton icon="key" label="Reset password" size={32} onClick={() => setResetting(u)} />
                      {u.avatarUrl && <IconButton icon="person" label="Hapus foto profil" size={32} onClick={() => void removeAvatar(u)} />}
                      {u.id !== me?.id && <IconButton icon="delete" label="Hapus" size={32} onClick={() => setDeleting(u)} />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <UserDialog user={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {resetting && <ResetDialog user={resetting} onClose={() => setResetting(null)} />}
      {deleting && <DeleteUserDialog user={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}
