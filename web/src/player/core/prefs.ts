/** Preferensi pemutar (localStorage dv.player). Kecepatan sengaja tidak disimpan (seperti YouTube). */
export interface PlayerPrefs {
  volume: number;
  muted: boolean;
  autoplay: boolean;
  quality: string;
  captions: { on: boolean; lang: string | null };
}

const KEY = 'dv.player';
export const DEFAULT_PREFS: PlayerPrefs = { volume: 1, muted: false, autoplay: true, quality: 'auto', captions: { on: false, lang: null } };

export function loadPrefs(): PlayerPrefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_PREFS, captions: { ...DEFAULT_PREFS.captions } };
    const p = JSON.parse(raw) as Partial<PlayerPrefs>;
    return {
      volume: typeof p.volume === 'number' && p.volume >= 0 && p.volume <= 1 ? p.volume : 1,
      muted: Boolean(p.muted),
      autoplay: p.autoplay !== false,
      quality: typeof p.quality === 'string' ? p.quality : 'auto',
      captions: { on: Boolean(p.captions?.on), lang: p.captions?.lang ?? null },
    };
  } catch {
    return { ...DEFAULT_PREFS, captions: { ...DEFAULT_PREFS.captions } };
  }
}

export function savePrefs(p: PlayerPrefs): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* abaikan */
  }
}

/** Apakah user pernah menyimpan preferensi (untuk menerapkan default autoplay dari admin). */
export function hasStoredPrefs(): boolean {
  try {
    return window.localStorage.getItem(KEY) != null;
  } catch {
    return false;
  }
}
