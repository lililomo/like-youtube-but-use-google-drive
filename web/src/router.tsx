import { createBrowserRouter } from 'react-router';
import { RequireAuth } from './components/RequireAuth';
import { AppLayout, BareLayout, RootLayout, WatchLayout } from './components/layout/Layouts';
import { t } from './i18n/id';
import { AccountPage } from './pages/Account';
import { ChannelPage } from './pages/Channel';
import { HomePage } from './pages/Home';
import { LoginPage } from './pages/Login';
import { NotFoundPage } from './pages/NotFound';
import { PlaceholderPage } from './pages/Placeholder';
import { ResultsPage } from './pages/Results';
import { HistoryPage } from './pages/History';
import { YouPage } from './pages/You';
import { MyPlaylistsPage, PublicPlaylistsPage } from './pages/Playlists';

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <HomePage /> },
          { path: 'results', element: <ResultsPage /> },
          { path: 'playlist', lazy: () => import('./pages/Playlist').then((m) => ({ Component: m.PlaylistPage })) },
          { path: 'feed/playlists', element: <MyPlaylistsPage /> },
          { path: 'feed/playlists/public', element: <PublicPlaylistsPage /> },
          { path: 'feed/you', element: <YouPage /> },
          { path: 'feed/history', element: <HistoryPage /> },
          {
            path: 'my/videos',
            element: (
              <RequireAuth>
                <PlaceholderPage title={t.nav.yourVideos} icon="your-videos" />
              </RequireAuth>
            ),
          },
          {
            path: 'account',
            element: (
              <RequireAuth>
                <AccountPage />
              </RequireAuth>
            ),
          },
          { path: ':handle', element: <ChannelPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
      {
        element: <WatchLayout />,
        children: [
          { path: 'watch', lazy: () => import('./pages/Watch').then((m) => ({ Component: m.WatchPage })) },
          {
            path: 'dev/player',
            lazy: () =>
              import('./pages/DevPlayer').then((m) => ({
                Component: () => (
                  <RequireAuth admin>
                    <m.DevPlayerPage />
                  </RequireAuth>
                ),
              })),
          },
        ],
      },
      {
        element: <BareLayout />,
        children: [{ path: 'login', element: <LoginPage /> }],
      },
      {
        path: 'admin/*',
        lazy: () => import('./pages/admin/AdminApp').then((m) => ({ Component: m.AdminApp })),
      },
    ],
  },
]);
