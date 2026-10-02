import { useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { useToast } from '../../stores/toast';
import { Icon } from '../icons/Icon';

/** Avatar bulat dengan inisial (seperti avatar default YouTube). */
export function Avatar({ name, color, size = 32, src }: { name: string; color: string; size?: number; src?: string | null }) {
  const initial = (name.trim()[0] ?? '?').toUpperCase();
  // Foto gagal dimuat (mis. baru dihapus) → kembali ke avatar huruf.
  const [failed, setFailed] = useState<string | null>(null);
  if (src && failed !== src) {
    return (
      <img
        className="dv-avatar dv-avatar--img"
        src={src}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size }}
        onError={() => setFailed(src)}
      />
    );
  }
  return (
    <span
      className="dv-avatar"
      aria-hidden="true"
      style={{ width: size, height: size, background: color, fontSize: Math.round(size * 0.45) }}
    >
      {initial}
    </span>
  );
}

export function Skeleton({ width, height, radius, className }: { width?: number | string; height?: number | string; radius?: number | string; className?: string }) {
  return <div className={`dv-skeleton${className ? ` ${className}` : ''}`} style={{ width, height, borderRadius: radius }} />;
}

/** Spinner bulat ala YouTube. */
export function Spinner({ size = 32 }: { size?: number }) {
  return (
    <span className="dv-spinner" style={{ width: size, height: size }} role="progressbar" aria-label="Memuat">
      <svg viewBox="0 0 50 50">
        <circle cx="25" cy="25" r="20" fill="none" strokeWidth="4" />
      </svg>
    </span>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`dv-switch${checked ? ' is-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="dv-switch__track" />
      <span className="dv-switch__thumb" />
    </button>
  );
}

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label: string;
  error?: string | null;
  helper?: ReactNode;
  trailing?: ReactNode;
}

/** Text field outlined dengan label mengambang (gaya Material). */
export function TextField({ label, error, helper, trailing, className, id, ...rest }: TextFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className={`dv-field${error ? ' has-error' : ''}${className ? ` ${className}` : ''}`}>
      <div className="dv-field__box">
        <input id={inputId} className="dv-field__input" aria-invalid={Boolean(error)} {...rest} placeholder=" " />
        <label htmlFor={inputId} className="dv-field__label">
          {label}
        </label>
        {trailing && <div className="dv-field__trailing">{trailing}</div>}
      </div>
      {error ? (
        <div className="dv-field__error">
          <Icon name="error" size={16} /> {error}
        </div>
      ) : (
        helper && <div className="dv-field__helper">{helper}</div>
      )}
    </div>
  );
}

export function PasswordField(props: Omit<TextFieldProps, 'type' | 'trailing'>) {
  const [show, setShow] = useState(false);
  return (
    <TextField
      {...props}
      type={show ? 'text' : 'password'}
      trailing={
        <button type="button" className="dv-field__toggle" aria-label={show ? 'Sembunyikan password' : 'Tampilkan password'} onClick={() => setShow(!show)}>
          <Icon name={show ? 'visibility-off' : 'visibility'} />
        </button>
      }
    />
  );
}

export function Checkbox({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="dv-checkbox">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="dv-checkbox__box" aria-hidden="true">
        <Icon name="check" size={18} />
      </span>
      <span>{children}</span>
    </label>
  );
}

/** Snackbar kiri bawah (render dari store toast). */
export function Snackbar() {
  const current = useToast((s) => s.current);
  const hide = useToast((s) => s.hide);
  if (!current) return null;
  return (
    <div className="dv-snackbar" role="status" aria-live="polite" key={current.id}>
      <span className="dv-snackbar__text">{current.message}</span>
      {current.action && (
        <button
          type="button"
          className="dv-snackbar__action"
          onClick={() => {
            current.action?.onClick();
            hide();
          }}
        >
          {current.action.label}
        </button>
      )}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon?: Parameters<typeof Icon>[0]['name']; title: string; children?: ReactNode }) {
  return (
    <div className="dv-empty">
      {icon && (
        <div className="dv-empty__icon">
          <Icon name={icon} size={96} />
        </div>
      )}
      <h2 className="dv-empty__title">{title}</h2>
      {children && <div className="dv-empty__body">{children}</div>}
    </div>
  );
}
