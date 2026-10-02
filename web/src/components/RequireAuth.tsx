import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useSession } from '../stores/session';
import { Spinner } from './ui/misc';
import { NotFoundPage } from '../pages/NotFound';

/** Wajib login (dan opsional wajib admin). Tamu diarahkan ke /login?next=… */
export function RequireAuth({ admin = false, children }: { admin?: boolean; children: ReactNode }) {
  const user = useSession((s) => s.user);
  const loaded = useSession((s) => s.loaded);
  const location = useLocation();
  if (!loaded) {
    return (
      <div className="dv-center-block">
        <Spinner />
      </div>
    );
  }
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (admin && user.role !== 'admin') return <NotFoundPage />;
  return <>{children}</>;
}
