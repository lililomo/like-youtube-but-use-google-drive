import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { VideoSummary } from '../../lib/types';
import { VideoCard, VideoCardSkeleton } from './VideoCards';

/** Jumlah kolom ala YouTube: floor((lebar + 16) / 336), dibatasi 1–6. */
export function columnsFor(width: number): number {
  return Math.max(1, Math.min(6, Math.floor((width + 16) / 336)));
}

function useColumns() {
  const ref = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(4);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => entry && setCols(columnsFor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, cols };
}

export function VideoGrid({ videos, loading = false, skeletonCount = 12, footer }: { videos: VideoSummary[]; loading?: boolean; skeletonCount?: number; footer?: ReactNode }) {
  const { ref, cols } = useColumns();
  return (
    <div ref={ref} className="dv-grid" style={{ ['--cols' as string]: cols }}>
      {videos.map((v, i) => (
        <VideoCard key={v.id} video={v} eager={i < cols} />
      ))}
      {loading && Array.from({ length: videos.length ? cols : skeletonCount }, (_, i) => <VideoCardSkeleton key={`s${i}`} />)}
      {footer}
    </div>
  );
}

/** Pemicu infinite scroll: memanggil onVisible saat mendekati viewport. */
export function InfiniteSentinel({ onVisible, disabled }: { onVisible: () => void; disabled: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (disabled || !ref.current) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && onVisible(), { rootMargin: '800px 0px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [onVisible, disabled]);
  return <div ref={ref} className="dv-sentinel" aria-hidden="true" />;
}
