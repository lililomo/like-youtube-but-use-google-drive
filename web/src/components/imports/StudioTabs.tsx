import { NavLink } from 'react-router';
import { useSite } from '../../hooks/useSite';
import { useSession } from '../../stores/session';
import '../../styles/imports.css';

/** Tab di atas halaman Video Anda / Impor YouTube (seperti tab Konten di YouTube Studio). */
export function StudioTabs() {
  const site = useSite();
  const user = useSession((s) => s.user);
  const canImport = site.importEnabled || user?.role === 'admin';
  return (
    <nav className="dv-studio-tabs" aria-label="Konten Anda">
      <NavLink to="/my/videos" end className={({ isActive }) => (isActive ? 'is-active' : '')}>
        Video Anda
      </NavLink>
      {canImport && (
        <NavLink to="/my/imports" end className={({ isActive }) => (isActive ? 'is-active' : '')}>
          Impor YouTube
        </NavLink>
      )}
    </nav>
  );
}
