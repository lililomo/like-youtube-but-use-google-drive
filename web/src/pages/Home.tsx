import { useState } from 'react';
import { useDocumentTitle } from '../hooks/useSite';
import { t } from '../i18n/id';
import { EmptyState } from '../components/ui/misc';

export function HomePage() {
  useDocumentTitle(null);
  const [chip, setChip] = useState('all');
  const chips = [
    { id: 'all', label: t.home.all },
    { id: 'popular', label: t.home.popular },
  ];
  return (
    <div className="dv-home">
      <div className="dv-chipbar" role="toolbar" aria-label="Filter">
        <div className="dv-chipbar__scroll">
          {chips.map((c) => (
            <button key={c.id} type="button" className={`dv-chip${chip === c.id ? ' is-selected' : ''}`} aria-pressed={chip === c.id} onClick={() => setChip(c.id)}>
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <EmptyState icon="your-videos" title={t.home.empty}>
        <p>{t.home.emptyHint}</p>
      </EmptyState>
    </div>
  );
}
