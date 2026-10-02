import type { RouteObject } from 'react-router';
import { t } from '../../i18n/id';
import { RequireAuth } from '../../components/RequireAuth';
import { AdminLayout } from './AdminLayout';
import { AdminPlaceholder } from './AdminPlaceholder';

/** Rute panel admin (di-lazy-load sebagai satu chunk). */
export const adminRoutes: RouteObject[] = [
  {
    element: (
      <RequireAuth admin>
        <AdminLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <AdminPlaceholder title={t.admin.dashboard} icon="dashboard" /> },
      { path: 'users', element: <AdminPlaceholder title={t.admin.users} icon="group" /> },
      { path: 'videos', element: <AdminPlaceholder title={t.admin.videos} icon="your-videos" /> },
      { path: 'playlists', element: <AdminPlaceholder title={t.admin.playlists} icon="playlist-play" /> },
      { path: 'jobs', element: <AdminPlaceholder title={t.admin.jobs} icon="list" /> },
      { path: 'settings/:group', element: <AdminPlaceholder title={t.admin.settings} icon="settings" /> },
      { path: 'audit', element: <AdminPlaceholder title={t.admin.audit} icon="description" /> },
      { path: '*', element: <AdminPlaceholder title="404" icon="error" /> },
    ],
  },
];
