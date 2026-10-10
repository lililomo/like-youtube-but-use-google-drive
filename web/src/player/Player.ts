/**
 * Pemutar video GDrive Tube — vanilla TypeScript, tanpa dependensi (SPEC §16).
 * Satu instance per halaman tonton; ganti video dengan load() agar elemen <video>
 * (dan status layar penuh) tetap bertahan.
 */
import { formatDuration } from '../lib/format';
import { AbrController } from './core/abr';
import { Emitter } from './core/emitter';
import { hasStoredPrefs, loadPrefs, savePrefs, type PlayerPrefs } from './core/prefs';
import { pickAuto, pickManual, shortLabel, stepDown, stepUp, type Conn } from './core/quality';
import { activeCues, parseVtt, type Cue } from './core/vtt';
import { svg, type PlayerIcon } from './ui/icons';

export interface PlayerSource {
  q: string;
  label: string;
  height: number;
  width: number;
  url: string;
  mime: string;
  bitrateKbps: number | null;
  isOriginal: boolean;
}

export interface PlayerTrack {
  id: number;
  lang: string | null;
  label: string;
  url: string;
  isDefault: boolean;
}

export interface PlayerStoryboard {
  interval: number;
  w: number;
  h: number;
  cols: number;
  rows: number;
  count: number;
  sheets: string[];
}

/** Video untuk layar akhir (hitung mundur "Berikutnya" & grid rekomendasi). */
export interface UpNextItem {
  id: string;
  title: string;
  channelName: string;
  thumb: string | null;
  durationSec: number | null;
}

export interface PlayerConfig {
  /** Detik untuk J/L & double-tap (setting player.seek_seconds). */
  seekSeconds?: number;
  /** Detik hitung mundur autoplay (setting player.endscreen_countdown; 0 = langsung). */
  countdown?: number;
  /** Autoplay bawaan dari admin — hanya dipakai bila user belum pernah mengatur. */
  autoplayDefault?: boolean;
}

export interface PlayerLoadOptions {
  videoId: string;
  /** URL kanonik untuk menu klik kanan "Salin URL video". */
  shareUrl?: string;
  title: string;
  channelName?: string;
  poster?: string | null;
  artwork?: string | null;
  sources: PlayerSource[];
  sourcesExpireAt?: string;
  subtitles?: PlayerTrack[];
  storyboard?: PlayerStoryboard | null;
  durationSec?: number | null;
  startAt?: number;
  autoplay?: boolean;
  hasPrev?: boolean;
  hasNext?: boolean;
  /** Ambil ulang URL bertanda tangan (dipakai saat kedaluwarsa / error jaringan). */
  refreshSources?: () => Promise<{ sources: PlayerSource[]; sourcesExpireAt: string }>;
}

export interface PlayerEvents extends Record<string, unknown> {
  play: void;
  pause: void;
  ended: void;
  next: void;
  prev: void;
  theater: boolean;
  autoplaychange: boolean;
  progress: { position: number; duration: number };
  viewqualified: void;
  qualitychange: { q: string; auto: boolean };
  error: { message: string };
  fullscreenchange: boolean;
  /** Video dipilih dari grid layar akhir. */
  select: string;
}

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const TAP_DELAY_TOUCH = 280;
const TAP_DELAY_MOUSE = 200;
const LONG_PRESS_MS = 500;

type MenuView = 'main' | 'speed' | 'quality' | 'captions';


interface DocFs extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}
interface ElFs extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}
interface VideoFs extends HTMLVideoElement {
  webkitEnterFullscreen?: () => void;
  webkitDisplayingFullscreen?: boolean;
}

const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const isTypingTarget = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

const TEMPLATE = `
<video class="dvp-video" playsinline webkit-playsinline preload="metadata"></video>
<canvas class="dvp-freeze" hidden></canvas>
<div class="dvp-captions" aria-hidden="true"></div>
<div class="dvp-gesture"></div>
<div class="dvp-dim" aria-hidden="true"></div>
<div class="dvp-bezel" aria-hidden="true"><div class="dvp-bezel__circle"><div class="dvp-bezel__icon"></div></div><div class="dvp-bezel__text"></div></div>
<div class="dvp-ripple dvp-ripple--left" aria-hidden="true"><div class="dvp-ripple__inner"><div class="dvp-ripple__arrows">${svg('rewind')}</div><div class="dvp-ripple__text"></div></div></div>
<div class="dvp-ripple dvp-ripple--right" aria-hidden="true"><div class="dvp-ripple__inner"><div class="dvp-ripple__arrows">${svg('forward')}</div><div class="dvp-ripple__text"></div></div></div>
<div class="dvp-speedup" aria-hidden="true">2x ${svg('forward')}</div>
<div class="dvp-spinner" aria-hidden="true"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="28"/></svg></div>
<div class="dvp-osd" aria-live="polite"></div>
<div class="dvp-error" hidden><div class="dvp-error__icon">${svg('error')}</div><div class="dvp-error__msg"></div><button type="button" class="dvp-error__retry">Coba lagi</button></div>
<div class="dvp-mobile-center">
  <button type="button" class="dvp-mbtn dvp-mprev" aria-label="Sebelumnya">${svg('prev')}</button>
  <button type="button" class="dvp-mbtn dvp-mplay" aria-label="Putar">${svg('play')}</button>
  <button type="button" class="dvp-mbtn dvp-mnext" aria-label="Berikutnya">${svg('next')}</button>
</div>
<div class="dvp-gradient"></div>
<div class="dvp-chrome">
  <div class="dvp-progress" role="slider" tabindex="0" aria-label="Penggeser pencarian" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0">
    <div class="dvp-progress__track"><div class="dvp-progress__buffer"></div><div class="dvp-progress__hover"></div><div class="dvp-progress__played"></div></div>
    <div class="dvp-progress__scrubber"></div>
    <div class="dvp-preview"><div class="dvp-preview__frame"></div><div class="dvp-preview__time"></div></div>
  </div>
  <div class="dvp-controls">
    <div class="dvp-left">
      <button type="button" class="dvp-btn dvp-prev" data-tip="Sebelumnya (SHIFT+P)" aria-label="Sebelumnya">${svg('prev')}</button>
      <button type="button" class="dvp-btn dvp-play" data-tip="Putar (k)" aria-label="Putar">${svg('play')}</button>
      <button type="button" class="dvp-btn dvp-next" data-tip="Berikutnya (SHIFT+N)" aria-label="Berikutnya">${svg('next')}</button>
      <div class="dvp-volume">
        <button type="button" class="dvp-btn dvp-mute" data-tip="Bisukan (m)" aria-label="Bisukan">${svg('volumeUp')}</button>
        <div class="dvp-volume__slider" role="slider" tabindex="0" aria-label="Volume" aria-valuemin="0" aria-valuemax="100">
          <div class="dvp-volume__track"><div class="dvp-volume__fill"></div><div class="dvp-volume__knob"></div></div>
        </div>
      </div>
      <div class="dvp-time"><span class="dvp-time__cur">0:00</span><span class="dvp-time__sep"> / </span><span class="dvp-time__dur">0:00</span></div>
    </div>
    <div class="dvp-right">
      <button type="button" class="dvp-btn dvp-autoplay" role="switch" aria-checked="true" data-tip="Putar otomatis aktif" aria-label="Putar otomatis">
        <span class="dvp-autoplay__track"><span class="dvp-autoplay__knob">${svg('play', 'dvp-autoplay__on')}${svg('pause', 'dvp-autoplay__off')}</span></span>
      </button>
      <button type="button" class="dvp-btn dvp-cc" data-tip="Subtitel/CC (c)" aria-label="Subtitel/CC" aria-pressed="false">${svg('cc')}</button>
      <button type="button" class="dvp-btn dvp-settings" data-tip="Setelan" aria-label="Setelan" aria-haspopup="menu">${svg('settings')}<span class="dvp-hd">HD</span></button>
      <button type="button" class="dvp-btn dvp-theater" data-tip="Mode bioskop (t)" aria-label="Mode bioskop">${svg('theater')}</button>
      <button type="button" class="dvp-btn dvp-fs" data-tip="Layar penuh (f)" aria-label="Layar penuh">${svg('fullscreen')}</button>
    </div>
  </div>
</div>
<div class="dvp-endscreen" hidden></div>
<div class="dvp-menu" role="menu" hidden></div>
<div class="dvp-ctxmenu" role="menu" hidden></div>
<div class="dvp-tooltip" aria-hidden="true"></div>
`;

export class Player {
  readonly root: HTMLDivElement;
  readonly video: VideoFs;
  private readonly events = new Emitter<PlayerEvents>();
  private readonly $: Record<string, HTMLElement> = {};
  private opts: PlayerLoadOptions | null = null;
  private prefs: PlayerPrefs = loadPrefs();
  private sources: PlayerSource[] = [];
  private current: PlayerSource | null = null;
  private failed = new Set<string>();
  private cues: Cue[] = [];
  private captionTrack: PlayerTrack | null = null;
  private lastCaptionHtml = '';
  private menuView: MenuView | null = null;
  private theater = false;
  private keyboard = false;
  private destroyed = false;

  // status pemutaran
  private pendingSeek: number | null = null;
  private wantPlay = false;
  private pendingRate = 1;
  private lastTime = 0;
  private watched = 0;
  private viewQualified = false;
  private lastProgressEmit = 0;
  private retries = 0;
  private lastRefresh = 0;
  private recovering = false;
  private stallTimer?: ReturnType<typeof setTimeout>;
  private spinnerTimer?: ReturnType<typeof setTimeout>;
  private hideTimer?: ReturnType<typeof setTimeout>;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private raf = 0;
  private userInitiated = false;
  private seekSeconds = 10;
  private countdownSec = 5;

