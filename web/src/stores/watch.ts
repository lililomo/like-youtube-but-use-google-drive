import { create } from 'zustand';
import { api, apiDelete } from '../lib/api';
import { storage } from '../lib/storage';
import type { VideoSummary } from '../lib/types';

/**
 * Progres & histori tonton (SPEC §15.8, §17).
 * - User login: dikirim ke server (POST /api/progress); salinan sesi di memori agar bar merah thumbnail langsung berubah.
 * - Tamu: localStorage `dv.progress` (maks 500) & `dv.history` (maks 200) untuk Histori & resume; progres juga dikirim
 *   ke server (guest_watch per dv_gid) hanya sebagai sinyal rekomendasi — dihapus bersama histori perangkat.
 */
const KEY_PROGRESS = 'dv.progress';
const KEY_HISTORY = 'dv.history';
const MAX_PROGRESS = 500;
const MAX_HISTORY = 200;

export interface ProgressEntry {
  p: number;
  d: number;
  at: number;
}

export type GuestHistoryItem = Pick<VideoSummary, 'id' | 'title' | 'durationSec' | 'thumb' | 'channel' | 'views' | 'publishedAt' | 'visibility' | 'category'> & {
  watchedAt: string;
};

interface WatchState {
  progress: Record<string, ProgressEntry>;
  guestHistory: GuestHistoryItem[];
  record: (video: VideoSummary, position: number, duration: number, loggedIn: boolean, keepalive?: boolean, start?: boolean) => void;
  removeGuest: (id: string) => void;
  clearGuest: () => void;
  forget: (id: string) => void;
}

function trimProgress(map: Record<string, ProgressEntry>): Record<string, ProgressEntry> {
  const entries = Object.entries(map);
  if (entries.length <= MAX_PROGRESS) return map;
  entries.sort((a, b) => b[1].at - a[1].at);
  return Object.fromEntries(entries.slice(0, MAX_PROGRESS));
}

export const useWatch = create<WatchState>((set, get) => ({
  progress: storage.get<Record<string, ProgressEntry>>(KEY_PROGRESS, {}),
  guestHistory: storage.get<GuestHistoryItem[]>(KEY_HISTORY, []),

  record(video, position, duration, loggedIn, keepalive = false, start = false) {
    const p = Math.max(0, Math.floor(position));
    const d = Math.round(duration || video.durationSec || 0);
    const entry = { p, d, at: Date.now() };
    const progress = { ...get().progress, [video.id]: entry };
    // Tamu juga dikirim: server menyimpannya per dv_gid hanya sebagai sinyal rekomendasi (REKOMENDASI.md).
    void api('/progress', { method: 'POST', body: { videoId: video.id, positionSec: p, durationSec: d, ...(start ? { start } : {}) }, keepalive }).catch(() => {});
    if (loggedIn) {
      set({ progress });
      return;
    }
    const trimmed = trimProgress(progress);
    const item: GuestHistoryItem = {
      id: video.id,
      title: video.title,
      durationSec: video.durationSec,
      thumb: video.thumb,
      channel: video.channel,
      views: video.views,
      publishedAt: video.publishedAt,
      visibility: video.visibility,
      category: video.category,
      watchedAt: new Date().toISOString(),
    };
    const guestHistory = [item, ...get().guestHistory.filter((h) => h.id !== video.id)].slice(0, MAX_HISTORY);
    storage.set(KEY_PROGRESS, trimmed);
    storage.set(KEY_HISTORY, guestHistory);
    set({ progress: trimmed, guestHistory });
  },

  removeGuest(id) {
    void apiDelete(`/recommend/guest-history/${id}`).catch(() => {});
    const guestHistory = get().guestHistory.filter((h) => h.id !== id);
    const progress = { ...get().progress };
    delete progress[id];
    storage.set(KEY_HISTORY, guestHistory);
    storage.set(KEY_PROGRESS, progress);
    set({ guestHistory, progress });
  },

  clearGuest() {
    void apiDelete('/recommend/guest-history').catch(() => {});
    storage.remove(KEY_HISTORY);
    storage.remove(KEY_PROGRESS);
    set({ guestHistory: [], progress: {} });
  },

  /** Lupakan progres sesi (mis. setelah item histori dihapus di server). */
  forget(id) {
    const progress = { ...get().progress };
    delete progress[id];
    set({ progress });
  },
}));

/** Posisi resume (SPEC §16.9): dipakai bila > 30 dtk dan < durasi − 15 dtk. */
export function resumePosition(pos: number | null | undefined, duration: number | null | undefined): number | undefined {
  if (pos == null || !duration) return undefined;
  return pos > 30 && pos < duration - 15 ? pos : undefined;
}
