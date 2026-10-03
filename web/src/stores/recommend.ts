import { create } from 'zustand';
import { apiDelete, apiPost, errorMessage } from '../lib/api';
import { toast } from './toast';

/**
 * "Tidak tertarik" (REKOMENDASI.md): kartu disembunyikan langsung di klien (dengan Urungkan), server mengecualikan
 * video itu & menurunkan yang mirip pada peringkat berikutnya. Berlaku untuk user maupun tamu.
 */
interface RecommendState {
  dismissed: Set<string>;
  dismiss: (id: string) => Promise<void>;
  undo: (id: string) => Promise<void>;
}

export const useRecommend = create<RecommendState>((set, get) => ({
  dismissed: new Set(),
  async dismiss(id) {
    set({ dismissed: new Set(get().dismissed).add(id) });
    try {
      await apiPost('/recommend/not-interested', { videoId: id });
    } catch (err) {
      const next = new Set(get().dismissed);
      next.delete(id);
      set({ dismissed: next });
      toast(errorMessage(err));
    }
  },
  async undo(id) {
    const next = new Set(get().dismissed);
    next.delete(id);
    set({ dismissed: next });
    await apiDelete(`/recommend/not-interested/${id}`).catch(() => {});
  },
}));
