import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { ChipBar } from '../components/video/ChipBar';
import { InfiniteSentinel, VideoGrid } from '../components/video/VideoGrid';
import { EmptyState } from '../components/ui/misc';
import { Button } from '../components/ui/Button';
import { useDocumentTitle } from '../hooks/useSite';
import { t } from '../i18n/id';
import { apiGet, errorMessage } from '../lib/api';
import type { Category, Page, VideoSummary } from '../lib/types';

export function HomePage() {
  const [params, setParams] = useSearchParams();
  const category = params.get('category');
  const sort = params.get('sort') === 'popular' ? 'popular' : 'latest';
  const selected = category ? `c:${category}` : sort === 'popular' ? 'popular' : 'all';

  const cats = useQuery({ queryKey: ['categories'], queryFn: ({ signal }) => apiGet<{ items: Category[] }>('/categories', signal), staleTime: 60_000 });
  const activeCat = cats.data?.items.find((c) => c.slug === category);
  useDocumentTitle(activeCat ? activeCat.name : null);

  const feed = useInfiniteQuery({
    queryKey: ['feed', category ?? '', sort],
    queryFn: ({ pageParam, signal }) => {
      const qs = new URLSearchParams({ sort, ...(category ? { category } : {}), ...(pageParam ? { cursor: pageParam } : {}) });
      return apiGet<Page<VideoSummary>>(`/feed?${qs}`, signal);
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 60_000,
    meta: { page: true },
  });

  const videos = feed.data?.pages.flatMap((p) => p.items) ?? [];
  const loadMore = useCallback(() => void feed.fetchNextPage(), [feed]);

  const chips = [
    { id: 'all', label: t.home.all },
    { id: 'popular', label: t.home.popular },
    ...(cats.data?.items ?? []).map((c) => ({ id: `c:${c.slug}`, label: c.name })),
  ];
  const select = (id: string) => {
    window.scrollTo({ top: 0 });
    if (id === 'all') setParams({});
    else if (id === 'popular') setParams({ sort: 'popular' });
    else setParams({ category: id.slice(2) });
  };

  return (
    <div className="dv-home">
      <ChipBar chips={chips} selected={selected} onSelect={select} />
      {feed.isError ? (
        <EmptyState icon="error" title="Gagal memuat video">
          <p>{errorMessage(feed.error)}</p>
          <Button variant="tonal" onClick={() => void feed.refetch()}>
            {t.common.retry}
          </Button>
        </EmptyState>
      ) : !feed.isPending && videos.length === 0 ? (
        <EmptyState icon="your-videos" title={t.home.empty}>
          <p>{category ? 'Belum ada video di kategori ini.' : t.home.emptyHint}</p>
        </EmptyState>
      ) : (
        <VideoGrid videos={videos} loading={feed.isPending || feed.isFetchingNextPage} />
      )}
      <InfiniteSentinel onVisible={loadMore} disabled={!feed.hasNextPage || feed.isFetchingNextPage} />
    </div>
  );
}
