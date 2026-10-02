import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Icon } from '../components/icons/Icon';
import { ButtonLink } from '../components/ui/Button';
import { Avatar, EmptyState } from '../components/ui/misc';
import { Thumbnail } from '../components/video/Thumbnail';
import { useDocumentTitle } from '../hooks/useSite';
import { apiGet } from '../lib/api';
import type { Page } from '../lib/types';
import { watchUrl } from '../lib/videoQueries';
import { useSession } from '../stores/session';
import { useWatch } from '../stores/watch';
import type { HistoryVideo } from './History';

/** Kartu kecil di rak horizontal (lebar 210px seperti halaman "Anda" YouTube). */
function ShelfCard({ video }: { video: HistoryVideo }) {
  return (
    <Link to={watchUrl(video.id)} className="dv-shelf__card">
      <Thumbnail video={video} sizes="210px" />
      <span className="dv-shelf__title dv-clamp-2">{video.title}</span>
      <span className="dv-shelf__meta">{video.channel.name}</span>
    </Link>
  );
}

function Shelf({ title, to, children }: { title: string; to: string; children: React.ReactNode }) {
  return (
    <section className="dv-shelf">
      <div className="dv-shelf__head">
        <h2 className="dv-shelf__heading">{title}</h2>
        <ButtonLink to={to} variant="cta-outline">
          Lihat semua
        </ButtonLink>
      </div>
      <div className="dv-shelf__row">{children}</div>
    </section>
  );
}

/** Halaman "Anda" (/feed/you): ringkasan histori, playlist, dan video milik user. */
export function YouPage() {
  useDocumentTitle('Anda');
  const user = useSession((s) => s.user);
  const guestHistory = useWatch((s) => s.guestHistory);
  const history = useQuery({
    queryKey: ['history', 'shelf'],
    queryFn: ({ signal }) => apiGet<Page<HistoryVideo>>('/history', signal),
    enabled: Boolean(user),
    staleTime: 0,
  });
  const recent = (user ? (history.data?.items ?? []) : (guestHistory as HistoryVideo[])).slice(0, 12);

  return (
    <div className="dv-you">
      {user ? (
        <div className="dv-you__header">
          <Avatar name={user.displayName} color={user.avatarColor} src={user.avatarUrl} size={120} />
          <div>
            <h1 className="dv-you__name">{user.displayName}</h1>
            <div className="dv-you__handle">
              @{user.username} · <Link to={`/@${user.username}`}>Lihat channel</Link>
            </div>
            <div className="dv-row dv-mt-12">
              <ButtonLink to="/account" icon="settings">
                Kelola akun
              </ButtonLink>
            </div>
          </div>
        </div>
      ) : (
        <div className="dv-you__guest">
          <Icon name="account-circle" size={96} />
          <h1>Nikmati video favorit Anda</h1>
          <p className="dv-text-secondary">Login untuk menyimpan histori tontonan dan playlist ke akun Anda.</p>
          <ButtonLink to="/login?next=/feed/you" variant="cta-outline" icon="account-circle">
            Login
          </ButtonLink>
        </div>
      )}

      <Shelf title="Histori" to="/feed/history">
        {recent.length ? (
          recent.map((v) => <ShelfCard key={v.id} video={v} />)
        ) : (
          <p className="dv-text-secondary">Video yang Anda tonton akan muncul di sini.</p>
        )}
      </Shelf>

      <div id="dv-you-playlists" />

      {user && (
        <section className="dv-shelf">
          <div className="dv-shelf__head">
            <h2 className="dv-shelf__heading">Video Anda</h2>
            <ButtonLink to="/my/videos" variant="cta-outline">
              Kelola video
            </ButtonLink>
          </div>
        </section>
      )}
      {!user && recent.length === 0 && (
        <EmptyState icon="library" title="Belum ada aktivitas">
          <p>Mulai menonton video dari beranda.</p>
        </EmptyState>
      )}
    </div>
  );
}