  // layar akhir & navigasi
  private upNext: UpNextItem | null = null;
  private endItems: UpNextItem[] = [];
  private playlistMode = false;
  private countdownTimer?: ReturnType<typeof setInterval>;

  // ABR, Media Session, Wake Lock, rotasi
  private readonly abr = new AbrController();
  private abrCap = Infinity;
  private abrTimer?: ReturnType<typeof setInterval>;
  private lastPositionState = 0;
  private wakeLock: WakeLockSentinel | null = null;
  private fsByRotation = false;

  // gesture
  private tapTimer?: ReturnType<typeof setTimeout>;
  private lastTap: { t: number; zone: string } | null = null;
  private seekStreak: { side: 'left' | 'right'; amount: number; until: number } | null = null;
  private rippleTimer?: ReturnType<typeof setTimeout>;
  private longPressTimer?: ReturnType<typeof setTimeout>;
  private longPressActive = false;
  private rateBeforeLongPress = 1;
  private dragging = false;
  private dragFrac = 0;
  private lastDragSeek = 0;

  private readonly cleanup: (() => void)[] = [];

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'dvp';
    this.root.tabIndex = -1;
    this.root.innerHTML = TEMPLATE;
    this.root.dataset.state = 'idle';
    this.root.dataset.touch = String(window.matchMedia('(hover: none) and (pointer: coarse)').matches);
    container.appendChild(this.root);
    for (const el of this.root.querySelectorAll<HTMLElement>('[class^="dvp-"],[class*=" dvp-"]')) {
      for (const cls of el.classList) if (cls.startsWith('dvp-') && !this.$[cls]) this.$[cls] = el;
    }
    this.video = this.root.querySelector('video') as VideoFs;
    this.applyVolumePrefs();
    this.updateAutoplayButton();
    this.bindVideo();
    this.bindControls();
    this.bindGestures();
    this.bindDocument();
    this.bindContextMenu();
    this.bindEndscreen();
    this.bindMediaSession();
    this.bindOrientation();
    this.abrTimer = setInterval(() => this.abrTick(), 1000);
  }

  // ---------------------------------------------------------------------------
  // API publik
  // ---------------------------------------------------------------------------

  on<K extends keyof PlayerEvents>(type: K, fn: (p: PlayerEvents[K]) => void): () => void {
    return this.events.on(type, fn);
  }

  load(opts: PlayerLoadOptions): void {
    this.opts = opts;
    this.failed.clear();
    this.retries = 0;
    this.watched = 0;
    this.viewQualified = false;
    this.lastTime = 0;
    this.lastProgressEmit = Date.now();
    this.cues = [];
    this.lastCaptionHtml = '';
    this.$['dvp-captions']!.innerHTML = '';
    this.hideError();
    this.closeMenu();
    this.closeContextMenu();
    this.hideEndscreen();
    this.video.loop = false;
    this.fsByRotation = this.fsByRotation && this.isFullscreen();
    this.abr.reset(Date.now());
    this.sources = [...opts.sources].sort((a, b) => b.height - a.height);
    this.root.dataset.hasPrev = String(Boolean(opts.hasPrev));
    this.root.dataset.hasNext = String(Boolean(opts.hasNext));
    this.root.dataset.hasCc = String(Boolean(opts.subtitles?.length));
    this.video.poster = opts.poster ?? '';
    this.setDurationText(opts.durationSec ?? 0);
    this.scheduleSourceRefresh();

    const src = this.chooseSource();
    if (!src) {
      this.video.removeAttribute('src');
      this.video.load();
      this.showError('Video sedang diproses. Coba lagi beberapa saat lagi.', false);
      return;
    }
    this.setSource(src, opts.startAt && opts.startAt > 0 ? opts.startAt : null, opts.autoplay ?? true, 1);
    this.restoreCaptions();
    this.updateQualityBadge();
    this.updateMediaSession();
  }

  play(): void {
    this.userInitiated = true;
    if (this.root.dataset.state === 'ended') this.video.currentTime = 0;
    void this.video.play().catch((err: Error) => this.onPlayRejected(err));
  }

  pause(): void {
    this.video.pause();
  }

  togglePlay(withBezel = true): void {
    if (this.video.paused || this.video.ended) {
      this.play();
      if (withBezel) this.bezel('play');
    } else {
      this.pause();
      if (withBezel) this.bezel('pause');
    }
  }

  seek(t: number): void {
    const d = this.duration();
    if (!d) return;
    this.abr.reset(Date.now());
    if (this.root.dataset.state === 'ended') this.hideEndscreen();
    this.video.currentTime = Math.max(0, Math.min(t, d - 0.05));
    this.renderProgress();
  }

  seekBy(delta: number): void {
    this.seek(this.video.currentTime + delta);
  }

  setTheater(on: boolean): void {
    this.theater = on;
    this.root.dataset.theater = String(on);
    const btn = this.$['dvp-theater']!;
    btn.innerHTML = svg(on ? 'theaterExit' : 'theater');
    btn.dataset.tip = on ? 'Tampilan default (t)' : 'Mode bioskop (t)';
  }

  setKeyboardEnabled(on: boolean): void {
    this.keyboard = on;
  }

  setNavigation(hasPrev: boolean, hasNext: boolean): void {
    this.root.dataset.hasPrev = String(hasPrev);
    this.root.dataset.hasNext = String(hasNext);
    this.updateMediaSessionHandlers();
  }

  configure(cfg: PlayerConfig): void {
    if (cfg.seekSeconds && cfg.seekSeconds > 0) this.seekSeconds = cfg.seekSeconds;
    if (cfg.countdown != null && cfg.countdown >= 0) this.countdownSec = cfg.countdown;
    if (cfg.autoplayDefault != null && !hasStoredPrefs() && this.prefs.autoplay !== cfg.autoplayDefault) {
      this.prefs.autoplay = cfg.autoplayDefault;
      this.updateAutoplayButton();
    }
  }

  /** Video berikutnya (rekomendasi pertama / item playlist berikutnya) untuk hitung mundur autoplay. */
  setUpNext(item: UpNextItem | null): void {
    this.upNext = item;
  }

  /** Rekomendasi untuk grid layar akhir (autoplay nonaktif). */
  setEndscreenItems(items: UpNextItem[]): void {
    this.endItems = items.slice(0, 8);
  }

  /** Di playlist: video berikutnya langsung diputar tanpa hitung mundur (SPEC §16.9). */
  setPlaylistMode(on: boolean): void {
    this.playlistMode = on;
  }

  get autoplay(): boolean {
    return this.prefs.autoplay;
  }

  get currentTime(): number {
    return this.video.currentTime;
  }

  isFullscreen(): boolean {
    const d = document as DocFs;
    return (d.fullscreenElement ?? d.webkitFullscreenElement) === this.root;
  }

  async toggleFullscreen(): Promise<void> {
    const d = document as DocFs;
    const el = this.root as ElFs;
    if (this.isFullscreen()) {
      await (d.exitFullscreen?.() ?? d.webkitExitFullscreen?.());
      return;
    }
    if (el.requestFullscreen || el.webkitRequestFullscreen) {
      try {
        await (el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen!());
        this.lockOrientation();
      } catch {
        this.video.webkitEnterFullscreen?.();
      }
    } else {
      // iPhone: pemutar layar penuh bawaan iOS (rotasi otomatis).
      this.video.webkitEnterFullscreen?.();
    }
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    [this.stallTimer, this.spinnerTimer, this.hideTimer, this.refreshTimer, this.tapTimer, this.rippleTimer, this.longPressTimer].forEach((t) => t && clearTimeout(t));
    clearInterval(this.abrTimer);
    clearInterval(this.countdownTimer);
    void this.releaseWakeLock();
    this.clearMediaSession();
    this.cleanup.forEach((fn) => fn());
    this.events.clear();
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    this.root.remove();
  }

  // ---------------------------------------------------------------------------
  // Sumber & kualitas
  // ---------------------------------------------------------------------------

  private conn(): Conn | null {
    return (navigator as Navigator & { connection?: Conn }).connection ?? null;
  }

  private chooseSource(): PlayerSource | null {
    if (this.prefs.quality !== 'auto') return pickManual(this.sources, this.prefs.quality, this.failed);
    const h = this.root.clientHeight || 360;
    const pick = pickAuto(this.sources, h, window.devicePixelRatio || 1, this.conn(), this.failed);
    if (pick && pick.height > this.abrCap) {
      return pickManual(this.sources, String(this.abrCap), this.failed) ?? pick;
    }
    return pick;
  }

  /** Tinggi target mode Otomatis tanpa batas ABR. */
  private autoTargetHeight(): number {
    const h = this.root.clientHeight || 360;
    return pickAuto(this.sources, h, window.devicePixelRatio || 1, this.conn(), this.failed)?.height ?? 0;
  }

  // ---------------------------------------------------------------------------
  // ABR (SPEC §16.6) — hanya mode Otomatis
  // ---------------------------------------------------------------------------

  private bufferAhead(): number {
    const v = this.video;
    for (let i = 0; i < v.buffered.length; i++) {
      if (v.buffered.start(i) <= v.currentTime + 0.25 && v.buffered.end(i) >= v.currentTime) return v.buffered.end(i) - v.currentTime;
    }
    return 0;
  }

  private abrTick(): void {
    if (this.prefs.quality !== 'auto' || !this.current || this.destroyed) return;
    const v = this.video;
    const playing = !v.paused && !v.seeking && !v.ended && this.root.dataset.state === 'playing';
    const d = this.duration();
    const nearEnd = d > 0 && d - v.currentTime < 10;
    this.applyAbr(this.abr.onTick(Date.now(), this.bufferAhead(), playing, nearEnd));
  }

  private applyAbr(decision: 'up' | 'down' | null): void {
    if (!decision || !this.current || this.prefs.quality !== 'auto') return;
    const now = Date.now();
    const target =
      decision === 'down'
        ? stepDown(this.sources, this.current, this.failed)
        : stepUp(this.sources, this.current, this.autoTargetHeight(), this.failed);
    if (!target) {
      this.abr.switched(now, decision);
      return;
    }
    this.abrCap = decision === 'down' ? target.height : this.abrCap === Infinity ? Infinity : target.height;
    this.abr.switched(now, decision);
    this.switchSource(target);
    if (this.menuView === 'quality' || this.menuView === 'main') this.renderMenu();
  }

  private setSource(src: PlayerSource, at: number | null, play: boolean, rate: number): void {
    this.current = src;
    this.pendingSeek = at;
    this.wantPlay = play;
    this.pendingRate = rate;
    this.root.dataset.state = 'loading';
    this.video.src = src.url;
    this.video.load();
    this.updateQualityBadge();
  }

  /** Ganti kualitas tanpa layar hitam: frame terakhir dibekukan di canvas. */
  private switchSource(src: PlayerSource): void {
    if (!this.current || src.url === this.current.url) return;
    const t = this.video.currentTime;
    const playing = !this.video.paused && !this.video.ended;
    this.freezeFrame();
    this.setSource(src, t, playing, this.video.playbackRate);
    this.events.emit('qualitychange', { q: src.q, auto: this.prefs.quality === 'auto' });
  }

  setQuality(q: string): void {
    this.prefs.quality = q;
    savePrefs(this.prefs);
    this.abrCap = Infinity;
    this.abr.reset(Date.now());
    const src = this.chooseSource();
    if (src) this.switchSource(src);
    this.updateQualityBadge();
  }

  private freezeFrame(): void {
    const c = this.$['dvp-freeze'] as HTMLCanvasElement;
    const v = this.video;
    if (!v.videoWidth || v.readyState < 2) return;
    try {
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      c.getContext('2d')?.drawImage(v, 0, 0);
      c.hidden = false;
    } catch {
      c.hidden = true;
    }
  }

  private unfreeze(): void {
    (this.$['dvp-freeze'] as HTMLCanvasElement).hidden = true;
  }

  private updateQualityBadge(): void {
    const hd = (this.current?.height ?? 0) >= 720;
    this.root.dataset.hd = String(hd);
  }

  private scheduleSourceRefresh(): void {
    clearTimeout(this.refreshTimer);
    const exp = this.opts?.sourcesExpireAt ? Date.parse(this.opts.sourcesExpireAt) : NaN;
    if (!Number.isFinite(exp) || !this.opts?.refreshSources) return;
    const delay = Math.max(30_000, exp - Date.now() - 10 * 60_000);
    this.refreshTimer = setTimeout(() => void this.refreshSources(), Math.min(delay, 2 ** 31 - 1));
  }

  private async refreshSources(): Promise<boolean> {
    if (!this.opts?.refreshSources) return false;
    try {
      const r = await this.opts.refreshSources();
      if (this.destroyed) return false;
      this.lastRefresh = Date.now();
      this.sources = [...r.sources].sort((a, b) => b.height - a.height);
      this.opts.sourcesExpireAt = r.sourcesExpireAt;
      if (this.current) this.current = this.sources.find((s) => s.q === this.current!.q) ?? this.current;
      this.scheduleSourceRefresh();
      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Event video
  // ---------------------------------------------------------------------------

  private bindVideo(): void {
    const v = this.video;
    const on = (type: string, fn: () => void) => v.addEventListener(type, fn);
    on('loadedmetadata', () => {
      if (this.pendingSeek != null && this.pendingSeek > 0 && this.pendingSeek < v.duration - 1) v.currentTime = this.pendingSeek;
      this.pendingSeek = null;
      v.defaultPlaybackRate = 1;
      v.playbackRate = this.pendingRate;
      this.setDurationText(v.duration);
      if (this.wantPlay) {
        this.wantPlay = false;
        void v.play().catch((err: Error) => this.onPlayRejected(err));
      } else {
        this.root.dataset.state = 'paused';
        this.unfreeze();
      }
    });
    on('play', () => {
      this.hideEndscreen();
      this.root.dataset.state = 'playing';
      this.setPlayIcon(false);
      this.events.emit('play', undefined);
      this.showControls();
      this.loop();
    });
    on('playing', () => {
      this.root.dataset.state = 'playing';
      this.hideSpinner();
      this.unfreeze();
      clearTimeout(this.stallTimer);
      void this.requestWakeLock();
      this.setMediaPlaybackState('playing');
    });
    on('pause', () => {
      if (v.ended) return;
      this.root.dataset.state = 'paused';
      this.setPlayIcon(false);
      this.showControls(true);
      this.emitProgress();
      void this.releaseWakeLock();
      this.setMediaPlaybackState('paused');
      this.events.emit('pause', undefined);
    });
    on('waiting', () => {
      this.showSpinner();
      if (!v.seeking && this.root.dataset.state === 'playing') this.applyAbr(this.abr.onWaiting(Date.now()));
      clearTimeout(this.stallTimer);
      const at = v.currentTime;
      this.stallTimer = setTimeout(() => {
        if (!v.paused && v.readyState < 3 && Math.abs(v.currentTime - at) < 0.5) void this.recover('stall');
      }, 12_000);
    });
    on('canplay', () => this.hideSpinner());
    on('seeking', () => {
      this.showSpinner();
      this.abr.reset(Date.now());
    });
    on('seeked', () => {
      this.hideSpinner();
      if (v.paused) this.unfreeze();
      this.renderCaptions();
    });
    on('timeupdate', () => this.onTimeUpdate());
    on('progress', () => this.renderBuffer());
    on('durationchange', () => this.setDurationText(v.duration));
    on('volumechange', () => this.renderVolume());
    on('ratechange', () => {
      if (!this.longPressActive && this.menuView === 'speed') this.renderMenu();
    });
    on('ended', () => {
      this.root.dataset.state = 'ended';
      this.setPlayIcon(true);
      this.showControls(true);
      this.emitProgress();
      void this.releaseWakeLock();
      this.setMediaPlaybackState('paused');
      this.events.emit('ended', undefined);
      this.onEndedFlow();
    });
    // iPhone: layar penuh bawaan iOS pada elemen video.
    v.addEventListener('webkitbeginfullscreen', () => this.events.emit('fullscreenchange', true));
    v.addEventListener('webkitendfullscreen', () => this.events.emit('fullscreenchange', false));
    on('error', () => void this.recover('error'));
  }

  private onPlayRejected(err: Error): void {
    if (err.name === 'NotAllowedError') {
      // Autoplay diblokir browser: tampilkan status jeda (tombol putar besar).
      this.root.dataset.state = 'paused';
      this.unfreeze();
      this.showControls(true);
    }
  }

  private onTimeUpdate(): void {
    const v = this.video;
    const t = v.currentTime;
    if (!v.paused && !v.seeking) {
      const dt = t - this.lastTime;
      if (dt > 0 && dt < 2) this.watched += dt;
      if (t > 2 && this.retries) this.retries = 0;
    }
    this.lastTime = t;
    const d = this.duration();
    if (!this.viewQualified && d > 0 && this.watched >= Math.min(30, d * 0.5)) {
      this.viewQualified = true;
      this.events.emit('viewqualified', undefined);
    }
    if (Date.now() - this.lastProgressEmit > 15_000) this.emitProgress();
    if (Date.now() - this.lastPositionState > 1000) this.updatePositionState();
    this.renderTime();
    this.renderCaptions();
    if (v.paused) this.renderProgress();
  }

  private emitProgress(): void {
    this.lastProgressEmit = Date.now();
    const d = this.duration();
    if (d > 0) this.events.emit('progress', { position: this.video.currentTime, duration: d });
  }

  private loop = (): void => {
    cancelAnimationFrame(this.raf);
    const step = () => {
      if (this.destroyed || this.video.paused) return;
      if (!this.dragging) this.renderProgress();
      this.renderCaptions();
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  };

  private duration(): number {
    const d = this.video.duration;
    if (Number.isFinite(d) && d > 0) return d;
    return this.opts?.durationSec ?? 0;
  }

  // ---------------------------------------------------------------------------
  // Pemulihan error (SPEC §16.9)
  // ---------------------------------------------------------------------------

  private async recover(kind: 'error' | 'stall'): Promise<void> {
    if (this.recovering || this.destroyed || !this.current) return;
    const code = this.video.error?.code ?? 0;
    if (kind === 'error' && code === 0) return;
    this.recovering = true;
    try {
      const at = this.lastTime || this.video.currentTime || 0;
      const resume = kind === 'stall' || !this.video.paused || this.root.dataset.state === 'loading' || this.root.dataset.state === 'playing';
      if (this.retries >= 4) {
        this.showError('Terjadi error saat memutar video.', true);
        return;
      }
      this.retries++;
      // 1) URL bertanda tangan mungkin kedaluwarsa → ambil ulang (maks sekali per 20 dtk).
      if (Date.now() - this.lastRefresh > 20_000) await this.refreshSources();
      // Elemen video melaporkan balasan HTTP error (mis. 502/503) sebagai "format tidak didukung";
      // tanyakan server langsung agar pesan & keputusan fallback benar.
      if (kind === 'error') {
        const fault = await this.probeSource(this.sources.find((s) => s.q === this.current!.q) ?? this.current);
        if (this.destroyed) return;
        if (fault) {
          if (fault.fatal || this.retries >= 3) {
            this.showError(fault.message, true);
            return;
          }
          await new Promise((r) => setTimeout(r, 1000 * 2 ** (this.retries - 1)));
          if (this.destroyed) return;
          this.freezeFrame();
          this.setSource(this.current, at, resume, this.video.playbackRate || 1);
          return;
        }
      }
      // 2) Format tidak didukung pada percobaan ke-2 → turun ke kualitas lain / compat.
      let target = this.sources.find((s) => s.q === this.current!.q) ?? this.current;
      if (code === 4 && this.retries >= 2) {
        this.failed.add(this.current.q);
        target = this.sources.find((s) => s.q === 'compat' && !this.failed.has('compat')) ?? stepDown(this.sources, this.current, this.failed) ?? this.chooseSource() ?? target;
        if (this.failed.has(target.q)) {
          this.showError('Format video ini belum bisa diputar di browser Anda. Video sedang diproses, coba lagi nanti.', true);
          return;
        }
      }
      await new Promise((r) => setTimeout(r, 500 * 2 ** (this.retries - 1)));
      if (this.destroyed) return;
      this.freezeFrame();
      this.setSource(target, at, resume, this.video.playbackRate || 1);
    } finally {
      this.recovering = false;
    }
  }

  /** Cek 1 byte sumber; null = server melayani normal (error memang dari format/dekoder). */
  private async probeSource(src: PlayerSource): Promise<{ message: string; fatal: boolean } | null> {
    let res: Response;
    try {
      res = await fetch(src.url, { headers: { Range: 'bytes=0-0' }, credentials: 'same-origin', cache: 'no-store' });
    } catch {
      return { message: 'Koneksi terputus. Periksa jaringan Anda lalu coba lagi.', fatal: false };
    }
    if (res.ok) {
      void res.body?.cancel();
      return null;
    }
    let code = '';
    let message = '';
    try {
      const j = (await res.json()) as { error?: { code?: string; message?: string } };
      code = j.error?.code ?? '';
      message = j.error?.message ?? '';
    } catch {
      /* balasan bukan JSON (mis. halaman error proxy) */
    }
    if (res.status === 404) return { message: 'Video tidak ditemukan atau sudah dihapus.', fatal: true };
    if (res.status === 403) return { message: 'Tautan video kedaluwarsa. Muat ulang halaman lalu coba lagi.', fatal: false };
    if (code === 'DRIVE_AUTH' || code === 'DRIVE_QUOTA') return { message, fatal: true };
    return { message: message || 'Server sedang bermasalah. Coba lagi nanti.', fatal: false };
  }

  private showError(message: string, retry: boolean): void {
    this.root.dataset.state = 'error';
    this.hideSpinner();
    this.unfreeze();
    const box = this.$['dvp-error']!;
    box.hidden = false;
    this.$['dvp-error__msg']!.textContent = message;
    (this.$['dvp-error__retry'] as HTMLButtonElement).hidden = !retry;
    this.events.emit('error', { message });
  }

  private hideError(): void {
    this.$['dvp-error']!.hidden = true;
  }

  // ---------------------------------------------------------------------------
  // Kontrol
  // ---------------------------------------------------------------------------

  private bindControls(): void {
    const click = (cls: string, fn: (e: MouseEvent) => void) => this.$[cls]!.addEventListener('click', (e) => {
      e.stopPropagation();
      fn(e as MouseEvent);
    });
    click('dvp-play', () => this.togglePlay(false));
    click('dvp-mplay', () => {
      this.togglePlay(false);
      this.showControls();
    });
    click('dvp-next', () => this.events.emit('next', undefined));
    click('dvp-mnext', () => this.events.emit('next', undefined));
    click('dvp-prev', () => this.goPrev());
    click('dvp-mprev', () => this.goPrev());
    click('dvp-mute', () => this.toggleMute());
    click('dvp-fs', () => void this.toggleFullscreen());
    click('dvp-theater', () => this.events.emit('theater', !this.theater));
    click('dvp-cc', () => this.toggleCaptions());
    click('dvp-autoplay', () => {
      this.prefs.autoplay = !this.prefs.autoplay;
      savePrefs(this.prefs);
      this.updateAutoplayButton();
      const tip = this.$['dvp-tooltip']!;
      if (tip.classList.contains('is-visible')) tip.textContent = this.$['dvp-autoplay']!.dataset.tip ?? '';
      this.osd(this.prefs.autoplay ? 'Putar otomatis aktif' : 'Putar otomatis nonaktif');
      this.events.emit('autoplaychange', this.prefs.autoplay);
    });
    click('dvp-settings', () => (this.menuView ? this.closeMenu() : this.openMenu('main')));
    click('dvp-error__retry', () => {
      this.hideError();
      this.retries = 0;
      this.failed.clear();
      void this.refreshSources().then(() => {
        const src = this.chooseSource();
        if (src) this.setSource(src, this.lastTime, true, 1);
      });
    });

    // Tooltip tombol (di atas tombol, di dalam batas pemutar)
    const tip = this.$['dvp-tooltip']!;
    this.root.querySelectorAll<HTMLElement>('[data-tip]').forEach((btn) => {
      btn.addEventListener('mouseenter', () => {
        if (this.menuView || this.root.dataset.touch === 'true') return;
        tip.textContent = btn.dataset.tip ?? '';
        tip.classList.add('is-visible');
        const r = btn.getBoundingClientRect();
        const pr = this.root.getBoundingClientRect();
        const left = Math.max(8, Math.min(r.left - pr.left + r.width / 2 - tip.offsetWidth / 2, pr.width - tip.offsetWidth - 8));
        tip.style.left = `${left}px`;
      });
      btn.addEventListener('mouseleave', () => tip.classList.remove('is-visible'));
    });

    this.bindProgress();
    this.bindVolume();

    // Auto-hide kontrol
    const onMove = () => this.showControls();
    this.root.addEventListener('mousemove', onMove);
    this.root.addEventListener('mouseleave', () => {
      if (!this.video.paused && !this.menuView && !this.dragging) {
        clearTimeout(this.hideTimer);
        this.hideTimer = setTimeout(() => this.root.classList.add('dvp--idle'), 300);
      }
    });
    this.$['dvp-chrome']!.addEventListener('mouseenter', () => clearTimeout(this.hideTimer));
    this.$['dvp-chrome']!.addEventListener('mouseleave', () => this.showControls());
  }

  private goPrev(): void {
    if (this.video.currentTime > 3) this.seek(0);
    else this.events.emit('prev', undefined);
  }

  private setPlayIcon(ended: boolean): void {
    const paused = this.video.paused || this.video.ended;
    const icon: PlayerIcon = ended ? 'replay' : paused ? 'play' : 'pause';
    const label = ended ? 'Putar ulang' : paused ? 'Putar (k)' : 'Jeda (k)';
    for (const cls of ['dvp-play', 'dvp-mplay']) {
      const b = this.$[cls]!;
      b.innerHTML = svg(icon);
      b.setAttribute('aria-label', label.replace(' (k)', ''));
      if (b.dataset.tip !== undefined) b.dataset.tip = label;
    }
  }

  private updateAutoplayButton(): void {
    const b = this.$['dvp-autoplay']!;
    b.setAttribute('aria-checked', String(this.prefs.autoplay));
    b.dataset.tip = this.prefs.autoplay ? 'Putar otomatis aktif' : 'Putar otomatis nonaktif';
    this.root.dataset.autoplay = String(this.prefs.autoplay);
  }

  /** Tampilkan kontrol; sembunyikan otomatis setelah 3 dtk saat bermain. */
  private showControls(sticky = false): void {
    this.root.classList.remove('dvp--idle');
    clearTimeout(this.hideTimer);
    if (sticky || this.video.paused || this.menuView || this.dragging) return;
    this.hideTimer = setTimeout(() => {
      if (!this.video.paused && !this.menuView && !this.dragging) this.root.classList.add('dvp--idle');
    }, 3000);
  }

  private hideControls(): void {
    if (this.video.paused || this.menuView) return;
    clearTimeout(this.hideTimer);
    this.root.classList.add('dvp--idle');
  }

  private setDurationText(d: number): void {
    const dur = Number.isFinite(d) && d > 0 ? d : (this.opts?.durationSec ?? 0);
    this.$['dvp-time__dur']!.textContent = formatDuration(dur) || '0:00';
    this.$['dvp-progress']!.setAttribute('aria-valuemax', String(Math.round(dur)));
  }

  private renderTime(): void {
    this.$['dvp-time__cur']!.textContent = formatDuration(this.dragging ? this.dragFrac * this.duration() : this.video.currentTime) || '0:00';
  }

  // ---------------------------------------------------------------------------
  // Progress bar
  // ---------------------------------------------------------------------------

  private renderProgress(): void {
    const d = this.duration();
    const frac = this.dragging ? this.dragFrac : d ? this.video.currentTime / d : 0;
    const pct = `${Math.max(0, Math.min(1, frac)) * 100}%`;
    this.$['dvp-progress__played']!.style.width = pct;
    this.$['dvp-progress__scrubber']!.style.left = pct;
    this.$['dvp-progress']!.setAttribute('aria-valuenow', String(Math.round(frac * d)));
    this.$['dvp-progress']!.setAttribute('aria-valuetext', `${formatDuration(frac * d)} dari ${formatDuration(d)}`);
    this.renderTime();
  }

  private renderBuffer(): void {
    const v = this.video;
    const d = this.duration();
    if (!d) return;
    let end = 0;
    for (let i = 0; i < v.buffered.length; i++) {
      if (v.buffered.start(i) <= v.currentTime + 0.5) end = Math.max(end, v.buffered.end(i));
    }
    this.$['dvp-progress__buffer']!.style.width = `${Math.min(1, end / d) * 100}%`;
  }

  private fracFromEvent(e: PointerEvent | MouseEvent): number {
    const r = this.$['dvp-progress']!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  }

  private renderPreview(frac: number): void {
    const d = this.duration();
    const prev = this.$['dvp-preview']!;
    const bar = this.$['dvp-progress']!;
    const t = frac * d;
    this.$['dvp-preview__time']!.textContent = formatDuration(t);
    const sb = this.opts?.storyboard;
    const frame = this.$['dvp-preview__frame']!;
    if (sb && sb.count > 0) {
      const scale = this.isFullscreen() ? 1.5 : 1;
      const i = Math.min(sb.count - 1, Math.floor(t / sb.interval));
      const perSheet = sb.cols * sb.rows;
      const sheet = sb.sheets[Math.floor(i / perSheet)];
      const j = i % perSheet;
      frame.style.display = 'block';
      frame.style.width = `${sb.w * scale}px`;
      frame.style.height = `${sb.h * scale}px`;
      frame.style.backgroundImage = sheet ? `url("${sheet}")` : '';
      frame.style.backgroundSize = `${sb.w * sb.cols * scale}px ${sb.h * sb.rows * scale}px`;
      frame.style.backgroundPosition = `-${(j % sb.cols) * sb.w * scale}px -${Math.floor(j / sb.cols) * sb.h * scale}px`;
    } else {
      frame.style.display = 'none';
    }
    const w = prev.offsetWidth;
    const bw = bar.clientWidth;
    const x = Math.max(w / 2, Math.min(frac * bw, bw - w / 2));
    prev.style.left = `${x - w / 2}px`;
    this.$['dvp-progress__hover']!.style.width = `${frac * 100}%`;
  }

  private bindProgress(): void {
    const bar = this.$['dvp-progress']!;
    bar.addEventListener('pointermove', (e) => {
      if (!this.dragging) this.renderPreview(this.fracFromEvent(e));
    });
    bar.addEventListener('pointerenter', () => bar.classList.add('is-hover'));
    bar.addEventListener('pointerleave', () => {
      if (!this.dragging) bar.classList.remove('is-hover');
    });
    bar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      bar.setPointerCapture(e.pointerId);
      this.dragging = true;
      bar.classList.add('is-hover', 'is-dragging');
      this.dragFrac = this.fracFromEvent(e);
      this.renderPreview(this.dragFrac);
      this.renderProgress();
      this.showControls(true);
    });
    bar.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.dragFrac = this.fracFromEvent(e);
      this.renderPreview(this.dragFrac);
      this.renderProgress();
      // Seek langsung (dibatasi) agar frame ikut berubah seperti YouTube.
      const now = Date.now();
      if (now - this.lastDragSeek > 250 && this.root.dataset.touch !== 'true') {
        this.lastDragSeek = now;
        this.video.currentTime = this.dragFrac * this.duration();
      }
    });
    const end = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      bar.classList.remove('is-dragging');
      if (e.type !== 'pointercancel') this.seek(this.fracFromEvent(e) * this.duration());
      if (e.pointerType !== 'mouse') bar.classList.remove('is-hover');
      this.showControls();
    };
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
    bar.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        this.seekBy(e.key === 'ArrowLeft' ? -5 : 5);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Volume
  // ---------------------------------------------------------------------------

  private applyVolumePrefs(): void {
    this.video.volume = this.prefs.volume;
    this.video.muted = this.prefs.muted;
    this.renderVolume();
  }

  private setVolume(vol: number, showOsd = false): void {
    const v = Math.max(0, Math.min(1, Math.round(vol * 100) / 100));
    this.video.volume = v;
    this.video.muted = v === 0;
    this.prefs.volume = v || this.prefs.volume;
    this.prefs.muted = v === 0;
    savePrefs(this.prefs);
    if (showOsd) this.osd(`${Math.round(v * 100)}%`, v === 0 ? 'volumeOff' : v < 0.5 ? 'volumeDown' : 'volumeUp');
  }

  toggleMute(): void {
    const m = !this.video.muted;
    this.video.muted = m;
    if (!m && this.video.volume === 0) this.video.volume = this.prefs.volume || 0.5;
    this.prefs.muted = m;
    savePrefs(this.prefs);
  }

  private renderVolume(): void {
    const v = this.video;
    const level = v.muted ? 0 : v.volume;
    const icon: PlayerIcon = level === 0 ? 'volumeOff' : level < 0.5 ? 'volumeDown' : 'volumeUp';
    const b = this.$['dvp-mute']!;
    b.innerHTML = svg(icon);
    b.dataset.tip = level === 0 ? 'Suarakan (m)' : 'Bisukan (m)';
    b.setAttribute('aria-label', level === 0 ? 'Suarakan' : 'Bisukan');
    this.$['dvp-volume__fill']!.style.width = `${level * 100}%`;
    this.$['dvp-volume__knob']!.style.left = `${level * 100}%`;
    this.$['dvp-volume__slider']!.setAttribute('aria-valuenow', String(Math.round(level * 100)));
  }

  private bindVolume(): void {
    const slider = this.$['dvp-volume__slider']!;
    const track = this.$['dvp-volume__track']!;
    const frac = (e: PointerEvent) => {
      const r = track.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    };
    let dragging = false;
    slider.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      dragging = true;
      slider.setPointerCapture(e.pointerId);
      this.setVolume(frac(e));
      this.root.classList.add('dvp--volume-drag');
    });
    slider.addEventListener('pointermove', (e) => dragging && this.setVolume(frac(e)));
    const stop = () => {
      dragging = false;
      this.root.classList.remove('dvp--volume-drag');
    };
    slider.addEventListener('pointerup', stop);
    slider.addEventListener('pointercancel', stop);
    this.$['dvp-volume']!.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.setVolume((this.video.muted ? 0 : this.video.volume) + (e.deltaY < 0 ? 0.05 : -0.05));
      },
      { passive: false },
    );
    slider.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        const up = e.key === 'ArrowRight' || e.key === 'ArrowUp';
        this.setVolume((this.video.muted ? 0 : this.video.volume) + (up ? 0.05 : -0.05));
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Menu setelan
  // ---------------------------------------------------------------------------

  private openMenu(view: MenuView): void {
    this.menuView = view;
    this.$['dvp-tooltip']!.classList.remove('is-visible');
    this.$['dvp-menu']!.hidden = false;
    this.root.dataset.menu = 'true';
    this.$['dvp-settings']!.classList.add('is-open');
    this.renderMenu();
    this.showControls(true);
  }

  private closeMenu(): void {
    if (!this.menuView) return;
    this.menuView = null;
    this.$['dvp-menu']!.hidden = true;
    this.root.dataset.menu = 'false';
    this.$['dvp-settings']!.classList.remove('is-open');
    this.showControls();
  }

  private qualityValueLabel(): string {
    const cur = this.current ? shortLabel(this.current.label) : '';
    return this.prefs.quality === 'auto' ? `Otomatis${cur ? ` (${cur})` : ''}` : (this.current?.label ?? '');
  }

  private renderMenu(): void {
    const menu = this.$['dvp-menu']!;
    const view = this.menuView;
    if (!view) return;
    const item = (attrs: string, icon: string, label: string, value = '', chevron = false) =>
      `<button type="button" class="dvp-menu__item" role="menuitem" ${attrs}>${icon ? `<span class="dvp-menu__icon">${icon}</span>` : ''}<span class="dvp-menu__label">${label}</span><span class="dvp-menu__value">${value}</span>${chevron ? svg('chevronRight', 'dvp-menu__chevron') : ''}</button>`;
    const option = (attrs: string, label: string, checked: boolean) =>
      `<button type="button" class="dvp-menu__item dvp-menu__option" role="menuitemradio" aria-checked="${checked}" ${attrs}><span class="dvp-menu__check">${checked ? svg('check') : ''}</span><span class="dvp-menu__label">${label}</span></button>`;
    const header = (title: string) => `<button type="button" class="dvp-menu__header" data-back="1">${svg('chevronLeft')}<span>${title}</span></button>`;
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

    let html = '';
    if (view === 'main') {
      const rate = this.longPressActive ? this.rateBeforeLongPress : this.video.playbackRate;
      if (this.opts?.subtitles?.length) {
        html += item('data-go="captions"', svg('cc'), 'Subtitel/CC', this.captionTrack ? esc(this.captionTrack.label) : 'Nonaktif', true);
      }
      html += item('data-go="speed"', svg('speed'), 'Kecepatan pemutaran', rate === 1 ? 'Normal' : String(rate), true);
      html += item('data-go="quality"', svg('tune'), 'Kualitas', esc(this.qualityValueLabel()), true);
      if (document.pictureInPictureEnabled && !this.video.disablePictureInPicture) html += item('data-action="pip"', svg('pip'), 'Picture-in-picture');
    } else if (view === 'speed') {
      const rate = this.longPressActive ? this.rateBeforeLongPress : this.video.playbackRate;
      html += header('Kecepatan pemutaran') + SPEEDS.map((s) => option(`data-speed="${s}"`, s === 1 ? 'Normal' : String(s), Math.abs(rate - s) < 0.01)).join('');
    } else if (view === 'quality') {
      html += header('Kualitas');
      html += this.sources
        .filter((s) => !this.failed.has(s.q))
        .map((s) => option(`data-q="${esc(s.q)}"`, `${esc(s.label)}${s.q === 'compat' ? '' : ''}`, this.prefs.quality !== 'auto' && this.current?.q === s.q))
        .join('');
      html += option('data-q="auto"', esc(this.prefs.quality === 'auto' ? this.qualityValueLabel() : 'Otomatis'), this.prefs.quality === 'auto');
    } else if (view === 'captions') {
      html += header('Subtitel/CC');
      html += option('data-cc="off"', 'Nonaktif', !this.captionTrack);
      html += (this.opts?.subtitles ?? []).map((t) => option(`data-cc="${t.id}"`, esc(t.label), this.captionTrack?.id === t.id)).join('');
    }
    menu.innerHTML = `<div class="dvp-menu__panel dvp-menu__panel--${view}">${html}</div>`;
    menu.style.maxHeight = `${Math.max(120, this.root.clientHeight - 80)}px`;

    menu.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const d = b.dataset;
        if (d.back) this.openMenu('main');
        else if (d.go) this.openMenu(d.go as MenuView);
        else if (d.speed) {
          this.setRate(Number(d.speed));
          this.openMenu('main');
        } else if (d.q) {
          this.setQuality(d.q);
          this.openMenu('main');
          this.closeMenu();
        } else if (d.cc) {
          this.selectCaption(d.cc === 'off' ? null : (this.opts?.subtitles?.find((t) => String(t.id) === d.cc) ?? null));
          this.closeMenu();
        } else if (d.action === 'pip') {
          void this.togglePip();
          this.closeMenu();
        }
      }),
    );
  }

  setRate(r: number): void {
    const rate = Math.max(0.25, Math.min(2, Math.round(r * 100) / 100));
    if (this.longPressActive) this.rateBeforeLongPress = rate;
    else this.video.playbackRate = rate;
    this.osd(rate === 1 ? 'Normal' : `${rate}x`, 'speed');
  }

  async togglePip(): Promise<void> {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await this.video.requestPictureInPicture();
    } catch {
      /* tidak didukung */
    }
  }

  // ---------------------------------------------------------------------------
  // Subtitle (render sendiri agar konsisten di layar penuh custom)
  // ---------------------------------------------------------------------------

  private restoreCaptions(): void {
    const tracks = this.opts?.subtitles ?? [];
    this.captionTrack = null;
    this.updateCcButton();
    if (!tracks.length || !this.prefs.captions.on) return;
    const pick = tracks.find((t) => t.lang === this.prefs.captions.lang) ?? tracks.find((t) => t.isDefault) ?? tracks[0]!;
    void this.loadCaption(pick);
  }

  private toggleCaptions(): void {
    const tracks = this.opts?.subtitles ?? [];
    if (!tracks.length) return;
    if (this.captionTrack) this.selectCaption(null);
    else this.selectCaption(tracks.find((t) => t.lang === this.prefs.captions.lang) ?? tracks.find((t) => t.isDefault) ?? tracks[0]!);
  }

  private selectCaption(track: PlayerTrack | null): void {
    this.prefs.captions = { on: Boolean(track), lang: track?.lang ?? this.prefs.captions.lang };
    savePrefs(this.prefs);
    if (!track) {
      this.captionTrack = null;
      this.cues = [];
      this.renderCaptions(true);
      this.updateCcButton();
      this.osd('Subtitel nonaktif');
      return;
    }
    void this.loadCaption(track).then(() => this.osd(track.label));
  }

  private async loadCaption(track: PlayerTrack): Promise<void> {
    this.captionTrack = track;
    this.updateCcButton();
    try {
      const res = await fetch(track.url, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(String(res.status));
      const text = await res.text();
      if (this.captionTrack?.id !== track.id) return;
      this.cues = parseVtt(text);
      this.renderCaptions(true);
    } catch {
      this.captionTrack = null;
      this.cues = [];
      this.updateCcButton();
      this.osd('Subtitel gagal dimuat');
    }
  }

  private updateCcButton(): void {
    const b = this.$['dvp-cc']!;
    b.setAttribute('aria-pressed', String(Boolean(this.captionTrack)));
    b.classList.toggle('is-on', Boolean(this.captionTrack));
  }

  private renderCaptions(force = false): void {
    const box = this.$['dvp-captions']!;
    const html = this.cues.length ? activeCues(this.cues, this.video.currentTime).map((c) => `<span class="dvp-cue">${c.html}</span>`).join('<br>') : '';
    if (!force && html === this.lastCaptionHtml) return;
    this.lastCaptionHtml = html;
    box.innerHTML = html;
  }

  // ---------------------------------------------------------------------------
  // Gesture klik / tap / tahan (SPEC §16.4)
  // ---------------------------------------------------------------------------

  private zoneOf(e: PointerEvent): 'left' | 'center' | 'right' {
    const r = this.root.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    return x < 0.35 ? 'left' : x > 0.65 ? 'right' : 'center';
  }

  private bindGestures(): void {
    const layer = this.$['dvp-gesture']!;
    let downAt = 0;
    layer.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      downAt = Date.now();
      clearTimeout(this.longPressTimer);
      if (this.video.paused) return;
      this.longPressTimer = setTimeout(() => {
        this.longPressActive = true;
        this.rateBeforeLongPress = this.video.playbackRate;
        this.video.playbackRate = 2;
        this.root.classList.add('dvp--speedup');
      }, LONG_PRESS_MS);
    });
    const endLongPress = () => {
      clearTimeout(this.longPressTimer);
      if (!this.longPressActive) return false;
      this.longPressActive = false;
      this.video.playbackRate = this.rateBeforeLongPress;
      this.root.classList.remove('dvp--speedup');
      return true;
    };
    layer.addEventListener('pointerup', (e) => {
      if (e.button !== 0) return;
      if (endLongPress()) return;
      if (Date.now() - downAt > LONG_PRESS_MS) return;
      this.onTap(e);
    });
    layer.addEventListener('pointercancel', endLongPress);
    layer.addEventListener('pointerleave', endLongPress);
    layer.addEventListener('contextmenu', (e) => {
      if (this.root.dataset.touch === 'true') e.preventDefault();
    });
  }

  private onTap(e: PointerEvent): void {
    const touch = e.pointerType !== 'mouse';
    const zone = this.zoneOf(e);
    const now = Date.now();
    if (this.menuView) {
      this.closeMenu();
      return;
    }

    // Seri double-tap: tap berikutnya di sisi yang sama terus menambah (10 → 20 → 30 dtk).
    if (touch && this.seekStreak && now < this.seekStreak.until && zone === this.seekStreak.side) {
      clearTimeout(this.tapTimer);
      this.lastTap = null;
      this.doubleSeek(zone);
      return;
    }

    if (this.lastTap && now - this.lastTap.t < (touch ? TAP_DELAY_TOUCH + 50 : TAP_DELAY_MOUSE + 50)) {
      clearTimeout(this.tapTimer);
      const first = this.lastTap.zone;
      this.lastTap = null;
      if (zone !== 'center' && first === zone) this.doubleSeek(zone);
      else if (zone === 'center' && first === 'center') {
        if (touch) this.togglePlay();
        else void this.toggleFullscreen();
      }
      return;
    }

    this.lastTap = { t: now, zone };
    clearTimeout(this.tapTimer);
    this.tapTimer = setTimeout(
      () => {
        this.lastTap = null;
        if (!touch) this.togglePlay();
        else if (this.root.classList.contains('dvp--idle')) this.showControls();
        else this.hideControls();
      },
      touch ? TAP_DELAY_TOUCH : TAP_DELAY_MOUSE,
    );
  }

  private doubleSeek(side: 'left' | 'right'): void {
    const now = Date.now();
    const sign = side === 'left' ? -1 : 1;
    if (!this.seekStreak || this.seekStreak.side !== side || now > this.seekStreak.until) this.seekStreak = { side, amount: 0, until: 0 };
    this.seekStreak.amount += this.seekSeconds;
    this.seekStreak.until = now + 700;
    this.seekBy(sign * this.seekSeconds);
    this.ripple(side, this.seekStreak.amount);
  }

  private ripple(side: 'left' | 'right', amount: number): void {
    const el = this.$[`dvp-ripple--${side}`]!;
    const other = this.$[`dvp-ripple--${side === 'left' ? 'right' : 'left'}`]!;
    other.classList.remove('is-active');
    el.querySelector('.dvp-ripple__text')!.textContent = `${amount} detik`;
    el.classList.remove('is-pulse');
    void el.offsetWidth;
    el.classList.add('is-active', 'is-pulse');
    clearTimeout(this.rippleTimer);
    this.rippleTimer = setTimeout(() => {
      el.classList.remove('is-active', 'is-pulse');
      this.seekStreak = null;
    }, 750);
  }

  // ---------------------------------------------------------------------------
  // Keyboard (SPEC §16.5)
  // ---------------------------------------------------------------------------

  private bindDocument(): void {
    const onKey = (e: KeyboardEvent) => this.onKey(e);
    document.addEventListener('keydown', onKey);
    const onFs = () => {
      const fs = this.isFullscreen();
      this.root.dataset.fs = String(fs);
      const b = this.$['dvp-fs']!;
      b.innerHTML = svg(fs ? 'fullscreenExit' : 'fullscreen');
      b.dataset.tip = fs ? 'Keluar dari layar penuh (f)' : 'Layar penuh (f)';
      if (!fs) {
        this.fsByRotation = false;
        try {
          screen.orientation?.unlock?.();
        } catch {
          /* tidak didukung */
        }
      }
      this.events.emit('fullscreenchange', fs);
      this.showControls();
    };
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);
    const onDocDown = (e: PointerEvent) => {
      if (!this.$['dvp-ctxmenu']!.hidden && !this.$['dvp-ctxmenu']!.contains(e.target as Node)) this.closeContextMenu();
      if (!this.menuView) return;
      const t = e.target as Node;
      if (this.$['dvp-menu']!.contains(t) || this.$['dvp-settings']!.contains(t)) return;
      this.closeMenu();
    };
    document.addEventListener('pointerdown', onDocDown, true);
    this.cleanup.push(() => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFs);
      document.removeEventListener('webkitfullscreenchange', onFs);
      document.removeEventListener('pointerdown', onDocDown, true);
    });
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.keyboard || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
    const focusedInPlayer = this.root.contains(document.activeElement) || this.isFullscreen();
    const k = e.key;
    const handled = (fn: () => void) => {
      e.preventDefault();
      fn();
      this.showControls();
    };
    switch (k) {
      case ' ': {
        // Spasi pada tombol/slider yang sedang fokus: biarkan elemen itu yang menangani.
        const tgt = e.target as HTMLElement | null;
        if (tgt && (tgt.tagName === 'BUTTON' || tgt.tagName === 'A' || tgt.closest('[role="slider"]'))) return;
        return handled(() => this.togglePlay());
      }
      case 'k':
      case 'K':
        if (e.shiftKey) return;
        return handled(() => this.togglePlay());
      case 'j':
      case 'J':
        return handled(() => {
          this.seekBy(-this.seekSeconds);
          this.bezel('rewind', `${this.seekSeconds} detik`);
        });
      case 'l':
      case 'L':
        return handled(() => {
          this.seekBy(this.seekSeconds);
          this.bezel('forward', `${this.seekSeconds} detik`);
        });
      case 'ArrowLeft':
        return handled(() => {
          this.seekBy(-5);
          this.bezel('rewind', '5 detik');
        });
      case 'ArrowRight':
        return handled(() => {
          this.seekBy(5);
          this.bezel('forward', '5 detik');
        });
      case 'ArrowUp':
      case 'ArrowDown':
        if (!focusedInPlayer) return;
        return handled(() => this.setVolume((this.video.muted ? 0 : this.video.volume) + (k === 'ArrowUp' ? 0.05 : -0.05), true));
      case 'm':
      case 'M':
        return handled(() => {
          this.toggleMute();
          this.osd(this.video.muted ? 'Bisu' : `${Math.round(this.video.volume * 100)}%`, this.video.muted ? 'volumeOff' : 'volumeUp');
        });
      case 'f':
      case 'F':
        return handled(() => void this.toggleFullscreen());
      case 't':
      case 'T':
        if (this.isFullscreen()) return;
        return handled(() => this.events.emit('theater', !this.theater));
      case 'c':
      case 'C':
        if (!this.opts?.subtitles?.length) return;
        return handled(() => this.toggleCaptions());
      case 'i':
      case 'I':
        return handled(() => void this.togglePip());
      case 'Home':
        return handled(() => this.seek(0));
      case 'End':
        return handled(() => this.seek(this.duration()));
      case 'N':
        if (!e.shiftKey) return;
        return handled(() => this.events.emit('next', undefined));
      case 'P':
        if (!e.shiftKey) return;
        return handled(() => this.goPrev());
      case '>':
        return handled(() => this.setRate((this.longPressActive ? this.rateBeforeLongPress : this.video.playbackRate) + 0.25));
      case '<':
        return handled(() => this.setRate((this.longPressActive ? this.rateBeforeLongPress : this.video.playbackRate) - 0.25));
      case '.':
      case ',':
        if (!this.video.paused) return;
        return handled(() => this.seekBy(k === '.' ? 1 / 30 : -1 / 30));
      case 'Escape':
        if (!this.$['dvp-ctxmenu']!.hidden) return handled(() => this.closeContextMenu());
        if (this.menuView) return handled(() => this.closeMenu());
        return;
      default:
        if (/^[0-9]$/.test(k)) return handled(() => this.seek((Number(k) / 10) * this.duration()));
    }
  }

  // ---------------------------------------------------------------------------
  // Overlay
  // ---------------------------------------------------------------------------

  private bezel(icon: PlayerIcon, text = ''): void {
    const el = this.$['dvp-bezel']!;
    this.$['dvp-bezel__icon']!.innerHTML = svg(icon);
    this.$['dvp-bezel__text']!.textContent = text;
    el.classList.toggle('has-text', Boolean(text));
    el.classList.remove('is-animating');
    void el.offsetWidth;
    el.classList.add('is-animating');
  }

  private osdTimer?: ReturnType<typeof setTimeout>;
  private osd(text: string, icon?: PlayerIcon): void {
    const el = this.$['dvp-osd']!;
    el.innerHTML = `${icon ? svg(icon) : ''}<span>${text.replace(/</g, '&lt;')}</span>`;
    el.classList.add('is-visible');
    clearTimeout(this.osdTimer);
    this.osdTimer = setTimeout(() => el.classList.remove('is-visible'), 900);
  }

  private showSpinner(): void {
    clearTimeout(this.spinnerTimer);
    this.spinnerTimer = setTimeout(() => this.root.classList.add('dvp--buffering'), 300);
  }

  private hideSpinner(): void {
    clearTimeout(this.spinnerTimer);
    this.root.classList.remove('dvp--buffering');
  }

  // ---------------------------------------------------------------------------
  // Layar akhir: hitung mundur autoplay / grid rekomendasi (SPEC §16.9)
  // ---------------------------------------------------------------------------

  private onEndedFlow(): void {
    if (this.video.loop) return;
    const hasNext = this.root.dataset.hasNext === 'true';
    if (this.playlistMode && hasNext) {
      this.events.emit('next', undefined);
      return;
    }
    if (this.prefs.autoplay && this.upNext && hasNext) {
      if (this.countdownSec <= 0) this.events.emit('next', undefined);
      else this.showCountdown(this.upNext);
      return;
    }
    this.showEndGrid();
  }

  private showCountdown(item: UpNextItem): void {
    const box = this.$['dvp-endscreen']!;
    const total = this.countdownSec;
    let left = total;
    box.className = 'dvp-endscreen is-countdown';
    box.innerHTML = `
      <div class="dvp-upnext">
        <div class="dvp-upnext__label">Berikutnya dalam <span class="dvp-upnext__sec">${left}</span></div>
        <div class="dvp-upnext__body">
          <button type="button" class="dvp-upnext__thumb" data-act="playnow" aria-label="Putar sekarang">
            ${item.thumb ? `<img src="${escHtml(item.thumb)}" alt="" />` : ''}
            <svg class="dvp-upnext__ring" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="28" style="animation-duration:${total}s"/></svg>
            <span class="dvp-upnext__play">${svg('play')}</span>
            ${item.durationSec ? `<span class="dvp-upnext__dur">${formatDuration(item.durationSec)}</span>` : ''}
          </button>
          <div class="dvp-upnext__meta">
            <div class="dvp-upnext__title">${escHtml(item.title)}</div>
            <div class="dvp-upnext__channel">${escHtml(item.channelName)}</div>
          </div>
        </div>
        <div class="dvp-upnext__actions">
          <button type="button" class="dvp-upnext__btn" data-act="cancel">Batal</button>
          <button type="button" class="dvp-upnext__btn is-primary" data-act="playnow">Putar sekarang</button>
        </div>
      </div>`;
    box.hidden = false;
    this.root.dataset.endscreen = 'countdown';
    clearInterval(this.countdownTimer);
    this.countdownTimer = setInterval(() => {
      left -= 1;
      const sec = box.querySelector('.dvp-upnext__sec');
      if (sec) sec.textContent = String(Math.max(0, left));
      if (left <= 0) {
        clearInterval(this.countdownTimer);
        this.events.emit('next', undefined);
      }
    }, 1000);
  }

  private showEndGrid(): void {
    const items = this.endItems.length ? this.endItems : this.upNext ? [this.upNext] : [];
    const box = this.$['dvp-endscreen']!;
    clearInterval(this.countdownTimer);
    if (!items.length) {
      this.hideEndscreen();
      return;
    }
    box.className = 'dvp-endscreen is-grid';
    box.innerHTML = `
      <div class="dvp-endgrid">
        ${items
          .map(
            (it) => `<button type="button" class="dvp-endgrid__item" data-id="${escHtml(it.id)}">
              <span class="dvp-endgrid__thumb">${it.thumb ? `<img src="${escHtml(it.thumb)}" alt="" loading="lazy" />` : ''}${
                it.durationSec ? `<span class="dvp-endgrid__dur">${formatDuration(it.durationSec)}</span>` : ''
              }</span>
              <span class="dvp-endgrid__title">${escHtml(it.title)}</span>
              <span class="dvp-endgrid__channel">${escHtml(it.channelName)}</span>
            </button>`,
          )
          .join('')}
      </div>`;
    box.hidden = false;
    this.root.dataset.endscreen = 'grid';
  }

  private hideEndscreen(): void {
    clearInterval(this.countdownTimer);
    const box = this.$['dvp-endscreen']!;
    if (box.hidden) return;
    box.hidden = true;
    box.innerHTML = '';
    delete this.root.dataset.endscreen;
  }

  private bindEndscreen(): void {
    const box = this.$['dvp-endscreen']!;
    box.addEventListener('click', (e) => {
      e.stopPropagation();
      const t = e.target as HTMLElement;
      const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
      const id = t.closest<HTMLElement>('[data-id]')?.dataset.id;
      if (act === 'playnow') {
        clearInterval(this.countdownTimer);
        this.events.emit('next', undefined);
      } else if (act === 'cancel') {
        this.showEndGrid();
      } else if (id) {
        this.hideEndscreen();
        this.events.emit('select', id);
      }
    });
    box.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  // ---------------------------------------------------------------------------
  // Menu klik kanan (SPEC §16.4)
  // ---------------------------------------------------------------------------

  private videoUrl(withTime: boolean): string {
    const base = this.opts?.shareUrl ?? `${location.origin}/watch?v=${this.opts?.videoId ?? ''}`;
    if (!withTime) return base;
    return `${base}${base.includes('?') ? '&' : '?'}t=${Math.floor(this.video.currentTime)}`;
  }

  private async copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } finally {
        ta.remove();
      }
    }
    this.osd('Disalin ke papan klip', 'link');
  }

  private openContextMenu(x: number, y: number): void {
    const menu = this.$['dvp-ctxmenu']!;
    const item = (act: string, icon: PlayerIcon, label: string, checked?: boolean) =>
      `<button type="button" class="dvp-ctxmenu__item" role="${checked === undefined ? 'menuitem' : 'menuitemcheckbox'}" ${
        checked === undefined ? '' : `aria-checked="${checked}"`
      } data-act="${act}">${svg(icon)}<span>${label}</span>${checked ? svg('check', 'dvp-ctxmenu__check') : ''}</button>`;
    menu.innerHTML =
      item('loop', 'loop', 'Ulangi', this.video.loop) +
      item('copy', 'link', 'Salin URL video') +
      item('copytime', 'link', 'Salin URL video pada waktu saat ini');
    menu.hidden = false;
    const r = this.root.getBoundingClientRect();
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    menu.style.left = `${Math.max(4, Math.min(x - r.left, r.width - mw - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y - r.top, r.height - mh - 4))}px`;
    this.showControls(true);
  }

  private closeContextMenu(): void {
    const menu = this.$['dvp-ctxmenu'];
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    this.showControls();
  }

  private bindContextMenu(): void {
    const menu = this.$['dvp-ctxmenu']!;
    this.root.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.root.dataset.touch === 'true') return;
      this.closeMenu();
      this.openContextMenu(e.clientX, e.clientY);
    });
    menu.addEventListener('pointerdown', (e) => e.stopPropagation());
    menu.addEventListener('click', (e) => {
      e.stopPropagation();
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'loop') {
        this.video.loop = !this.video.loop;
        this.osd(this.video.loop ? 'Ulangi aktif' : 'Ulangi nonaktif', 'loop');
      } else if (act === 'copy') void this.copy(this.videoUrl(false));
      else if (act === 'copytime') void this.copy(this.videoUrl(true));
      this.closeContextMenu();
    });
  }

  // ---------------------------------------------------------------------------
  // Media Session & Wake Lock (SPEC §16.9)
  // ---------------------------------------------------------------------------

  private mediaAction(action: MediaSessionAction, handler: MediaSessionActionHandler | null): void {
    try {
      navigator.mediaSession?.setActionHandler(action, handler);
    } catch {
      /* aksi tidak didukung browser ini */
    }
  }

  private bindMediaSession(): void {
    if (!('mediaSession' in navigator)) return;
    this.mediaAction('play', () => this.play());
    this.mediaAction('pause', () => this.pause());
    this.mediaAction('seekbackward', (d) => this.seekBy(-(d.seekOffset ?? this.seekSeconds)));
    this.mediaAction('seekforward', (d) => this.seekBy(d.seekOffset ?? this.seekSeconds));
    this.mediaAction('seekto', (d) => {
      if (d.seekTime == null) return;
      if (d.fastSeek && typeof this.video.fastSeek === 'function') this.video.fastSeek(d.seekTime);
      else this.seek(d.seekTime);
    });
    this.updateMediaSessionHandlers();
  }

  private updateMediaSessionHandlers(): void {
    if (!('mediaSession' in navigator)) return;
    const hasPrev = this.root.dataset.hasPrev === 'true';
    const hasNext = this.root.dataset.hasNext === 'true';
    this.mediaAction('previoustrack', hasPrev ? () => this.goPrev() : null);
    this.mediaAction('nexttrack', hasNext ? () => this.events.emit('next', undefined) : null);
  }

  private updateMediaSession(): void {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined' || !this.opts) return;
    const artwork: MediaImage[] = [];
    if (this.opts.artwork) artwork.push({ src: this.opts.artwork, sizes: '480x270', type: 'image/webp' });
    if (this.opts.poster) artwork.push({ src: this.opts.poster, sizes: '1280x720', type: 'image/webp' });
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: this.opts.title, artist: this.opts.channelName ?? '', artwork });
    } catch {
      /* abaikan */
    }
    this.updateMediaSessionHandlers();
  }

  private updatePositionState(): void {
    this.lastPositionState = Date.now();
    const ms = navigator.mediaSession;
    const d = this.video.duration;
    if (!ms?.setPositionState || !Number.isFinite(d) || d <= 0) return;
    try {
      ms.setPositionState({ duration: d, playbackRate: this.video.playbackRate || 1, position: Math.min(d, Math.max(0, this.video.currentTime)) });
    } catch {
      /* abaikan */
    }
  }

  private setMediaPlaybackState(state: MediaSessionPlaybackState): void {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = state;
    this.updatePositionState();
  }

  private clearMediaSession(): void {
    if (!('mediaSession' in navigator)) return;
    for (const a of ['play', 'pause', 'seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack'] as MediaSessionAction[]) this.mediaAction(a, null);
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = 'none';
  }

  private async requestWakeLock(): Promise<void> {
    if (!('wakeLock' in navigator) || this.wakeLock || document.visibilityState !== 'visible') return;
    try {
      const sentinel = await navigator.wakeLock.request('screen');
      if (this.video.paused || this.destroyed) {
        await sentinel.release();
        return;
      }
      this.wakeLock = sentinel;
      sentinel.addEventListener('release', () => {
        if (this.wakeLock === sentinel) this.wakeLock = null;
      });
    } catch {
      /* ditolak (mis. hemat baterai) */
    }
  }

  private async releaseWakeLock(): Promise<void> {
    const w = this.wakeLock;
    this.wakeLock = null;
    try {
      await w?.release();
    } catch {
      /* sudah dilepas */
    }
  }

  // ---------------------------------------------------------------------------
  // Rotasi HP → layar penuh otomatis (SPEC §16.8, best effort)
  // ---------------------------------------------------------------------------

  private bindOrientation(): void {
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !this.video.paused) void this.requestWakeLock();
    };
    document.addEventListener('visibilitychange', onVisibility);
    this.cleanup.push(() => document.removeEventListener('visibilitychange', onVisibility));
    if (this.root.dataset.touch !== 'true') return;
    const o = screen.orientation as (ScreenOrientation & EventTarget) | undefined;
    const handler = () => {
      const landscape = o?.type ? o.type.startsWith('landscape') : window.innerWidth > window.innerHeight;
      const v = this.video;
      if (landscape) {
        const videoLandscape = (v.videoWidth || 16) >= (v.videoHeight || 9);
        const r = this.root.getBoundingClientRect();
        const visible = r.bottom > 0 && r.top < window.innerHeight;
        if (this.isFullscreen() || !videoLandscape || v.paused || !visible) return;
        const el = this.root as ElFs;
        try {
          const req = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen?.();
          Promise.resolve(req)
            .then(() => {
              this.fsByRotation = this.isFullscreen();
            })
            .catch(() => {});
        } catch {
          /* browser menolak tanpa interaksi user */
        }
      } else if (this.isFullscreen() && this.fsByRotation) {
        this.fsByRotation = false;
        const d = document as DocFs;
        void Promise.resolve(d.exitFullscreen?.() ?? d.webkitExitFullscreen?.()).catch(() => {});
      }
    };
    if (o?.addEventListener) {
      o.addEventListener('change', handler);
      this.cleanup.push(() => o.removeEventListener('change', handler));
    } else {
      window.addEventListener('orientationchange', handler);
      this.cleanup.push(() => window.removeEventListener('orientationchange', handler));
    }
  }

  private lockOrientation(): void {
    if (this.root.dataset.touch !== 'true') return;
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    if (!o?.lock) return;
    const portrait = this.video.videoHeight > this.video.videoWidth;
    o.lock(portrait ? 'portrait' : 'landscape').catch(() => {});
  }
}
