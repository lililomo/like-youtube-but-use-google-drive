import { useInfiniteQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { EmptyState } from '../components/ui/misc';
import { InfiniteSentinel } from '../components/video/VideoGrid';
import { ResultItem, ResultItemSkeleton } from '../components/video/VideoCards';
import { useDocumentTitle } from '../hooks/useSite';
import { apiGet, errorMessage } from '../lib/api';
import type { Page, PlaylistSummary, VideoSummary } from '../lib/types';
import { Link } from 'react-router';
import { Icon } from '../components/icons/Icon';
import { formatVideoCount } from '../lib/format';
import { playlistUrl, playlistWatchUrl } from '../lib/playlistQueries';

export function ResultsPage() {
  const [params] = useSearchParams();
  const q = (params.get('search_query') ?? '').trim();
  useDocumentTitle(q || 'Telusuri');
  const res = useInfiniteQuery({
    queryKey: ['search', q],
    queryFn: ({ pageParam, signal }) =>
      apiGet<Page<VideoSummary> & { playlists: PlaylistSummary[] }>(`/search?${new URLSearchParams({ q, ...(pageParam ? { cursor: pageParam } : {}) })}`, signal),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: q.length > 0,
    staleTime: 60_000,
    meta: { page: true },
  });
  const videos = res.data?.pages.flatMap((p) => p.items) ?? [];
  const playlists = res.data?.pages[0]?.playlists ?? [];
  const loadMore = useCallback(() => void res.fetchNextPage(), [res]);

  if (!q) {
    return (
      <div className="dv-results">
        <EmptyState icon="search" title="Telusuri video">
          <p>Ketik kata kunci di kotak Telusuri.</p>
        </EmptyState>
      </div>
    );
  }
  return (
    <div className="dv-results">
      {res.isError && (
        <EmptyState icon="error" title="Penelusuran gagal">
          <p>{errorMessage(res.error)}</p>
        </EmptyState>
      )}
      {!res.isPending && !res.isError && videos.length === 0 && playlists.length === 0 && (
        <EmptyState icon="search" title="Tidak ada hasil">
          <p>Coba kata kunci lain atau periksa ejaan.</p>
        </EmptyState>
      )}
      <div className="dv-results__list">
        {playlists.map((p) => (
          <PlaylistResult key={p.id} playlist={p} />
        ))}
        {videos.map((v, i) => (
          <ResultItem key={v.id} video={v} eager={i < 2} />
        ))}
        {(res.isPending || res.isFetchingNextPage) && Array.from({ length: videos.length ? 2 : 6 }, (_, i) => <ResultItemSkeleton key={i} />)}
      </div>
      <InfiniteSentinel onVisible={loadMore} disabled={!res.hasNextPage || res.isFetchingNextPage} />
    </div>
  );
}

/** Hasil penelusuran berupa playlist (sampul bertumpuk di kiri). */
function PlaylistResult({ playlist }: { playlist: PlaylistSummary }) {
  const play = playlist.firstVideoId ? playlistWatchUrl(playlist.firstVideoId, playlist.id) : playlistUrl(playlist.id);
  return (
    <div className="dv-result dv-result--playlist">
      <Link to={play} className="dv-result__thumb dv-plcard__thumb" tabIndex={-1} aria-hidden="true">
        <span className="dv-plcard__stack" />
        <span className="dv-plcard__img">
          {playlist.thumb ? <img src={playlist.thumb.sd} alt="" loading="lazy" /> : <Icon name="playlist-play" size={40} />}
          <span className="dv-plcard__badge">
            <Icon name="playlist-play" size={16} /> {formatVideoCount(playlist.itemCount)}
          </span>
        </span>
      </Link>
      <div className="dv-result__body">
        <h3 className="dv-result__title">
          <Link to={playlistUrl(playlist.id)} className="dv-clamp-2">
            {playlist.title}
          </Link>
        </h3>
        <div className="dv-result__stats">{playlist.owner ? `${playlist.owner.name} · Playlist` : 'Playlist'}</div>
        <Link to={playlistUrl(playlist.id)} className="dv-plcard__link">
          Lihat playlist lengkap
        </Link>
      </div>
    </div>
  );
}
