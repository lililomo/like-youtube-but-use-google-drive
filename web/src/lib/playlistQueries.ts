import { useQuery, type QueryClient } from '@tanstack/react-query';
import { useSession } from '../stores/session';
import { apiGet } from './api';
import type { PlaylistDetail, PlaylistSummary } from './types';

export interface MinePage {
  items: PlaylistSummary[];
  guestCount: number;
  guestAllowed: boolean;
}

export const playlistKey = (id: string) => ['playlist', id] as const;
export const mineKey = (userId: number | null | undefined) => ['playlists', 'mine', userId ?? 'guest'] as const;

export const fetchPlaylist = (id: string, signal?: AbortSignal) => apiGet<PlaylistDetail>(`/playlists/${id}`, signal);

/** Playlist milik saya (user) atau perangkat ini (tamu). */
export function useMyPlaylists(enabled = true) {
  const user = useSession((s) => s.user);
  const loaded = useSession((s) => s.loaded);
  return useQuery({
    queryKey: mineKey(user?.id),
    queryFn: ({ signal }) => apiGet<MinePage>('/playlists/mine', signal),
    enabled: enabled && loaded,
    staleTime: 30_000,
  });
}

/** Segarkan semua data playlist setelah perubahan. */
export function invalidatePlaylists(qc: QueryClient, id?: string): void {
  void qc.invalidateQueries({ queryKey: ['playlists'] });
  if (id) void qc.invalidateQueries({ queryKey: playlistKey(id) });
}

export const playlistUrl = (id: string) => `/playlist?list=${encodeURIComponent(id)}`;
export const playlistWatchUrl = (videoId: string, listId: string, index?: number) =>
  `/watch?${new URLSearchParams({ v: videoId, list: listId, ...(index ? { index: String(index) } : {}) })}`;
