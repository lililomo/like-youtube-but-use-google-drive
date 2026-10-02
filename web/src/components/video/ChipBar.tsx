import { useEffect, useRef, useState } from 'react';
import { Icon } from '../icons/Icon';

export interface Chip {
  id: string;
  label: string;
}

/** Bar chip horizontal ala YouTube dengan tombol panah bergradien di desktop. */
export function ChipBar({ chips, selected, onSelect, sticky = true }: { chips: Chip[]; selected: string; onSelect: (id: string) => void; sticky?: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = () => setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [chips.length]);

  const scrollBy = (dir: number) => scroller.current?.scrollBy({ left: dir * scroller.current.clientWidth * 0.7, behavior: 'smooth' });

  return (
    <div className={`dv-chipbar${sticky ? '' : ' dv-chipbar--static'}`} role="toolbar" aria-label="Filter">
      {edges.left && (
        <div className="dv-chipbar__arrow dv-chipbar__arrow--left">
          <button type="button" className="dv-icon-btn dv-icon-btn--40" aria-label="Sebelumnya" onClick={() => scrollBy(-1)}>
            <Icon name="chevron-left" />
          </button>
        </div>
      )}
      <div ref={scroller} className="dv-chipbar__scroll">
        {chips.map((c) => (
          <button key={c.id} type="button" className={`dv-chip${selected === c.id ? ' is-selected' : ''}`} aria-pressed={selected === c.id} onClick={() => onSelect(c.id)}>
            {c.label}
          </button>
        ))}
      </div>
      {edges.right && (
        <div className="dv-chipbar__arrow dv-chipbar__arrow--right">
          <button type="button" className="dv-icon-btn dv-icon-btn--40" aria-label="Berikutnya" onClick={() => scrollBy(1)}>
            <Icon name="chevron-right" />
          </button>
        </div>
      )}
    </div>
  );
}
