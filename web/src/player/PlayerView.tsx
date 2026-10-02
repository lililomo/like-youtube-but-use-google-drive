import { useEffect, useRef, type MutableRefObject } from 'react';
import { apiGet } from '../lib/api';
import type { VideoDetail } from '../lib/types';
import { Player, type PlayerLoadOptions, type PlayerSource } from './Player';
import './player.css';

export interface PlayerViewProps {
  detail: VideoDetail;
  autoplay?: boolean;
  startAt?: number;
  hasPrev?: boolean;
  hasNext?: boolean;
  theater?: boolean;
  keyboard?: boolean;
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
    return () => {
      p.destroy();
      player.current = null;
      if (handlers.current.playerRef) handlers.current.playerRef.current = null;
    };
  }, []);

  const { detail, autoplay = true, startAt, hasPrev, hasNext, theater, keyboard = true } = props;
  useEffect(() => {
    player.current?.load(toLoadOptions(detail, { autoplay, startAt, hasPrev, hasNext }));
    // Hanya saat video berganti; refetch detail tidak memuat ulang pemutar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.id]);
  useEffect(() => player.current?.setNavigation(Boolean(hasPrev), Boolean(hasNext)), [hasPrev, hasNext]);
  useEffect(() => player.current?.setTheater(Boolean(theater)), [theater]);
  useEffect(() => player.current?.setKeyboardEnabled(keyboard), [keyboard]);

  return <div ref={host} className="dv-player-host" />;
}
