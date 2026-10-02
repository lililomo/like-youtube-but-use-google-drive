import { useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { t } from '../../i18n/id';
import { useSession } from '../../stores/session';
import { useTheme, type ThemePref } from '../../stores/theme';
import { toast } from '../../stores/toast';
import { Icon } from '../icons/Icon';
import { IconButton } from '../ui/Button';
import { Avatar } from '../ui/misc';
import { MenuDivider, MenuItem, Popup } from '../ui/Popup';

function ThemeSubmenu({ onBack }: { onBack: () => void }) {
  const pref = useTheme((s) => s.pref);
  const setPref = useTheme((s) => s.setPref);
  const options: [ThemePref, string][] = [
    ['system', t.account.themeSystem],
    ['dark', t.account.themeDark],
    ['light', t.account.themeLight],
  ];
  return (
    <div className="dv-menu-sub">
      <div className="dv-menu-sub__header">
        <IconButton icon="arrow-back" label={t.common.back} tooltip={false} onClick={onBack} />
        <span>{t.account.appearance}</span>
      </div>
      <MenuDivider />
      <p className="dv-menu-note">{t.account.appearanceNote}</p>
      {options.map(([value, label]) => (
        <MenuItem key={value} checked={pref === value} onClick={() => setPref(value)}>
          {label}
        </MenuItem>
      ))}
    </div>
  );
}

/** Menu akun (user login) atau menu setelan (tamu), seperti YouTube. */
export function AccountMenu() {
  const user = useSession((s) => s.user);
  const logout = useSession((s) => s.logout);
  const pref = useTheme((s) => s.pref);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'main' | 'theme'>('main');
  const anchor = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const close = () => {
    setOpen(false);
    setView('main');
  };
  const go = (to: string) => {
    close();
    navigate(to);
  };

  return (
    <>
      {user ? (
        <button
          ref={anchor}
          type="button"
          className="dv-masthead__avatar"
          aria-label="Menu akun"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => (open ? close() : setOpen(true))}
        >
          <Avatar name={user.displayName} color={user.avatarColor} src={user.avatarUrl} size={32} />
        </button>
      ) : (
        <IconButton ref={anchor} icon="more-vert" label={t.account.settingsMenu} aria-haspopup="menu" onClick={() => (open ? close() : setOpen(true))} />
      )}
      <Popup open={open} onClose={close} anchorRef={anchor} className="dv-account-popup">
        {view === 'theme' ? (
          <ThemeSubmenu onBack={() => setView('main')} />
        ) : (
          <>
            {user && (
              <>
                <div className="dv-account-header">
                  <Avatar name={user.displayName} color={user.avatarColor} src={user.avatarUrl} size={40} />
                  <div className="dv-account-header__text">
                    <div className="dv-account-header__name">{user.displayName}</div>
                    <div className="dv-account-header__handle">@{user.username}</div>
                    <Link className="dv-account-header__link" to={`/@${user.username}`} onClick={close}>
                      {t.account.yourChannel}
                    </Link>
                  </div>
                </div>
                <MenuDivider />
                <MenuItem icon="your-videos" onClick={() => go('/my/videos')}>
                  {t.nav.yourVideos}
                </MenuItem>
                {user.role === 'admin' && (
                  <MenuItem icon="admin" onClick={() => go('/admin')}>
                    {t.nav.admin}
                  </MenuItem>
                )}
                <MenuItem icon="settings" onClick={() => go('/account')}>
                  {t.account.settings}
                </MenuItem>
                <MenuItem
                  icon="logout"
                  onClick={async () => {
                    close();
                    await logout();
                    toast('Anda telah keluar');
                    navigate('/');
                  }}
                >
                  {t.account.logout}
                </MenuItem>
                <MenuDivider />
              </>
            )}
            <MenuItem icon="dark-mode" chevron onClick={() => setView('theme')}>
              {t.account.appearance}: {t.account.themeLabel[pref]}
            </MenuItem>
          </>
        )}
      </Popup>
    </>
  );
}

/** Tombol "Login" bergaris biru ala YouTube. */
export function LoginButton({ compact = false }: { compact?: boolean }) {
  const location = useLocation();
  const next = encodeURIComponent(location.pathname + location.search);
  return (
    <Link className={`dv-login-btn${compact ? ' is-compact' : ''}`} to={`/login?next=${next}`}>
      <Icon name="account-circle" />
      <span>{t.account.login}</span>
    </Link>
  );
}
