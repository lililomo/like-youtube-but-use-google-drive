import { create } from 'zustand';
import { storage } from '../lib/storage';

export type ThemePref = 'system' | 'dark' | 'light';
const KEY = 'dv.theme';
const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function resolve(pref: ThemePref): 'dark' | 'light' {
  if (pref === 'system') return media?.matches ? 'dark' : 'light';
  return pref;
}

function apply(pref: ThemePref): void {
  const theme = resolve(pref);
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', theme === 'dark' ? '#0f0f0f' : '#ffffff');
}

interface ThemeState {
  pref: ThemePref;
  explicit: boolean;
  setPref: (pref: ThemePref) => void;
  /** Dipanggil setelah /api/site dimuat: pakai default situs bila user belum memilih. */
  applySiteDefault: (pref: ThemePref) => void;
}

const stored = storage.get<ThemePref | null>(KEY, null);

export const useTheme = create<ThemeState>((set, get) => ({
  pref: stored ?? 'system',
  explicit: stored != null,
  setPref(pref) {
    storage.set(KEY, pref);
    apply(pref);
    set({ pref, explicit: true });
  },
  applySiteDefault(pref) {
    if (get().explicit) return;
    apply(pref);
    set({ pref });
  },
}));

media?.addEventListener('change', () => {
  if (useTheme.getState().pref === 'system') apply('system');
});
apply(useTheme.getState().pref);
