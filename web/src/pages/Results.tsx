import { useInfiniteQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { EmptyState } from '../components/ui/misc';
import { InfiniteSentinel } from '../components/video/VideoGrid';
import { ResultItem, ResultItemSkeleton } from '../components/video/VideoCards';
import { useDocumentTitle } from '../hooks/useSite';
import { apiGet, errorMessage } from '../lib/api';
import type { Page, VideoSummary } from '../lib/types';

export function ResultsPage() {
  const [params] = useSearchParams();
  const q = (params.get('search_query') ?? '').trim();
  useDocumentTitle(q || 'Telusuri');
  const res = useInfiniteQuery({
    queryKey: ['search', q],
    queryFn: ({ pageParam, signal }) =>
      apiGet<Page<VideoSummary> & { playlists: unknown[] }>(`/search?${new URLSearchParams({ q, ...(pageParam ? { cursor: pageParam } : {}) })}`, signal),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: q.length > 0,
    staleTime: 60_000,
    meta: { page: true },
  });
  const videos = res.data?.pages.flatMap((p) => p.items) ?? [];
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
      {!res.isPending && !res.isError && videos.length === 0 && (
        <EmptyState icon="search" title="Tidak ada hasil">
          <p>Coba kata kunci lain atau periksa ejaan.</p>
        </EmptyState>
      )}
      <div className="dv-results__list">
        {videos.map((v, i) => (
          <ResultItem key={v.id} video={v} eager={i < 2} />
        ))}
        {(res.isPending || res.isFetchingNextPage) && Array.from({ length: videos.length ? 2 : 6 }, (_, i) => <ResultItemSkeleton key={i} />)}
      </div>
      <InfiniteSentinel onVisible={loadMore} disabled={!res.hasNextPage || res.isFetchingNextPage} />
    </div>
  );
}
