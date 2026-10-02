import type { RouteObject } from 'react-router';
import { t } from '../../i18n/id';
import { RequireAuth } from '../../components/RequireAuth';
import { AdminLayout } from './AdminLayout';
import { AdminPlaceholder } from './AdminPlaceholder';
import { DriveSettingsPage } from './DriveSettings';
import { JobsPage } from './Jobs';
import { ImportsPage } from './Imports';
import { ProcessingSettingsPage } from './ProcessingSettings';
import { SiteSettingsPage } from './SiteSettings';
import { DashboardPage } from './Dashboard';
import { UsersPage } from './Users';
import { AdminVideosPage } from './Videos';
import { AdminPlaylistsPage } from './Playlists';
import { GroupSettingsPage } from './GroupSettings';
import { AuditPage } from './Audit';

/** Rute panel admin (di-lazy-load sebagai satu chunk). */
export const adminRoutes: RouteObject[] = [
  {
    element: (
      <RequireAuth admin>
        <AdminLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'users', element: <UsersPage /> },
      { path: 'videos', element: <AdminVideosPage /> },
      { path: 'playlists', element: <AdminPlaylistsPage /> },
      { path: 'jobs', element: <JobsPage /> },
      { path: 'imports', element: <ImportsPage /> },
      { path: 'settings/drive', element: <DriveSettingsPage /> },
      { path: 'settings/processing', element: <ProcessingSettingsPage /> },
      { path: 'settings/site', element: <SiteSettingsPage /> },
      { path: 'settings/upload', element: <GroupSettingsPage group="upload" /> },
      { path: 'settings/player', element: <GroupSettingsPage group="player" /> },
      { path: 'settings/security', element: <GroupSettingsPage group="security" /> },
      { path: 'audit', element: <AuditPage /> },
      { path: '*', element: <AdminPlaceholder title="404" icon="error" /> },
    ],
  },
];
