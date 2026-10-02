import { create } from 'zustand';
import { storage } from '../lib/storage';

interface UiState {
  /** Guide 240px terbuka (hanya berlaku di layar ≥1313px). */
  guideOpen: boolean;
  /** Drawer overlay (layar sempit & halaman tonton). */
  drawerOpen: boolean;
  toggleGuide: () => void;
  setDrawer: (open: boolean) => void;
}

export const useUi = create<UiState>((set, get) => ({
  guideOpen: storage.get('dv.guideOpen', true),
  drawerOpen: false,
  toggleGuide() {
    const next = !get().guideOpen;
    storage.set('dv.guideOpen', next);
    set({ guideOpen: next });
  },
  setDrawer(open) {
    set({ drawerOpen: open });
  },
}));
