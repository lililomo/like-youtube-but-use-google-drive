import { useDocumentTitle } from '../../hooks/useSite';
import { EmptyState } from '../../components/ui/misc';
import type { IconName } from '../../components/icons/Icon';

export function AdminPlaceholder({ title, icon = 'dashboard' }: { title: string; icon?: IconName }) {
  useDocumentTitle(`${title} - Studio`);
  return (
    <div className="dv-studio-page">
      <h1 className="dv-studio-page__title">{title}</h1>
      <EmptyState icon={icon} title={title}>
        <p>Halaman ini sedang disiapkan.</p>
      </EmptyState>
    </div>
  );
}
