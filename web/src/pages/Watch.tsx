import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Icon } from '../components/icons/Icon';
import { Button } from '../components/ui/Button';
import { Avatar, Skeleton } from '../components/ui/misc';
import { CompactSkeleton, CompactVideo } from '../components/video/VideoCards';
import { InfiniteSentinel } from '../components/video/VideoGrid';
import { shareVideo } from '../components/video/VideoMenu';
import { useDocumentTitle } from '../hooks/useSite';
import { ApiError, apiGet, apiPost } from '../lib/api';
import { formatRelative, formatViews } from '../lib/format';
import { storage } from '../lib/storage';
import type { Page, VideoDetail, VideoSummary } from '../lib/types';
import { fetchVideo, videoKey, watchUrl } from '../lib/videoQueries';
import type { Player } from '../player/Player';
import { PlayerView } from '../player/PlayerView';

const isVideoId = (s: string) => /^[A-Za-z0-9_-]{11}$/.test(s);

/** "90", "1m30s", "1h2m3s" → detik. */
export function parseT(raw: string | null): number | undefined {
  if (!raw) return undefined;
  if (/^\d+$/.test(raw)) return Number(raw);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(raw);
  if (!m || (!m[1] && !m[2] && !m[3])) return undefined;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

function Unavailable({ message }: { message: string }) {
  return (
    <div className="dv-watch__unavailable">
      <Icon name="video-off" size={64} />
      <h2>Video tidak tersedia</h2>
      <p>{message}</p>
    </div>
  );
}

export function WatchPage() {
  const [params] = useSearchParams();
  const id = params.get('v') ?? '';
  const startAt = parseT(params.get('t'));
  const navigate = useNavigate();
  const valid = isVideoId(id);
  const [theater, setTheater] = useState<boolean>(() => storage.get('dv.theater', false));
  const playerRef = useRef<Player | null>(null);

  const detail = useQuery({
    queryKey: videoKey(id),
    queryFn: ({ signal }) => fetchVideo(id, signal),
    enabled: valid,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
    retry: (n, err) => !(err instanceof ApiError && err.status === 404) && n < 1,
    meta: { page: true },
  });
  const video: VideoDetail | undefined = detail.data && detail.data.id === id ? detail.data : undefined;
  const shown = detail.data;

  const related = useInfiniteQuery({
    queryKey: ['related', id],
    queryFn: ({ pageParam, signal }) => apiGet<Page<VideoSummary>>(`/videos/${id}/related${pageParam ? `?cursor=${pageParam}` : ''}`, signal),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: valid && Boolean(video),
    staleTime: 5 * 60_000,
  });
  const relatedItems = related.data?.pages.flatMap((p) => p.items) ?? [];
  const next = relatedItems[0];
  const nextRef = useRef(next);
  nextRef.current = next;

  useDocumentTitle(video?.title ?? null);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [id]);

  const goNext = useCallback(() => {
    const n = nextRef.current;
    if (n) navigate(watchUrl(n.id));
  }, [navigate]);

  const onTheater = useCallback((on: boolean) => {
    setTheater(on);
    storage.set('dv.theater', on);
  }, []);

  const onEnded = useCallback(() => {
    if (playerRef.current?.autoplay) goNext();
  }, [goNext]);

  const onViewQualified = useCallback(() => {
    void apiPost(`/videos/${id}/view`).catch(() => {});
  }, [id]);

  const loadMore = useCallback(() => void related.fetchNextPage(), [related]);

  const notFound = !valid || (detail.error instanceof ApiError && detail.error.status === 404);

  return (
    <div className={`dv-watch${theater ? ' is-theater' : ''}`}>
      <div className="dv-watch__player-wrap">
        <div className="dv-watch__player">
          {notFound ? (
            <Unavailable message="Video ini tidak tersedia, sudah dihapus, atau bersifat privat." />
          ) : shown ? (
            <PlayerView
              detail={shown}
              startAt={video ? (startAt ?? undefined) : undefined}
              hasNext={Boolean(next)}
              theater={theater}
              onTheater={onTheater}
              onNext={goNext}
              onEnded={onEnded}
              onViewQualified={onViewQualified}
              playerRef={playerRef}
            />
          ) : null}
        </div>
      </div>

      <div className="dv-watch__primary">
        {video ? (
          <>
            <h1 className="dv-watch__title dv-clamp-2">{video.title}</h1>
            <div className="dv-watch__owner-row">
              <div className="dv-watch__owner">
                <Link to={`/@${video.channel.handle}`} className="dv-watch__avatar" aria-label={video.channel.name}>
                  <Avatar name={video.channel.name} color={video.channel.avatarColor} src={video.channel.avatarUrl} size={40} />
                </Link>
                <div className="dv-watch__owner-text">
                  <Link to={`/@${video.channel.handle}`} className="dv-watch__channel">
                    {video.channel.name}
                  </Link>
                  <div className="dv-watch__stats">
                    {formatViews(video.views)} <span className="dv-dot">•</span> {formatRelative(video.publishedAt)}
                    {video.visibility === 'private' && (
                      <span className="dv-private-tag">
                        <Icon name="lock" size={14} /> Privat
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="dv-watch__actions">
                <Button variant="tonal" icon="share" onClick={() => void shareVideo(video)}>
                  Bagikan
                </Button>
              </div>
            </div>
            {video.processing && (
              <div className="dv-banner dv-banner--info" style={{ marginTop: 12 }}>
                <Icon name="sync" /> Video ini masih diproses. Kualitas lain akan tersedia setelah selesai.
              </div>
            )}
          </>
        ) : notFound ? null : (
          <div aria-hidden="true">
            <Skeleton height={28} width="70%" className="dv-mt-12" />
            <div className="dv-watch__owner-row">
              <div className="dv-watch__owner">
                <Skeleton width={40} height={40} radius="50%" />
                <Skeleton width={160} height={20} />
              </div>
            </div>
          </div>
        )}
      </div>

      <aside className="dv-watch__secondary" aria-label="Video berikutnya">
        {relatedItems.map((v) => (
          <CompactVideo key={v.id} video={v} />
        ))}
        {(related.isPending || related.isFetchingNextPage) && !notFound && Array.from({ length: 8 }, (_, i) => <CompactSkeleton key={i} />)}
        <InfiniteSentinel onVisible={loadMore} disabled={!related.hasNextPage || related.isFetchingNextPage} />
      </aside>
    </div>
  );
}
