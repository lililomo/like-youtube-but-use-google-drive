import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { Icon } from '../components/icons/Icon';
import { Button } from '../components/ui/Button';
import { Avatar, Skeleton } from '../components/ui/misc';
import { ChipBar } from '../components/video/ChipBar';
import { OwnerActions } from '../components/video/OwnerActions';
import { ShareDialog } from '../components/video/ShareDialog';
import { CompactSkeleton, CompactVideo } from '../components/video/VideoCards';
import { InfiniteSentinel } from '../components/video/VideoGrid';
import { useDocumentTitle } from '../hooks/useSite';
import { ApiError, apiGet, apiPost } from '../lib/api';
import { formatRelative, formatViews } from '../lib/format';
import { storage } from '../lib/storage';
import type { Page, VideoDetail, VideoSummary } from '../lib/types';
import { fetchVideo, videoKey, watchUrl } from '../lib/videoQueries';
import type { Player } from '../player/Player';
import { PlayerView, toUpNext } from '../player/PlayerView';
import { useSession } from '../stores/session';
import { resumePosition, useWatch } from '../stores/watch';

const isVideoId = (s: string) => /^[A-Za-z0-9_-]{11}$/.test(s);

/** "90", "1m30s", "1h2m3s" → detik. */
export function parseT(raw: string | null): number | undefined {
  if (!raw) return undefined;
  if (/^\d+$/.test(raw)) return Number(raw);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(raw);
  if (!m || (!m[1] && !m[2] && !m[3])) return undefined;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

type Chip = 'all' | 'channel' | 'related';
type RelatedPage = Page<VideoSummary> & { chips?: { channel: boolean; related: boolean } };

/**
 * Riwayat sesi tab ini (sessionStorage): dasar tombol Sebelumnya dan agar "Berikutnya"
 * tidak memutar ulang video yang sudah ditonton di sesi ini (SPEC §16.9).
 */
const NAV_KEY = 'dv.watchNav';
interface NavState {
  stack: string[];
  idx: number;
}
function loadNav(): NavState {
  try {
    const raw = sessionStorage.getItem(NAV_KEY);
    const v = raw ? (JSON.parse(raw) as NavState) : null;
    if (v && Array.isArray(v.stack) && typeof v.idx === 'number') return v;
  } catch {
    /* abaikan */
  }
  return { stack: [], idx: -1 };
}
function useWatchNav(id: string) {
  const location = useLocation();
  const [nav, setNav] = useState<NavState>(loadNav);
  useEffect(() => {
    if (!isVideoId(id)) return;
    let { stack, idx } = loadNav();
    const fromPrev = Boolean((location.state as { dvPrev?: boolean } | null)?.dvPrev);
    if (stack[idx] === id) {
      // muat ulang halaman
    } else if (fromPrev || (idx > 0 && stack[idx - 1] === id)) {
      idx = stack.lastIndexOf(id, idx);
    } else {
      stack = [...stack.slice(0, idx + 1), id].slice(-50);
      idx = stack.length - 1;
    }
    const next = { stack, idx };
    try {
      sessionStorage.setItem(NAV_KEY, JSON.stringify(next));
    } catch {
      /* abaikan */
    }
    setNav(next);
  }, [id, location.key, location.state]);
  const seen = useMemo(() => new Set(nav.stack), [nav.stack]);
  return { prevId: nav.idx > 0 && nav.stack[nav.idx] === id ? (nav.stack[nav.idx - 1] ?? null) : null, seen };
}

function Unavailable({ title = 'Video tidak tersedia', message }: { title?: string; message: string }) {
  return (
    <div className="dv-watch__unavailable" role="alert">
      <Icon name="video-off" size={64} />
      <h2>{title}</h2>
      <p>{message}</p>
      <Link to="/" className="dv-btn dv-btn--inverse">
        <span className="dv-btn__label">Kembali ke beranda</span>
      </Link>
    </div>
  );
}

function relatedQueryKey(id: string, chip: Chip) {
  return ['related', id, chip] as const;
}

export function WatchPage() {
  const [params] = useSearchParams();
  const id = params.get('v') ?? '';
  const tParam = parseT(params.get('t'));
  const navigate = useNavigate();
  const valid = isVideoId(id);
  const user = useSession((s) => s.user);
  const loggedIn = Boolean(user);
  const record = useWatch((s) => s.record);
  const localProgress = useWatch((s) => s.progress[id]);
  const [theater, setTheater] = useState<boolean>(() => storage.get('dv.theater', false));
  const [chip, setChip] = useState<Chip>('all');
  const [sharing, setSharing] = useState(false);
  const playerRef = useRef<Player | null>(null);
  const { prevId, seen } = useWatchNav(id);

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
  const videoRef = useRef(video);
  videoRef.current = video;

  useEffect(() => setChip('all'), [id]);

  const relatedFetch = (c: Chip) => (pageParam: string, signal: AbortSignal) =>
    apiGet<RelatedPage>(`/videos/${id}/related?${new URLSearchParams({ ...(pageParam ? { cursor: pageParam } : {}), ...(c !== 'all' ? { filter: c } : {}) })}`, signal);
  const allRelated = useInfiniteQuery({
    queryKey: relatedQueryKey(id, 'all'),
    queryFn: ({ pageParam, signal }) => relatedFetch('all')(pageParam, signal),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: valid && Boolean(video),
    staleTime: 5 * 60_000,
  });
  const chipRelated = useInfiniteQuery({
    queryKey: relatedQueryKey(id, chip),
    queryFn: ({ pageParam, signal }) => relatedFetch(chip)(pageParam, signal),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: valid && Boolean(video) && chip !== 'all',
    staleTime: 5 * 60_000,
  });
  const list = chip === 'all' ? allRelated : chipRelated;
  const allItems = useMemo(() => allRelated.data?.pages.flatMap((p) => p.items) ?? [], [allRelated.data]);
  const listItems = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const chipsInfo = allRelated.data?.pages[0]?.chips;

  // Berikutnya = rekomendasi pertama yang belum ditonton di sesi ini.
  const next = useMemo(() => allItems.find((v) => !seen.has(v.id)) ?? allItems[0], [allItems, seen]);
  const nextRef = useRef(next);
  nextRef.current = next;
  const upNext = useMemo(() => (next ? toUpNext(next) : null), [next]);
  const endscreenKey = allItems.slice(0, 8).map((v) => v.id).join();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const endscreen = useMemo(() => allItems.slice(0, 8).map(toUpNext), [endscreenKey]);

  useDocumentTitle(video?.title ?? null);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [id]);

  // Posisi awal: t= di URL > resume (server untuk user, perangkat untuk tamu).
  const startAt = useMemo(() => {
    if (!video) return undefined;
    if (tParam != null) return tParam;
    const pos = loggedIn ? video.resumeSec : localProgress?.p;
    return resumePosition(pos, video.durationSec);
    // Hanya saat video berganti — progres yang terus diperbarui tidak boleh memicu muat ulang.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video?.id]);

  const goNext = useCallback(() => {
    const n = nextRef.current;
    if (n) navigate(watchUrl(n.id));
  }, [navigate]);
  const goPrev = useCallback(() => {
    if (prevId) navigate(watchUrl(prevId), { state: { dvPrev: true } });
  }, [navigate, prevId]);
  const onSelect = useCallback((vid: string) => navigate(watchUrl(vid)), [navigate]);
  const onTheater = useCallback((on: boolean) => {
    setTheater(on);
    storage.set('dv.theater', on);
  }, []);
  const onViewQualified = useCallback(() => {
    void apiPost(`/videos/${id}/view`).catch(() => {});
  }, [id]);

  // Progres: tiap 15 dtk saat bermain, saat jeda/selesai (dari pemutar), saat mulai, dan saat halaman ditutup.
  const saveProgress = useCallback(
    (position: number, duration: number, keepalive = false) => {
      const v = videoRef.current;
      if (v) record(v, position, duration, loggedIn, keepalive);
    },
    [record, loggedIn],
  );
  const onProgress = useCallback((p: { position: number; duration: number }) => saveProgress(p.position, p.duration), [saveProgress]);
  const startedFor = useRef<string | null>(null);
  const onPlay = useCallback(() => {
    const v = videoRef.current;
    if (!v || startedFor.current === v.id) return;
    startedFor.current = v.id;
    saveProgress(playerRef.current?.currentTime ?? 0, v.durationSec ?? 0);
  }, [saveProgress]);
  useEffect(() => {
    const onHide = () => {
      const p = playerRef.current;
      const v = videoRef.current;
      if (p && v && startedFor.current === v.id) saveProgress(p.currentTime, v.durationSec ?? 0, true);
    };
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      onHide(); // pindah halaman di dalam aplikasi
    };
  }, [saveProgress, id]);

  const loadMore = useCallback(() => void list.fetchNextPage(), [list]);

  const notFound = !valid || (detail.error instanceof ApiError && detail.error.status === 404);
  const loadError = !notFound && detail.isError && !shown;

  const chips = useMemo(() => {
    const out: { id: Chip; label: string }[] = [{ id: 'all', label: 'Semua' }];
    if (video && chipsInfo?.channel) out.push({ id: 'channel', label: `Dari ${video.channel.name}` });
    if (chipsInfo?.related) out.push({ id: 'related', label: 'Terkait' });
    return out;
  }, [video, chipsInfo]);

  let playerArea: ReactNode = null;
  if (notFound) playerArea = <Unavailable message="Video ini tidak tersedia, sudah dihapus, atau bersifat privat." />;
  else if (loadError) playerArea = <Unavailable title="Terjadi kesalahan" message="Video gagal dimuat. Periksa koneksi lalu muat ulang halaman." />;
  else if (shown) {
    playerArea = (
      <PlayerView
        detail={shown}
        startAt={video ? startAt : undefined}
        hasNext={Boolean(next)}
        hasPrev={Boolean(prevId)}
        theater={theater}
        onTheater={onTheater}
        onNext={goNext}
        onPrev={goPrev}
        onSelect={onSelect}
        onPlay={onPlay}
        onProgress={onProgress}
        upNext={upNext}
        endscreen={endscreen}
        onViewQualified={onViewQualified}
        playerRef={playerRef}
      />
    );
  }

  return (
    <div className={`dv-watch${theater ? ' is-theater' : ''}`}>
      <div className="dv-watch__player-wrap">
        <div className="dv-watch__player">{playerArea}</div>
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
                    {video.visibility === 'private' && !video.canEdit && (
                      <span className="dv-private-tag">
                        <Icon name="lock" size={14} /> Privat
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="dv-watch__actions">
                {video.canEdit && <OwnerActions video={video} onDeleted={() => navigate('/', { replace: true })} />}
                <Button variant="tonal" icon="share" onClick={() => setSharing(true)}>
                  Bagikan
                </Button>
              </div>
            </div>
            {video.processing && (
              <div className="dv-banner dv-banner--info" style={{ marginTop: 12 }}>
                <Icon name="sync" /> Video ini masih diproses. Kualitas lain akan tersedia setelah selesai.
              </div>
            )}
            <ShareDialog open={sharing} onClose={() => setSharing(false)} video={video} currentTime={sharing ? (playerRef.current?.currentTime ?? 0) : 0} />
          </>
        ) : notFound || loadError ? null : (
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
        {!notFound && chips.length > 1 && (
          <div className="dv-watch__chips">
            <ChipBar chips={chips} selected={chip} onSelect={(c) => setChip(c as Chip)} sticky={false} />
          </div>
        )}
        {listItems.map((v) => (
          <CompactVideo key={v.id} video={v} />
        ))}
        {(list.isPending || list.isFetchingNextPage) && !notFound && Array.from({ length: 8 }, (_, i) => <CompactSkeleton key={i} />)}
        <InfiniteSentinel onVisible={loadMore} disabled={!list.hasNextPage || list.isFetchingNextPage} />
      </aside>
    </div>
  );
}
