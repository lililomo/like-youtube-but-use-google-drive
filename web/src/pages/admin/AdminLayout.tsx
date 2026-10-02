import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { Icon, type IconName } from '../../components/icons/Icon';
import { AccountMenu } from '../../components/layout/AccountMenu';
import { Logo } from '../../components/layout/Logo';
import { IconButton } from '../../components/ui/Button';
import { Avatar } from '../../components/ui/misc';
import { useBreakpoints } from '../../hooks/useMediaQuery';
import { t } from '../../i18n/id';
import { useSession } from '../../stores/session';
import '../../styles/admin.css';

interface Item {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
}

const ITEMS: Item[] = [
  { to: '/admin', label: t.admin.dashboard, icon: 'dashboard', end: true },
  { to: '/admin/users', label: t.admin.users, icon: 'group' },
  { to: '/admin/videos', label: t.admin.videos, icon: 'your-videos' },
  { to: '/admin/playlists', label: t.admin.playlists, icon: 'playlist-play' },
  { to: '/admin/jobs', label: t.admin.jobs, icon: 'list' },
];

const SETTINGS: Item[] = [
  { to: '/admin/settings/drive', label: t.admin.drive, icon: 'cloud' },
  { to: '/admin/settings/site', label: t.admin.site, icon: 'settings' },
  { to: '/admin/settings/processing', label: t.admin.processing, icon: 'sync' },
  { to: '/admin/settings/upload', label: t.admin.upload, icon: 'upload-outline' },
  { to: '/admin/settings/player', label: t.admin.player, icon: 'play-arrow' },
  { to: '/admin/settings/security', label: t.admin.security, icon: 'lock' },
];

/** Layout "Studio" untuk panel admin (gaya YouTube Studio). */
export function AdminLayout() {
  const user = useSession((s) => s.user)!;
  const { mid } = useBreakpoints();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const showSidebar = mid || open;

  return (
    <div className="dv-studio">
      <header className="dv-studio__masthead">
        <div className="dv-studio__start">
          {!mid && <IconButton icon="menu" label={t.nav.menu} onClick={() => setOpen(!open)} />}
          <Logo />
          <span className="dv-studio__badge">{t.admin.studio}</span>
        </div>
        <div className="dv-studio__end">
          <AccountMenu />
        </div>
      </header>
      {showSidebar && (
        <>
          {!mid && <div className="dv-drawer-scrim is-open" onClick={() => setOpen(false)} />}
          <aside className={`dv-studio__sidebar${!mid ? ' is-overlay' : ''}`} key={!mid ? location.pathname : 'static'}>
            <div className="dv-studio__channel">
              <Avatar name={user.displayName} color={user.avatarColor} size={mid ? 112 : 64} />
              <div className="dv-studio__channel-label">Admin</div>
              <div className="dv-studio__channel-name">{user.displayName}</div>
            </div>
            <nav className="dv-studio__nav" onClick={() => setOpen(false)}>
              {ITEMS.map((it) => (
                <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => `dv-studio__item${isActive ? ' is-active' : ''}`}>
                  <Icon name={it.icon} />
                  <span>{it.label}</span>
                </NavLink>
              ))}
              <div className="dv-studio__group">{t.admin.settings}</div>
              {SETTINGS.map((it) => (
                <NavLink key={it.to} to={it.to} className={({ isActive }) => `dv-studio__item${isActive ? ' is-active' : ''}`}>
                  <Icon name={it.icon} />
                  <span>{it.label}</span>
                </NavLink>
              ))}
              <NavLink to="/admin/audit" className={({ isActive }) => `dv-studio__item${isActive ? ' is-active' : ''}`}>
                <Icon name="description" />
                <span>{t.admin.audit}</span>
              </NavLink>
              <div className="dv-studio__divider" />
              <NavLink to="/" className="dv-studio__item">
                <Icon name="arrow-back" />
                <span>{t.admin.backToSite}</span>
              </NavLink>
            </nav>
          </aside>
        </>
      )}
      <main className="dv-studio__main">
        <Outlet />
      </main>
    </div>
  );
}
