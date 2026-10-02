import { Link } from 'react-router';
import { formatRelative, formatVideoCount } from '../../lib/format';
import { playlistUrl, playlistWatchUrl } from '../../lib/playlistQueries';
import type { PlaylistSummary } from '../../lib/types';
import { Icon } from '../icons/Icon';
import { Skeleton } from '../ui/misc';

/** Kartu playlist ala YouTube: sampul bertumpuk + badge jumlah video. */
export function PlaylistCard({ playlist }: { playlist: PlaylistSummary }) {
  const playHref = playlist.firstVideoId ? playlistWatchUrl(playlist.firstVideoId, playlist.id) : playlistUrl(playlist.id);
  return (
    <div className="dv-plcard">
      <Link to={playHref} className="dv-plcard__thumb" aria-label={`Putar semua: ${playlist.title}`}>
        <span className="dv-plcard__stack" aria-hidden="true" />
        <span className="dv-plcard__img">
          {playlist.thumb ? <img src={playlist.thumb.sd} alt="" loading="lazy" decoding="async" /> : <Icon name="playlist-play" size={40} />}
          <span className="dv-plcard__badge">
            <Icon name="playlist-play" size={16} /> {formatVideoCount(playlist.itemCount)}
          </span>
          <span className="dv-plcard__hover">
            <Icon name="play-arrow" /> Putar semua
          </span>
        </span>
      </Link>
      <div className="dv-plcard__meta">
        <h3 className="dv-plcard__title">
          <Link to={playlistUrl(playlist.id)} className="dv-clamp-2" title={playlist.title}>
            {playlist.title}
          </Link>
        </h3>
        <div className="dv-plcard__sub">
          {playlist.owner ? <Link to={`/@${playlist.owner.handle}`}>{playlist.owner.name}</Link> : playlist.isGuest ? 'Perangkat ini' : null}
          {playlist.visibility === 'private' && (
            <span className="dv-private-tag">
              <Icon name="lock" size={14} /> Privat
            </span>
          )}
        </div>
        <Link to={playlistUrl(playlist.id)} className="dv-plcard__link">
          Lihat playlist lengkap
        </Link>
        <div className="dv-plcard__updated">Diperbarui {formatRelative(playlist.updatedAt)}</div>
      </div>
    </div>
  );
}

export function PlaylistCardSkeleton() {
  return (
    <div className="dv-plcard" aria-hidden="true">
      <Skeleton className="dv-plcard__skel" radius={12} />
      <Skeleton height={20} width="80%" className="dv-mt-12" />
      <Skeleton height={16} width="40%" className="dv-mt-8" />
    </div>
  );
}

export function PlaylistGrid({ playlists, loading, skeletons = 8 }: { playlists: PlaylistSummary[]; loading?: boolean; skeletons?: number }) {
  return (
    <div className="dv-plgrid">
      {playlists.map((p) => (
        <PlaylistCard key={p.id} playlist={p} />
      ))}
      {loading && Array.from({ length: skeletons }, (_, i) => <PlaylistCardSkeleton key={`s${i}`} />)}
    </div>
  );
}
