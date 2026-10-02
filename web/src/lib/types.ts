export interface Channel {
  name: string;
  handle: string;
  avatarColor: string;
  avatarUrl: string | null;
}

export interface VideoSummary {
  id: string;
  title: string;
  durationSec: number | null;
  thumb: { sd: string; hd: string } | null;
  channel: Channel;
  views: number;
  publishedAt: string;
  visibility: 'public' | 'private';
  status?: 'pending' | 'processing' | 'ready' | 'failed' | 'missing';
  category: { slug: string; name: string } | null;
  progressSec?: number;
}

export interface Source {
  q: string;
  label: string;
  height: number;
  width: number;
  url: string;
  mime: string;
  bitrateKbps: number | null;
  isOriginal: boolean;
}

export interface Storyboard {
  v: 1;
  interval: number;
  w: number;
  h: number;
  cols: number;
  rows: number;
  count: number;
  sheets: string[];
}

export interface SubtitleTrack {
  id: number;
  lang: string | null;
  label: string;
  url: string;
  isDefault: boolean;
}

export interface VideoDetail extends VideoSummary {
  width: number;
  height: number;
  sources: Source[];
  sourcesExpireAt: string;
  subtitles: SubtitleTrack[];
  storyboard: Storyboard | null;
  canEdit: boolean;
  resumeSec: number | null;
  processing: boolean;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface Category {
  slug: string;
  name: string;
  path: string;
  depth: number;
  parentSlug: string | null;
  videoCount: number;
}
