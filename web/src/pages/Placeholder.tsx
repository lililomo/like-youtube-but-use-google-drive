import { useDocumentTitle } from '../hooks/useSite';
import { t } from '../i18n/id';
import { EmptyState } from '../components/ui/misc';
import type { IconName } from '../components/icons/Icon';

/** Halaman yang belum dibangun (diisi di step berikutnya). */
export function PlaceholderPage({ title, icon = 'info' }: { title: string; icon?: IconName }) {
  useDocumentTitle(title);
  return (
    <div className="dv-page-pad">
      <EmptyState icon={icon} title={title}>
        <p>{t.placeholder.soon}</p>
      </EmptyState>
    </div>
  );
}
