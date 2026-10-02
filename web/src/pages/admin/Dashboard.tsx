import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Icon } from '../../components/icons/Icon';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/misc';
import { Thumbnail } from '../../components/video/Thumbnail';
import { useDocumentTitle } from '../../hooks/useSite';
import { apiGet, apiPost, errorMessage } from '../../lib/api';
import { formatBytes, formatRelative, formatViews } from '../../lib/format';
import type { VideoSummary } from '../../lib/types';
import { watchUrl } from '../../lib/videoQueries';
import { toast } from '../../stores/toast';

interface Stats {
  videos: { total: number; public: number; private: number; processing: number; failed: number; missing: number; totalBytes: number };
  users: { total: number; active: number };
  playlists: { total: number; public: number; guest: number };
  drive: {
    configured: boolean;
    connectedEmail: string | null;
    folder: { id: string; name: string | null } | null;
    lastSyncAt: string | null;
    lastFullSyncAt: string | null;
    lastSyncError: string | null;
    syncing: string | null;
  };
  queue: { queued: number; running: number; failed: number; active: { id: number; type: string; progress: number; video: { id: string; title: string | null } | null }[] };
  topVideos: VideoSummary[];
  recentUploads: (VideoSummary & { status: string })[];
}

interface SystemInfo {
  appVersion: string;
  node: string;
  ffmpeg: string;
  uptimeSec: number;
  memory: { rss: number; heapUsed: number };
  disk: { free: number; total: number } | null;
  minFreeDiskGb: number;
}

const JOB_LABEL: Record<string, string> = { probe: 'Analisis', thumbnail: 'Thumbnail', media: 'Konversi', delete_assets: 'Hapus aset' };

function Metric({ label, value, sub, to }: { label: string; value: string | number; sub?: string; to?: string }) {
  const body = (
    <>
      <div className="dv-stat__value">{typeof value === 'number' ? value.toLocaleString('id-ID') : value}</div>
      <div className="dv-stat__label">{label}</div>
      {sub && <div className="dv-stat__sub">{sub}</div>}
    </>
  );
  return to ? (
    <Link to={to} className="dv-stat dv-stat--link">
      {body}
    </Link>
  ) : (
    <div className="dv-stat">{body}</div>
  );
}

function uptimeText(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d ? `${d} hari ${h} jam` : h ? `${h} jam ${m} mnt` : `${m} mnt`;
}

