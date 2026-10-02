import { useQuery, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiGet } from '../lib/api';
import { useTheme, type ThemePref } from '../stores/theme';

export interface SiteInfo {
  name: string;
  logoUrl: string | null;
  logoDarkUrl: string | null;
  /** icon: gambar menggantikan ikon bulat + nama situs ditulis; full: gambar = seluruh logo. */
  logoMode: 'icon' | 'full';
  faviconUrl: string | null;
  touchIconUrl: string | null;
  channelName: string;
  channelHandle: string;
  defaultTheme: ThemePref;
  guestPlaylists: boolean;
  uploadEnabled: boolean;
}

export const DEFAULT_SITE_NAME = 'GDrive Tube';

const FALLBACK: SiteInfo = {
  name: DEFAULT_SITE_NAME,
  logoUrl: null,
  logoDarkUrl: null,
  logoMode: 'icon',
  faviconUrl: null,
  touchIconUrl: null,
  channelName: DEFAULT_SITE_NAME,
  channelHandle: 'gdrivetube',
  defaultTheme: 'system',
  guestPlaylists: true,
  uploadEnabled: true,
};

/** Data situs yang disisipkan server ke index.html (<script type="application/json" id="dv-site">). */
function readBoot(): SiteInfo | undefined {
  try {
    const el = typeof document !== 'undefined' ? document.getElementById('dv-site') : null;
    if (!el?.textContent) return undefined;
    return { ...FALLBACK, ...(JSON.parse(el.textContent) as Partial<SiteInfo>) };
  } catch {
    return undefined;
  }
}
const BOOT = readBoot();

export function useSite(): SiteInfo {
  const { data } = useQuery({
    queryKey: ['site'],
    queryFn: ({ signal }) => apiGet<SiteInfo>('/site', signal),
    staleTime: 5 * 60_000,
    initialData: BOOT,
  });
  return data ?? FALLBACK;
}

/** Setelah admin mengubah nama/logo: perbarui cache agar masthead & judul langsung berubah. */
export function setSiteCache(qc: QueryClient, site: SiteInfo): void {
  qc.setQueryData(['site'], site);
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
    if (!link) return;
    link.href = site.faviconUrl ?? '/favicon.svg';
    link.type = site.faviconUrl ? 'image/png' : 'image/svg+xml';
  }, [site.faviconUrl]);
}

/** Set judul dokumen: "<judul> - <nama situs>". */
export function useDocumentTitle(title?: string | null): void {
  const site = useSite();
  useEffect(() => {
    document.title = title ? `${title} - ${site.name}` : site.name;
  }, [title, site.name]);
}
