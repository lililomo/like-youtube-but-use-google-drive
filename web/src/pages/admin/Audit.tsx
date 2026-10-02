import { useInfiniteQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { EmptyState, Spinner } from '../../components/ui/misc';
import { InfiniteSentinel } from '../../components/video/VideoGrid';
import { useDocumentTitle } from '../../hooks/useSite';
import { apiGet } from '../../lib/api';
import { formatDateTime } from '../../lib/format';

interface AuditItem {
  id: number;
  userId: number | null;
  username: string | null;
  action: string;
  target: { type: string; id: string | null } | null;
  meta: unknown;
  ip: string | null;
  createdAt: string;
}

const ACTIONS: [string, string][] = [
  ['', 'Semua aksi'],
  ['login', 'Login'],
  ['user.', 'Pengguna'],
  ['video.', 'Video'],
  ['playlist.', 'Playlist'],
  ['settings.', 'Pengaturan'],
  ['drive.', 'Google Drive'],
  ['sync', 'Sinkronisasi'],
  ['subtitle.', 'Subtitle'],
  ['job', 'Antrean'],
];

const LABEL: Record<string, string> = {
  'login.success': 'Login berhasil',
  'login.fail': 'Login gagal',
  'login.disabled': 'Login akun nonaktif',
  logout: 'Keluar',
  'user.create': 'Buat user',
  'user.update': 'Ubah user',
  'user.delete': 'Hapus user',
  'user.reset_password': 'Reset password',
  'user.password_change': 'Ganti password',
  'user.profile_update': 'Ubah profil',
  'user.avatar_update': 'Ganti foto profil',
  'user.avatar_remove': 'Hapus foto profil',
  'video.upload': 'Upload video',
  'video.update': 'Ubah video',
  'video.delete': 'Hapus video',
  'video.bulk': 'Aksi massal video',
  'video.reprocess': 'Proses ulang video',
  'settings.update': 'Ubah pengaturan',
  'settings.branding': 'Ubah logo/favicon',
  'playlist.create': 'Buat playlist',
  'playlist.update': 'Ubah playlist',
  'playlist.delete': 'Hapus playlist',
  'playlist.import_guest': 'Impor playlist tamu',
};

function metaText(meta: unknown): string {
  if (!meta || typeof meta !== 'object') return '';
  return Object.entries(meta as Record<string, unknown>)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ')
    .slice(0, 240);
}

/** Studio → Log Aktivitas. */
export function AuditPage() {
  useDocumentTitle('Log Aktivitas - Studio');
  const [action, setAction] = useState('');
  const list = useInfiniteQuery({
    queryKey: ['admin', 'audit', action],
    queryFn: ({ pageParam, signal }) =>
      apiGet<{ items: AuditItem[]; nextCursor: string | null }>(`/admin/audit?${new URLSearchParams({ ...(action ? { action } : {}), ...(pageParam ? { cursor: pageParam } : {}) })}`, signal),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const loadMore = useCallback(() => void list.fetchNextPage(), [list]);
  return (
    <div className="dv-studio-page dv-studio-page--wide">
      <h1 className="dv-studio-page__title">Log Aktivitas</h1>
      <div className="dv-row dv-mb-16">
        <select className="dv-select" style={{ width: 220 }} value={action} onChange={(e) => setAction(e.target.value)} aria-label="Filter aksi">
          {ACTIONS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>
      {list.isPending ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState icon="description" title="Belum ada aktivitas" />
      ) : (
        <div className="dv-table-wrap">
          <table className="dv-table">
            <thead>
              <tr>
                <th>Waktu</th>
                <th>Pengguna</th>
                <th>Aksi</th>
                <th>Target</th>
                <th>Detail</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id}>
                  <td className="dv-studio-table__num">{formatDateTime(a.createdAt)}</td>
                  <td>{a.username ? `@${a.username}` : <span className="dv-text-secondary">—</span>}</td>
                  <td>{LABEL[a.action] ?? a.action}</td>
                  <td className="dv-text-secondary">{a.target ? `${a.target.type}${a.target.id ? ` ${a.target.id}` : ''}` : '—'}</td>
                  <td className="dv-text-secondary dv-audit__meta">{metaText(a.meta)}</td>
                  <td className="dv-text-secondary">{a.ip ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <InfiniteSentinel onVisible={loadMore} disabled={!list.hasNextPage || list.isFetchingNextPage} />
    </div>
  );
}
