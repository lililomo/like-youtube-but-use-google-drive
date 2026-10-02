import { useEffect } from 'react';
import { Outlet, ScrollRestoration } from 'react-router';
import { useBreakpoints } from '../../hooks/useMediaQuery';
import { useSiteEffects } from '../../hooks/useSite';
import { useSession } from '../../stores/session';
import { useUi } from '../../stores/ui';
import { Snackbar } from '../ui/misc';
import { Guide, GuideDrawer, MiniGuide, MobileNav } from './Guide';
import { Masthead } from './Masthead';
import { TopProgress } from './TopProgress';
import { GuestImportPrompt } from '../playlist/GuestImportPrompt';
import { UploadPanel } from '../upload/UploadPanel';

/** Root: memuat sesi & efek situs, menampilkan snackbar global. */
export function RootLayout() {
  const load = useSession((s) => s.load);
  useEffect(() => {
    void load();
  }, [load]);
  useSiteEffects();
  return (
    <>
      <TopProgress />
      <Outlet />
      <GuestImportPrompt />
      <UploadPanel />
      <Snackbar />
      <ScrollRestoration />
    </>
  );
}

/** Layout halaman dengan guide (beranda, pencarian, playlist, dll). */
export function AppLayout() {
  const { wide, mid, mobile } = useBreakpoints();
  const guideOpen = useUi((s) => s.guideOpen);
  const toggleGuide = useUi((s) => s.toggleGuide);
  const setDrawer = useUi((s) => s.setDrawer);

  const mode: 'full' | 'mini' | 'none' = mobile ? 'none' : wide ? (guideOpen ? 'full' : 'mini') : mid ? 'mini' : 'none';
  const onMenu = () => (wide ? toggleGuide() : setDrawer(true));

  return (
    <div className={`dv-app dv-app--guide-${mode}${mobile ? ' dv-app--mobile' : ''}`}>
      <Masthead onMenu={onMenu} />
      {mode === 'full' && <Guide />}
      {mode === 'mini' && <MiniGuide />}
      {!mobile && <GuideDrawer />}
      <main className="dv-page" id="content">
        <Outlet />
      </main>
      {mobile && <MobileNav />}
    </div>
  );
}

/** Layout halaman tonton: tanpa guide permanen; hamburger membuka drawer. */
export function WatchLayout() {
  const { mobile } = useBreakpoints();
  const setDrawer = useUi((s) => s.setDrawer);
  return (
    <div className={`dv-app dv-app--watch${mobile ? ' dv-app--mobile' : ''}`}>
      <Masthead onMenu={() => setDrawer(true)} />
      {!mobile && <GuideDrawer />}
      <main className="dv-page dv-page--watch" id="content">
        <Outlet />
      </main>
    </div>
  );
}

/** Layout polos (login). */
export function BareLayout() {
  return (
    <main className="dv-bare">
      <Outlet />
    </main>
  );
}