/** Dasbor Studio: metrik, status Drive & sinkronisasi, antrean, disk, video teratas, upload terbaru. */
export function DashboardPage() {
  useDocumentTitle('Dasbor - Studio');
  const qc = useQueryClient();
  const stats = useQuery({ queryKey: ['admin', 'stats'], queryFn: () => apiGet<Stats>('/admin/stats'), refetchInterval: 10_000 });
  const sys = useQuery({ queryKey: ['admin', 'system'], queryFn: () => apiGet<SystemInfo>('/admin/system'), refetchInterval: 60_000 });
  const sync = useMutation({
    mutationFn: () => apiPost('/admin/sync/run', { mode: 'incremental' }),
    onSuccess: () => {
      toast('Sinkronisasi dimulai');
      setTimeout(() => void qc.invalidateQueries({ queryKey: ['admin', 'stats'] }), 1500);
    },
    onError: (e) => toast(errorMessage(e)),
  });

  if (stats.isPending) {
    return (
      <div className="dv-studio-page">
        <Spinner />
      </div>
    );
  }
  if (stats.isError) {
    return (
      <div className="dv-studio-page">
        <div className="dv-banner dv-banner--error">{errorMessage(stats.error)}</div>
      </div>
    );
  }
  const s = stats.data;
  const disk = sys.data?.disk;
  const diskLow = disk && sys.data ? disk.free < sys.data.minFreeDiskGb * 1024 ** 3 : false;
  const driveOk = s.drive.configured && Boolean(s.drive.folder) && !s.drive.lastSyncError;

  return (
    <div className="dv-studio-page dv-dashboard">
      <h1 className="dv-studio-page__title">Dasbor</h1>
      <div className="dv-stat-row">
        <Metric label="Video" value={s.videos.total} sub={`${s.videos.public} publik · ${s.videos.private} privat`} to="/admin/videos" />
        <Metric label="Diproses" value={s.videos.processing} sub={s.videos.failed ? `${s.videos.failed} gagal` : 'tidak ada yang gagal'} to="/admin/videos?status=processing" />
        <Metric label="Total ukuran" value={formatBytes(s.videos.totalBytes)} sub="di Google Drive" />
        <Metric label="Pengguna" value={s.users.total} sub={`${s.users.active} aktif`} to="/admin/users" />
        <Metric label="Playlist" value={s.playlists.total} sub={`${s.playlists.public} publik · ${s.playlists.guest} tamu`} to="/admin/playlists" />
      </div>

      <div className="dv-dashboard__grid">
        <section className="dv-studio-card">
          <h2 className="dv-studio-card__title">Google Drive</h2>
          <div className="dv-row">
            <span className={`dv-status-dot ${driveOk ? 'dv-status-dot--ok' : 'dv-status-dot--bad'}`} />
            <span>{s.drive.configured ? (s.drive.connectedEmail ?? 'Terhubung') : 'Belum terhubung'}</span>
          </div>
          <p className="dv-text-secondary dv-mt-8">Folder: {s.drive.folder ? (s.drive.folder.name ?? s.drive.folder.id) : 'belum diatur'}</p>
          <p className="dv-text-secondary">
            Sinkron terakhir: {s.drive.lastSyncAt ? formatRelative(s.drive.lastSyncAt) : '—'}
            {s.drive.syncing && ' · sedang berjalan…'}
          </p>
          {s.drive.lastSyncError && <div className="dv-banner dv-banner--error dv-mt-8">{s.drive.lastSyncError}</div>}
          <div className="dv-row dv-mt-12">
            <Button variant="primary" icon="sync" disabled={sync.isPending || Boolean(s.drive.syncing) || !s.drive.folder} onClick={() => sync.mutate()}>
              Sinkronkan sekarang
            </Button>
            {!driveOk && (
              <ButtonLink to="/admin/settings/drive" icon="settings">
                Perbaiki
              </ButtonLink>
            )}
          </div>
        </section>

        <section className="dv-studio-card">
          <h2 className="dv-studio-card__title">Antrean pemrosesan</h2>
          <p className="dv-text-secondary">
            {s.queue.running} berjalan · {s.queue.queued} menunggu · {s.queue.failed} gagal
          </p>
          {s.queue.active.map((j) => (
            <div key={j.id} className="dv-dashboard__job">
              <div className="dv-row dv-row--between">
                <span>
                  {JOB_LABEL[j.type] ?? j.type}
                  {j.video && (
                    <>
                      {' · '}
                      <Link className="dv-link" to={watchUrl(j.video.id)}>
                        {j.video.title ?? j.video.id}
                      </Link>
                    </>
                  )}
                </span>
                <span>{Math.round(j.progress)}%</span>
              </div>
              <div className="dv-progress">
                <div className="dv-progress__bar" style={{ width: `${j.progress}%` }} />
              </div>
            </div>
          ))}
          <div className="dv-mt-12">
            <ButtonLink to="/admin/jobs" icon="list">
              Lihat antrean
            </ButtonLink>
          </div>
        </section>

        <section className="dv-studio-card">
          <h2 className="dv-studio-card__title">Server</h2>
          {sys.data ? (
            <>
              {disk && (
                <>
                  <div className="dv-row dv-row--between">
                    <span>Disk tersisa</span>
                    <b className={diskLow ? 'dv-text-error' : undefined}>
                      {formatBytes(disk.free)} / {formatBytes(disk.total)}
                    </b>
                  </div>
                  <div className="dv-progress">
                    <div className="dv-progress__bar" style={{ width: `${((disk.total - disk.free) / disk.total) * 100}%` }} />
                  </div>
                  {diskLow && (
                    <p className="dv-text-error dv-mt-8">
                      <Icon name="warning" size={16} /> Di bawah batas minimal {sys.data.minFreeDiskGb} GB — konversi ditunda.
                    </p>
                  )}
                </>
              )}
              <p className="dv-text-secondary dv-mt-8">
                Aplikasi v{sys.data.appVersion} · Node {sys.data.node} · ffmpeg {sys.data.ffmpeg}
              </p>
              <p className="dv-text-secondary">
                Memori {formatBytes(sys.data.memory.rss)} · aktif {uptimeText(sys.data.uptimeSec)}
              </p>
            </>
          ) : (
            <Spinner size={24} />
          )}
        </section>
      </div>

      <div className="dv-dashboard__grid dv-dashboard__grid--2">
        <section className="dv-studio-card">
          <h2 className="dv-studio-card__title">Video teratas</h2>
          {s.topVideos.length === 0 && <p className="dv-text-secondary">Belum ada video.</p>}
          {s.topVideos.map((v, i) => (
            <Link key={v.id} to={watchUrl(v.id)} className="dv-dashboard__vid">
              <span className="dv-dashboard__rank">{i + 1}</span>
              <span className="dv-dashboard__thumb">
                <Thumbnail video={v} sizes="96px" />
              </span>
              <span className="dv-dashboard__vtitle dv-clamp-2">{v.title}</span>
              <span className="dv-text-secondary">{formatViews(v.views)}</span>
            </Link>
          ))}
        </section>
        <section className="dv-studio-card">
          <h2 className="dv-studio-card__title">Upload terbaru</h2>
          {s.recentUploads.length === 0 && <p className="dv-text-secondary">Belum ada upload dari pengguna.</p>}
          {s.recentUploads.map((v) => (
            <Link key={v.id} to={watchUrl(v.id)} className="dv-dashboard__vid">
              <span className="dv-dashboard__thumb">
                <Thumbnail video={v} sizes="96px" />
              </span>
              <span className="dv-dashboard__vtitle dv-clamp-2">{v.title}</span>
              <span className="dv-text-secondary">
                {v.channel.name} · {formatRelative(v.publishedAt)}
              </span>
            </Link>
          ))}
        </section>
      </div>
    </div>
  );
}
