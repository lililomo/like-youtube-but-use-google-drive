import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useBreakpoints } from '../../hooks/useMediaQuery';
import { useSite } from '../../hooks/useSite';
import { t } from '../../i18n/id';
import { useSession } from '../../stores/session';
import { IconButton } from '../ui/Button';
import { Icon } from '../icons/Icon';
import { AccountMenu, LoginButton } from './AccountMenu';
import { Logo } from './Logo';
import { SearchBox } from './SearchBox';
import { useUploads } from '../../stores/uploads';

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
  const openUpload = useUploads((st) => st.openDialog);

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
        {canUpload && !mobile && (
          <button type="button" className="dv-create-btn" onClick={openUpload}>
            <Icon name="add" />
            <span>{t.nav.upload}</span>
          </button>
        )}
        {canUpload && mobile && <IconButton icon="upload-outline" label={t.nav.upload} onClick={openUpload} />}
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
