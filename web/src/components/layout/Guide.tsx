import { useEffect } from 'react';
import { Link, useLocation } from 'react-router';
import { useSite } from '../../hooks/useSite';
import { t } from '../../i18n/id';
import { useSession } from '../../stores/session';
import { useUi } from '../../stores/ui';
import { Icon, type IconName } from '../icons/Icon';
import { IconButton } from '../ui/Button';
import { LoginButton } from './AccountMenu';
import { Logo } from './Logo';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  activeIcon?: IconName;
  match?: (path: string, search: string) => boolean;
}

function useActive() {
  const { pathname, search } = useLocation();
  return (item: NavItem) => (item.match ? item.match(pathname, search) : pathname === item.to);
}

const HOME: NavItem = { to: '/', label: t.nav.home, icon: 'home', activeIcon: 'home-filled' };
const EXPLORE: NavItem = { to: '/feed/playlists/public', label: t.nav.explorePlaylists, icon: 'explore' };

function GuideEntry({ item, active, onNavigate }: { item: NavItem; active: boolean; onNavigate?: () => void }) {
  return (
    <Link to={item.to} className={`dv-guide-entry${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined} onClick={onNavigate}>
      <Icon name={active && item.activeIcon ? item.activeIcon : item.icon} />
      <span className="dv-guide-entry__label">{item.label}</span>
    </Link>
  );
}

/** Isi guide 240px (dipakai di guide permanen & drawer). */
export function GuideContent({ onNavigate }: { onNavigate?: () => void }) {
  const user = useSession((s) => s.user);
  const site = useSite();
  const isActive = useActive();

  const youItems: NavItem[] = [
    { to: '/feed/history', label: t.nav.history, icon: 'history' },
    { to: '/feed/playlists', label: t.nav.playlists, icon: 'library', activeIcon: 'library-filled' },
  ];
  if (user) youItems.push({ to: '/my/videos', label: t.nav.yourVideos, icon: 'your-videos' });

  return (
    <nav className="dv-guide-content" aria-label="Navigasi utama">
      <div className="dv-guide-section">
        {[HOME, EXPLORE].map((item) => (
          <GuideEntry key={item.to} item={item} active={isActive(item)} onNavigate={onNavigate} />
        ))}
      </div>
      <div className="dv-guide-section">
        <Link to="/feed/you" className={`dv-guide-heading${isActive({ to: '/feed/you', label: '', icon: 'home' }) ? ' is-active' : ''}`} onClick={onNavigate}>
          <span>{t.nav.you}</span>
          <Icon name="chevron-right" size={20} />
        </Link>
        {youItems.map((item) => (
          <GuideEntry key={item.to} item={item} active={isActive(item)} onNavigate={onNavigate} />
        ))}
      </div>
      {!user && (
        <div className="dv-guide-section dv-guide-signin">
          <p>{t.account.guestPrompt}</p>
          <LoginButton />
        </div>
      )}
      {user?.role === 'admin' && (
        <div className="dv-guide-section">
          <GuideEntry item={{ to: '/admin', label: t.nav.admin, icon: 'admin', match: (p) => p.startsWith('/admin') }} active={isActive({ to: '/admin', label: '', icon: 'admin', match: (p) => p.startsWith('/admin') })} onNavigate={onNavigate} />
        </div>
      )}
      <footer className="dv-guide-footer">© {new Date().getFullYear()} {site.name}</footer>
    </nav>
  );
}

/** Guide permanen 240px (layar ≥1313px). */
export function Guide() {
  return (
    <aside className="dv-guide">
      <GuideContent />
    </aside>
  );
}

/** Mini-guide 72px. */
export function MiniGuide() {
  const isActive = useActive();
  const items: NavItem[] = [HOME, { ...EXPLORE, label: 'Jelajahi' }, { to: '/feed/you', label: t.nav.you, icon: 'account-circle', match: (p) => p.startsWith('/feed/you') || p === '/feed/history' || p === '/feed/playlists' }];
  return (
    <nav className="dv-mini-guide" aria-label="Navigasi utama">
      {items.map((item) => {
        const active = isActive(item);
        return (
          <Link key={item.to} to={item.to} className={`dv-mini-guide__entry${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined}>
            <Icon name={active && item.activeIcon ? item.activeIcon : item.icon} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/** Drawer overlay (layar sempit & halaman tonton). */
export function GuideDrawer() {
  const open = useUi((s) => s.drawerOpen);
  const setDrawer = useUi((s) => s.setDrawer);
  const location = useLocation();

  useEffect(() => {
    setDrawer(false);
  }, [location.pathname, location.search, setDrawer]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, setDrawer]);

  return (
    <>
      <div className={`dv-drawer-scrim${open ? ' is-open' : ''}`} onClick={() => setDrawer(false)} aria-hidden="true" />
      <aside className={`dv-drawer${open ? ' is-open' : ''}`} aria-hidden={!open} inert={!open}>
        <div className="dv-drawer__header">
          <IconButton icon="menu" label={t.nav.menu} onClick={() => setDrawer(false)} />
          <Logo onClick={() => setDrawer(false)} />
        </div>
        <div className="dv-drawer__body">
          <GuideContent onNavigate={() => setDrawer(false)} />
        </div>
      </aside>
    </>
  );
}

/** Navigasi bawah (mobile ≤656px). */
export function MobileNav() {
  const { pathname } = useLocation();
  const user = useSession((s) => s.user);
  const items: { to: string; label: string; icon: IconName; activeIcon?: IconName; active: boolean; big?: boolean }[] = [
    { to: '/', label: t.nav.home, icon: 'home', activeIcon: 'home-filled', active: pathname === '/' },
    { to: user ? '/my/videos?upload=1' : '/login?next=%2Fmy%2Fvideos%3Fupload%3D1', label: '', icon: 'add-circle', active: false, big: true },
    { to: '/feed/you', label: t.nav.you, icon: 'account-circle', active: pathname.startsWith('/feed') || pathname === '/my/videos' },
  ];
  return (
    <nav className="dv-mobile-nav" aria-label="Navigasi">
      {items.map((it) => (
        <Link key={it.to} to={it.to} className={`dv-mobile-nav__item${it.active ? ' is-active' : ''}${it.big ? ' is-big' : ''}`} aria-label={it.big ? t.nav.upload : undefined}>
          <Icon name={it.active && it.activeIcon ? it.activeIcon : it.icon} size={it.big ? 36 : 24} />
          {it.label && <span>{it.label}</span>}
        </Link>
      ))}
    </nav>
  );
}
