import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { formatRelative, formatViews } from '../../lib/format';
import type { VideoSummary } from '../../lib/types';
import { cancelPrefetch, prefetchVideo, watchUrl } from '../../lib/videoQueries';
import { useRecommend } from '../../stores/recommend';
import { Icon } from '../icons/Icon';
import { Avatar, Skeleton } from '../ui/misc';
import { Thumbnail } from './Thumbnail';
import { VideoMenu } from './VideoMenu';

function usePrefetch(id: string) {
  const qc = useQueryClient();
  return { onMouseEnter: () => prefetchVideo(qc, id), onMouseLeave: () => cancelPrefetch(id), onFocus: () => prefetchVideo(qc, id) };
}

function Meta({ video }: { video: VideoSummary }) {
  return (
    <>
      {formatViews(video.views)}
      <span className="dv-dot" aria-hidden="true">
        •
      </span>
      {formatRelative(video.publishedAt)}
      {video.visibility === 'private' && (
        <span className="dv-private-tag" title="Privat">
          <Icon name="lock" size={14} /> Privat
        </span>
      )}
    </>
  );
}

/** Pengganti kartu setelah "Tidak tertarik" (seperti YouTube): pesan + URUNGKAN. */
function Dismissed({ id, compact = false }: { id: string; compact?: boolean }) {
  const undo = useRecommend((s) => s.undo);
  return (
    <div className={`dv-dismissed${compact ? ' dv-dismissed--compact' : ''}`}>
      <p className="dv-dismissed__text">Video dihapus dari rekomendasi. Kami akan menyesuaikan saran untuk Anda.</p>
      <button type="button" className="dv-btn dv-btn--text dv-btn--sm" onClick={() => void undo(id)}>
        Urungkan
      </button>
    </div>
  );
}

/** Kartu grid beranda (thumbnail 16:9 radius 12px + avatar + judul 2 baris). */
export function VideoCard({ video, eager = false, dismissible = false }: { video: VideoSummary; eager?: boolean; dismissible?: boolean }) {
  const prefetch = usePrefetch(video.id);
  const dismissed = useRecommend((s) => dismissible && s.dismissed.has(video.id));
  const href = watchUrl(video.id);
  if (dismissed) return <Dismissed id={video.id} />;
  return (
    <div className="dv-vcard">
      <Link to={href} className="dv-vcard__thumb" tabIndex={-1} aria-hidden="true" {...prefetch}>
        <Thumbnail video={video} eager={eager} sizes="(max-width: 656px) 100vw, (max-width: 1100px) 50vw, 400px" />
      </Link>
      <div className="dv-vcard__details">
        <Link to={`/@${video.channel.handle}`} className="dv-vcard__avatar" aria-label={video.channel.name}>
          <Avatar name={video.channel.name} color={video.channel.avatarColor} src={video.channel.avatarUrl} size={36} />
        </Link>
        <div className="dv-vcard__meta">
          <h3 className="dv-vcard__title">
            <Link to={href} className="dv-clamp-2" title={video.title} {...prefetch}>
              {video.title}
            </Link>
          </h3>
          <Link to={`/@${video.channel.handle}`} className="dv-vcard__channel">
            {video.channel.name}
          </Link>
          <div className="dv-vcard__stats">
            <Meta video={video} />
          </div>
        </div>
        <div className="dv-vcard__menu">
          <VideoMenu video={video} dismissible={dismissible} />
        </div>
      </div>
    </div>
  );
}

export function VideoCardSkeleton() {
  return (
    <div className="dv-vcard" aria-hidden="true">
      <Skeleton className="dv-vcard__skel-thumb" radius={12} />
      <div className="dv-vcard__details">
        <Skeleton width={36} height={36} radius="50%" />
        <div className="dv-vcard__meta" style={{ flex: 1 }}>
          <Skeleton height={20} width="90%" />
          <Skeleton height={20} width="60%" className="dv-mt-8" />
        </div>
      </div>
    </div>
  );
}

/** Item hasil penelusuran (thumbnail besar di kiri). */
export function ResultItem({ video, eager = false }: { video: VideoSummary; eager?: boolean }) {
  const prefetch = usePrefetch(video.id);
  const href = watchUrl(video.id);
  return (
    <div className="dv-result">
      <Link to={href} className="dv-result__thumb" tabIndex={-1} aria-hidden="true" {...prefetch}>
        <Thumbnail video={video} eager={eager} sizes="(max-width: 656px) 100vw, 500px" />
      </Link>
      <div className="dv-result__body">
        <div className="dv-result__head">
          <h3 className="dv-result__title">
            <Link to={href} className="dv-clamp-2" title={video.title} {...prefetch}>
              {video.title}
            </Link>
          </h3>
          <div className="dv-result__menu">
            <VideoMenu video={video} />
          </div>
        </div>
        <div className="dv-result__stats">
          <Meta video={video} />
        </div>
        <Link to={`/@${video.channel.handle}`} className="dv-result__channel">
          <Avatar name={video.channel.name} color={video.channel.avatarColor} src={video.channel.avatarUrl} size={24} />
          <span>{video.channel.name}</span>
        </Link>
      </div>
    </div>
  );
}

export function ResultItemSkeleton() {
  return (
    <div className="dv-result" aria-hidden="true">
      <Skeleton className="dv-result__skel-thumb" radius={12} />
      <div className="dv-result__body">
        <Skeleton height={24} width="80%" />
        <Skeleton height={16} width="40%" className="dv-mt-8" />
        <Skeleton height={24} width="30%" className="dv-mt-12" />
      </div>
    </div>
  );
}

/** Item ringkas (rekomendasi di halaman tonton). */
export function CompactVideo({
  video,
  active = false,
  index,
  onClick,
  dismissible = false,
}: {
  video: VideoSummary;
  active?: boolean;
  index?: number;
  onClick?: () => void;
  dismissible?: boolean;
}) {
  const prefetch = usePrefetch(video.id);
  const dismissed = useRecommend((s) => dismissible && s.dismissed.has(video.id));
  if (dismissed) return <Dismissed id={video.id} compact />;
  return (
    <div className={`dv-compact${active ? ' is-active' : ''}`}>
      {index !== undefined && <span className="dv-compact__index">{active ? <Icon name="play-arrow" size={16} /> : index}</span>}
      <Link to={watchUrl(video.id)} className="dv-compact__link" onClick={onClick} {...prefetch}>
        <div className="dv-compact__thumb">
          <Thumbnail video={video} sizes="168px" />
        </div>
        <div className="dv-compact__meta">
          <h3 className="dv-compact__title dv-clamp-2" title={video.title}>
            {video.title}
          </h3>
          <div className="dv-compact__channel">{video.channel.name}</div>
          <div className="dv-compact__stats">
            <Meta video={video} />
          </div>
        </div>
      </Link>
      <div className="dv-compact__menu">
        <VideoMenu video={video} dismissible={dismissible} />
      </div>
    </div>
  );
}

export function CompactSkeleton() {
  return (
    <div className="dv-compact" aria-hidden="true">
      <div className="dv-compact__link">
        <Skeleton className="dv-compact__thumb" radius={8} />
        <div className="dv-compact__meta" style={{ flex: 1 }}>
          <Skeleton height={18} width="90%" />
          <Skeleton height={14} width="50%" className="dv-mt-8" />
        </div>
      </div>
    </div>
  );
}
