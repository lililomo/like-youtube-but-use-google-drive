import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useBreakpoints } from '../../hooks/useMediaQuery';
import { useSite } from '../../hooks/useSite';
import { t } from '../../i18n/id';
import { useSession } from '../../stores/session';
import { IconButton } from '../ui/Button';
import { MenuItem, Popup } from '../ui/Popup';
import { Icon } from '../icons/Icon';
import { AccountMenu, LoginButton } from './AccountMenu';
import { Logo } from './Logo';
import { SearchBox } from './SearchBox';
import { useUploads } from '../../stores/uploads';

/** Tombol "Buat" ala YouTube: menu Upload video / Impor dari YouTube (bila impor diizinkan), selain itu langsung upload. */
function CreateButton({ mobile }: { mobile: boolean }) {
  const site = useSite();
  const user = useSession((s) => s.user);
  const openUpload = useUploads((st) => st.openDialog);
  const navigate = useNavigate();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const withMenu = site.importEnabled || user?.role === 'admin';
  const onClick = withMenu ? () => setOpen((o) => !o) : openUpload;
  return (
    <>
      {mobile ? (
        <IconButton ref={anchor} icon="upload-outline" label={t.nav.upload} aria-haspopup={withMenu ? 'menu' : undefined} onClick={onClick} />
      ) : (
        <button ref={anchor} type="button" className="dv-create-btn" aria-haspopup={withMenu ? 'menu' : undefined} aria-expanded={withMenu ? open : undefined} onClick={onClick}>
          <Icon name="add" />
          <span>{t.nav.upload}</span>
        </button>
      )}
      {withMenu && (
        <Popup open={open} onClose={() => setOpen(false)} anchorRef={anchor}>
          <MenuItem
            icon="upload"
            onClick={() => {
              setOpen(false);
              openUpload();
            }}
          >
            {t.nav.uploadVideo}
          </MenuItem>
          <MenuItem
            icon="download"
            onClick={() => {
              setOpen(false);
              navigate('/my/imports');
            }}
          >
            {t.nav.importYoutube}
          </MenuItem>
        </Popup>
      )}
    </>
  );
}

/** Bar atas 56px (mobile 48px) ala YouTube. */
export function Masthead({ onMenu }: { onMenu: () => void }) {
  const { mobile } = useBreakpoints();
  const user = useSession((s) => s.user);
  const loaded = useSession((s) => s.loaded);
  const site = useSite();
  const navigate = useNavigate();
  const [mobileSearch, setMobileSearch] = useState(false);

  if (mobile && mobileSearch) {
    return (
      <header className="dv-masthead dv-masthead--mobile dv-masthead--searching">
        <SearchBox mobile onBack={() => setMobileSearch(false)} />
      </header>
    );
  }

  const canUpload = Boolean(user) && site.uploadEnabled;

  return (
    <header className={`dv-masthead${mobile ? ' dv-masthead--mobile' : ''}`}>
      <div className="dv-masthead__start">
        {!mobile && <IconButton icon="menu" label={t.nav.menu} onClick={onMenu} className="dv-masthead__menu" />}
        <Logo />
      </div>
      {!mobile && (
        <div className="dv-masthead__center">
          <SearchBox />
        </div>
      )}
      <div className="dv-masthead__end">
        {mobile && <IconButton icon="search" label={t.search.placeholder} onClick={() => setMobileSearch(true)} />}
        {canUpload && <CreateButton mobile={mobile} />}
        {!loaded ? (
          <span className="dv-masthead__avatar-skeleton" />
        ) : user ? (
          <AccountMenu />
        ) : (
          <>
            <AccountMenu />
            <LoginButton compact={mobile} />
          </>
        )}
      </div>
    </header>
  );
}
