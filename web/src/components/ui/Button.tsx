import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Icon, type IconName } from '../icons/Icon';
import { showTooltip, hideTooltip } from './Tooltip';

type Variant = 'tonal' | 'text' | 'cta-outline' | 'cta-text' | 'primary' | 'inverse' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: IconName;
  size?: 'sm' | 'md';
  children?: ReactNode;
}

/** Tombol pill ala YouTube. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'tonal', icon, size = 'md', className, children, type = 'button', ...rest },
  ref,
) {
  const cls = ['dv-btn', `dv-btn--${variant}`, size === 'sm' ? 'dv-btn--sm' : '', icon && !children ? 'dv-btn--icon-only' : '', icon && children ? 'dv-btn--with-icon' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <button ref={ref} type={type} className={cls} {...rest}>
      {icon && <Icon name={icon} />}
      {children != null && <span className="dv-btn__label">{children}</span>}
    </button>
  );
});

interface ButtonLinkProps {
  to: string;
  variant?: Variant;
  icon?: IconName;
  children?: ReactNode;
  className?: string;
}

export function ButtonLink({ to, variant = 'tonal', icon, children, className }: ButtonLinkProps) {
  const cls = ['dv-btn', `dv-btn--${variant}`, icon && children ? 'dv-btn--with-icon' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <Link to={to} className={cls}>
      {icon && <Icon name={icon} />}
      {children != null && <span className="dv-btn__label">{children}</span>}
    </Link>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  /** Tooltip di bawah tombol (default true), seperti YouTube. */
  tooltip?: boolean;
  size?: 40 | 36 | 32 | 24;
  active?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, tooltip = true, size = 40, active, className, type = 'button', onMouseEnter, onMouseLeave, onFocus, onBlur, onClick, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      className={`dv-icon-btn dv-icon-btn--${size}${active ? ' is-active' : ''}${className ? ` ${className}` : ''}`}
      onMouseEnter={(e) => {
        if (tooltip) showTooltip(e.currentTarget, label);
        onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        hideTooltip();
        onMouseLeave?.(e);
      }}
      onFocus={(e) => {
        if (tooltip && e.currentTarget.matches(':focus-visible')) showTooltip(e.currentTarget, label);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        hideTooltip();
        onBlur?.(e);
      }}
      onClick={(e) => {
        hideTooltip();
        onClick?.(e);
      }}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  );
});
