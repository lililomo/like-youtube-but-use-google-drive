import { useEffect, useRef, type MutableRefObject } from 'react';
import { apiGet } from '../lib/api';
import type { VideoDetail } from '../lib/types';
import { useSite } from '../hooks/useSite';
import { Player, type PlayerLoadOptions, type PlayerSource, type UpNextItem } from './Player';
import './player.css';

export interface PlayerViewProps {
  detail: VideoDetail;
  autoplay?: boolean;
  startAt?: number;
  hasPrev?: boolean;
  hasNext?: boolean;
  theater?: boolean;
  keyboard?: boolean;
  /** Video berikutnya untuk hitung mundur autoplay. */
  upNext?: UpNextItem | null;
  /** Rekomendasi untuk grid layar akhir. */
  endscreen?: UpNextItem[];
  /** Menonton dari playlist: lanjut tanpa hitung mundur. */
  playlistMode?: boolean;
  onSelect?: (id: string) => void;
  onEnded?: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  onTheater?: (on: boolean) => void;
  onProgress?: (p: { position: number; duration: number }) => void;
  onViewQualified?: () => void;
  onAutoplayChange?: (on: boolean) => void;
  playerRef?: MutableRefObject<Player | null>;
}

export function toLoadOptions(d: VideoDetail, extra: Partial<PlayerLoadOptions> = {}): PlayerLoadOptions {
  return {
    videoId: d.id,
    shareUrl: `${location.origin}/watch?v=${d.id}`,
    title: d.title,
    channelName: d.channel.name,
    poster: d.thumb?.hd ?? null,
    artwork: d.thumb?.sd ?? null,
    sources: d.sources as PlayerSource[],
    sourcesExpireAt: d.sourcesExpireAt,
    subtitles: d.subtitles,
    storyboard: d.storyboard,
    durationSec: d.durationSec,
    refreshSources: () => apiGet<{ sources: PlayerSource[]; sourcesExpireAt: string }>(`/videos/${d.id}/sources`),
    ...extra,
  };
}

/**
 * Pembungkus React: instance Player dibuat sekali; saat video berganti cukup load()
 * sehingga elemen video & layar penuh tetap bertahan.
 */
export function PlayerView(props: PlayerViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<Player | null>(null);
  const handlers = useRef(props);
  handlers.current = props;

  useEffect(() => {
    const p = new Player(host.current!);
    player.current = p;
    if (handlers.current.playerRef) handlers.current.playerRef.current = p;
    p.on('ended', () => handlers.current.onEnded?.());
    p.on('next', () => handlers.current.onNext?.());
    p.on('prev', () => handlers.current.onPrev?.());
    p.on('theater', (on) => handlers.current.onTheater?.(on));
    p.on('progress', (pr) => handlers.current.onProgress?.(pr));
    p.on('viewqualified', () => handlers.current.onViewQualified?.());
    p.on('autoplaychange', (on) => handlers.current.onAutoplayChange?.(on));
    p.on('select', (id) => handlers.current.onSelect?.(id));
    return () => {
      p.destroy();
      player.current = null;
      if (handlers.current.playerRef) handlers.current.playerRef.current = null;
    };
  }, []);

  const site = useSite();
  const { detail, autoplay = true, startAt, hasPrev, hasNext, theater, keyboard = true, upNext = null, endscreen, playlistMode = false } = props;
  useEffect(
    () =>
      player.current?.configure({
        seekSeconds: site.player.seekSeconds,
        countdown: site.player.endscreenCountdown,
        autoplayDefault: site.player.autoplayDefault,
      }),
    [site.player.seekSeconds, site.player.endscreenCountdown, site.player.autoplayDefault],
  );
  useEffect(() => {
    player.current?.load(toLoadOptions(detail, { autoplay, startAt, hasPrev, hasNext }));
    // Hanya saat video berganti; refetch detail tidak memuat ulang pemutar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.id]);
  useEffect(() => player.current?.setNavigation(Boolean(hasPrev), Boolean(hasNext)), [hasPrev, hasNext]);
  useEffect(() => player.current?.setTheater(Boolean(theater)), [theater]);
  useEffect(() => player.current?.setKeyboardEnabled(keyboard), [keyboard]);
  useEffect(() => player.current?.setUpNext(upNext), [upNext]);
  useEffect(() => player.current?.setEndscreenItems(endscreen ?? []), [endscreen]);
  useEffect(() => player.current?.setPlaylistMode(playlistMode), [playlistMode]);

  return <div ref={host} className="dv-player-host" />;
}

/** Ringkasan video → item layar akhir pemutar. */
export function toUpNext(v: { id: string; title: string; durationSec: number | null; thumb: { sd: string } | null; channel: { name: string } }): UpNextItem {
  return { id: v.id, title: v.title, channelName: v.channel.name, thumb: v.thumb?.sd ?? null, durationSec: v.durationSec };
}
