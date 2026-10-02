import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from '../icons/Icon';

interface PopupProps {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  align?: 'left' | 'right';
  /** Jarak vertikal dari anchor. */
  offset?: number;
  className?: string;
  children: ReactNode;
}

/** Menu popup ala YouTube (bg raised, radius 12px), menutup saat klik di luar / Escape / scroll. */
export function Popup({ open, onClose, anchorRef, align = 'right', offset = 4, className, children }: PopupProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const a = anchorRef.current?.getBoundingClientRect();
      const el = ref.current;
      if (!a || !el) return;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      let left = align === 'right' ? a.right - w : a.left;
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      let top = a.bottom + offset;
      if (top + h > window.innerHeight - 8 && a.top - h - offset > 8) top = a.top - h - offset;
      top = Math.max(8, Math.min(top, window.innerHeight - h - 8));
      setPos({ top, left });
    };
    place();
    const ro = new ResizeObserver(place);
    if (ref.current) ro.observe(ref.current);
    window.addEventListener('resize', place);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [open, align, offset, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        anchorRef.current?.focus();
      }
    };
    const onScroll = (e: Event) => {
      if (ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      className={`dv-popup${className ? ` ${className}` : ''}`}
      role="menu"
      style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden', top: 0, left: 0 }}
    >
      {children}
    </div>,
    document.body,
  );
}

interface MenuItemProps {
  icon?: IconName;
  children: ReactNode;
  onClick?: () => void;
  trailing?: ReactNode;
  chevron?: boolean;
  checked?: boolean;
  href?: string;
  danger?: boolean;
}

export function MenuItem({ icon, children, onClick, trailing, chevron, checked, danger }: MenuItemProps) {
  return (
    <button type="button" role="menuitem" className={`dv-menu-item${danger ? ' is-danger' : ''}`} onClick={onClick}>
      {checked !== undefined ? (
        <span className="dv-menu-item__check">{checked && <Icon name="check" />}</span>
      ) : (
        icon && <Icon name={icon} className="dv-menu-item__icon" />
      )}
      <span className="dv-menu-item__label">{children}</span>
      {trailing && <span className="dv-menu-item__trailing">{trailing}</span>}
      {chevron && <Icon name="chevron-right" className="dv-menu-item__chevron" />}
    </button>
  );
}

export function MenuDivider() {
  return <div className="dv-menu-divider" role="separator" />;
}
