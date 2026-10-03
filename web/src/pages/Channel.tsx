import { useInfiniteQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useParams } from 'react-router';
import { ApiError, apiGet } from '../lib/api';
import { formatVideoCount } from '../lib/format';
import type { Channel, Page, VideoSummary } from '../lib/types';
import { useDocumentTitle } from '../hooks/useSite';
import { ButtonLink } from '../components/ui/Button';
import { Avatar, EmptyState, Skeleton } from '../components/ui/misc';
import { ChipBar } from '../components/video/ChipBar';
import { InfiniteSentinel, VideoGrid } from '../components/video/VideoGrid';
import { NotFoundPage } from './NotFound';
import { PlaylistGrid } from '../components/playlist/PlaylistCard';
import type { PlaylistSummary } from '../lib/types';

type ChannelPage = Page<VideoSummary> & { channel: Channel & { videoCount: number; joinedAt: string | null; isMain: boolean; isOwner?: boolean } };

/** Rute "/:handle" — hanya valid bila diawali "@" (contoh /@gdrivetube). */
export function ChannelPage() {
  const { handle = '' } = useParams();
  const valid = handle.startsWith('@') && handle.length > 1;
  const name = handle.slice(1);
  const [tab, setTab] = useState<'videos' | 'playlists'>('videos');
  const [sort, setSort] = useState<'latest' | 'popular'>('latest');
  const q = useInfiniteQuery({
    queryKey: ['channel', name, tab, sort],
    queryFn: ({ pageParam, signal }) =>
      apiGet<ChannelPage>(`/channels/${encodeURIComponent(name)}?${new URLSearchParams({ tab, sort, ...(pageParam ? { cursor: pageParam } : {}) })}`, signal),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: valid,
    meta: { page: true },
  });
  const channel = q.data?.pages[0]?.channel;
  useDocumentTitle(channel?.name ?? (valid ? handle : null));
  const loadMore = useCallback(() => void q.fetchNextPage(), [q]);

  if (!valid || (q.error instanceof ApiError && q.error.status === 404)) return <NotFoundPage />;
  const videos = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="dv-channel">
      <header className="dv-channel__header">
        {channel ? (
          <Avatar name={channel.name} color={channel.avatarColor} src={channel.avatarUrl} size={160} />
        ) : (
          <Skeleton width={160} height={160} radius="50%" />
        )}
        <div className="dv-channel__info">
          <h1 className="dv-channel__name">{channel?.name ?? <Skeleton width={240} height={40} />}</h1>
          {channel && (
            <div className="dv-channel__sub">
              <b>@{channel.handle}</b>
              <span className="dv-dot">•</span>
              {formatVideoCount(channel.videoCount)}
            </div>
          )}
          {channel?.isOwner && (
            <div className="dv-channel__owner">
              <ButtonLink to="/my/videos">Kelola video</ButtonLink>
              <span className="dv-text-secondary">Video privat Anda ikut tampil di sini, hanya untuk Anda.</span>
            </div>
          )}
        </div>
      </header>
      <div className="dv-tabs" role="tablist">
        {(['videos', 'playlists'] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`dv-tab${tab === k ? ' is-active' : ''}`} onClick={() => setTab(k)}>
            {k === 'videos' ? 'Video' : 'Playlist'}
          </button>
        ))}
      </div>
      {tab === 'videos' ? (
        <>
          <ChipBar
            sticky={false}
            chips={[
              { id: 'latest', label: 'Terbaru' },
              { id: 'popular', label: 'Populer' },
            ]}
            selected={sort}
            onSelect={(id) => setSort(id as 'latest' | 'popular')}
          />
          {!q.isPending && videos.length === 0 ? (
            <EmptyState icon="your-videos" title="Channel ini belum memiliki video" />
          ) : (
            <VideoGrid videos={videos} loading={q.isPending || q.isFetchingNextPage} />
          )}
          <InfiniteSentinel onVisible={loadMore} disabled={!q.hasNextPage || q.isFetchingNextPage} />
        </>
      ) : !q.isPending && videos.length === 0 ? (
        <EmptyState icon="playlist-play" title="Belum ada playlist publik" />
      ) : (
        <>
          <PlaylistGrid playlists={videos as unknown as PlaylistSummary[]} loading={q.isPending || q.isFetchingNextPage} />
          <InfiniteSentinel onVisible={loadMore} disabled={!q.hasNextPage || q.isFetchingNextPage} />
        </>
      )}
    </div>
  );
}
