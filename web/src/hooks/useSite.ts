import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiGet } from '../lib/api';
import { useTheme, type ThemePref } from '../stores/theme';

export interface SiteInfo {
  name: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  channelName: string;
  channelHandle: string;
  defaultTheme: ThemePref;
  guestPlaylists: boolean;
  uploadEnabled: boolean;
}

const FALLBACK: SiteInfo = {
  name: 'Dymas Video',
  logoUrl: null,
  faviconUrl: null,
  channelName: 'Dymas Video',
  channelHandle: 'dymasvideo',
  defaultTheme: 'system',
  guestPlaylists: true,
  uploadEnabled: true,
};

export function useSite(): SiteInfo {
  const { data } = useQuery({ queryKey: ['site'], queryFn: ({ signal }) => apiGet<SiteInfo>('/site', signal), staleTime: 5 * 60_000 });
  return data ?? FALLBACK;
}

/** Terapkan tema default situs & favicon setelah info situs dimuat. */
export function useSiteEffects(): void {
  const site = useSite();
  const applySiteDefault = useTheme((s) => s.applySiteDefault);
  useEffect(() => {
    applySiteDefault(site.defaultTheme);
  }, [site.defaultTheme, applySiteDefault]);
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (link && site.faviconUrl) link.href = site.faviconUrl;
  }, [site.faviconUrl]);
}

/** Set judul dokumen: "<judul> - <nama situs>". */
export function useDocumentTitle(title?: string | null): void {
  const site = useSite();
  useEffect(() => {
    document.title = title ? `${title} - ${site.name}` : site.name;
  }, [title, site.name]);
}
