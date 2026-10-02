import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from './Button';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  width?: number;
  className?: string;
  /** Tutup bila scrim diklik (default true). */
  dismissible?: boolean;
  showClose?: boolean;
}

/** Dialog modal ala YouTube (radius 12px, bg raised, scrim gelap). */
export function Dialog({ open, onClose, title, children, actions, width = 400, className, dismissible = true, showClose = false }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    document.body.classList.add('dv-no-scroll');
    const focusable = ref.current?.querySelector<HTMLElement>('input, textarea, select, button:not(.dv-dialog__close)');
    (focusable ?? ref.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('dv-no-scroll');
      prev?.focus?.();
    };
  }, [open, onClose, dismissible]);

  if (!open) return null;
  return createPortal(
    <div className="dv-dialog-scrim" onPointerDown={(e) => dismissible && e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={`dv-dialog${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        style={{ width: `min(${width}px, calc(100vw - 32px))` }}
      >
        {(title || showClose) && (
          <div className="dv-dialog__header">
            {title && <h2 className="dv-dialog__title">{title}</h2>}
            {showClose && <IconButton className="dv-dialog__close" icon="close" label="Tutup" tooltip={false} onClick={onClose} />}
          </div>
        )}
        <div className="dv-dialog__body">{children}</div>
        {actions && <div className="dv-dialog__actions">{actions}</div>}
      </div>
    </div>,
    document.body,
  );
}
