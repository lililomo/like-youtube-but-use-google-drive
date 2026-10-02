import { useRoutes } from 'react-router';
import { adminRoutes } from './routes';

/** Entry chunk admin (di-lazy-load dari router utama, rute turunan /admin/*). */
export function AdminApp() {
  return useRoutes(adminRoutes);
}
