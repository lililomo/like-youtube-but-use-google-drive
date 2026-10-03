import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { ChipBar } from '../components/video/ChipBar';
import { InfiniteSentinel, VideoGrid } from '../components/video/VideoGrid';
import { EmptyState } from '../components/ui/misc';
import { Button } from '../components/ui/Button';
import { useDocumentTitle } from '../hooks/useSite';
import { t } from '../i18n/id';
import { apiGet, errorMessage } from '../lib/api';
import type { Category, Page, VideoSummary } from '../lib/types';

/**
 * Seed rekomendasi per entri riwayat navigasi: beranda yang dibuka lewat link/logo/muat ulang mendapat urutan baru
 * (seperti YouTube), sedangkan tombol Kembali memulihkan urutan yang sama.
 */
const seeds = new Map<string, string>();
function seedFor(key: string): string {
  let s = seeds.get(key);
  if (!s) {
    s = Math.random().toString(36).slice(2, 12);
    seeds.set(key, s);
  }
  return s;
}

type Sort = 'for_you' | 'latest' | 'popular';

export function HomePage() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const category = params.get('category');
  const sortParam = params.get('sort');
  const sort: Sort = sortParam === 'popular' || sortParam === 'latest' ? sortParam : 'for_you';
  const selected = category ? `c:${category}` : sort === 'for_you' ? 'all' : sort;
  const seed = sort === 'for_you' ? seedFor(location.key) : '';

  const cats = useQuery({ queryKey: ['categories'], queryFn: ({ signal }) => apiGet<{ items: Category[] }>('/categories', signal), staleTime: 60_000 });
  const activeCat = cats.data?.items.find((c) => c.slug === category);
  useDocumentTitle(activeCat ? activeCat.name : null);

  const feed = useInfiniteQuery({
    queryKey: ['feed', category ?? '', sort, seed],
    queryFn: ({ pageParam, signal }) => {
      const qs = new URLSearchParams({ sort, ...(seed ? { seed } : {}), ...(category ? { category } : {}), ...(pageParam ? { cursor: pageParam } : {}) });
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
    { id: 'latest', label: t.home.latest },
    { id: 'popular', label: t.home.popular },
    ...(cats.data?.items ?? []).map((c) => ({ id: `c:${c.slug}`, label: c.name })),
  ];
  const select = (id: string) => {
    window.scrollTo({ top: 0 });
    if (id === 'all') setParams({});
    else if (id === 'popular' || id === 'latest') setParams({ sort: id });
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
        <VideoGrid videos={videos} loading={feed.isPending || feed.isFetchingNextPage} dismissible={sort === 'for_you'} />
      )}
      <InfiniteSentinel onVisible={loadMore} disabled={!feed.hasNextPage || feed.isFetchingNextPage} />
    </div>
  );
}
