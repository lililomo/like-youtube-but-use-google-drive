import type { QueryClient } from '@tanstack/react-query';
import { apiGet } from './api';
import type { VideoDetail } from './types';

export const videoKey = (id: string) => ['video', id] as const;
export const fetchVideo = (id: string, signal?: AbortSignal) => apiGet<VideoDetail>(`/videos/${id}`, signal);

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Prefetch detail video saat kursor berhenti di kartu (navigasi ke halaman tonton terasa instan). */
export function prefetchVideo(qc: QueryClient, id: string): void {
  if (timers.has(id)) return;
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      void import('../pages/Watch');
      void qc.prefetchQuery({ queryKey: videoKey(id), queryFn: ({ signal }) => fetchVideo(id, signal), staleTime: 30_000 });
    }, 150),
  );
}

export function cancelPrefetch(id: string): void {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
}

export const watchUrl = (id: string, extra?: Record<string, string>) =>
  `/watch?${new URLSearchParams({ v: id, ...extra }).toString()}`;
