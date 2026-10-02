import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { useHotkey } from '../../hooks/useHotkey';
import { t } from '../../i18n/id';
import { Icon } from '../icons/Icon';
import { showTooltip, hideTooltip } from '../ui/Tooltip';

/** Kotak "Telusuri" ala YouTube. Mode `mobile` = input penuh dengan tombol kembali. */
export function SearchBox({ mobile = false, onBack }: { mobile?: boolean; onBack?: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const current = location.pathname === '/results' ? (params.get('search_query') ?? '') : '';
  const [value, setValue] = useState(current);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setValue(current), [current]);
  useEffect(() => {
    if (mobile) inputRef.current?.focus();
  }, [mobile]);

  const focusSearch = useCallback((e: KeyboardEvent) => {
    e.preventDefault();
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  useHotkey('/', focusSearch, !mobile);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = value.trim();
    if (!q) return;
    inputRef.current?.blur();
    navigate(`/results?search_query=${encodeURIComponent(q)}`);
    onBack?.();
  };

  return (
    <form className={`dv-search${focused ? ' is-focused' : ''}${mobile ? ' dv-search--mobile' : ''}`} role="search" onSubmit={submit}>
      {mobile && (
        <button type="button" className="dv-icon-btn dv-icon-btn--40" aria-label={t.search.back} onClick={onBack}>
          <Icon name="arrow-back" />
        </button>
      )}
      <div className="dv-search__box">
        <span className="dv-search__icon-inner" aria-hidden="true">
          <Icon name="search" size={20} />
        </span>
        <input
          ref={inputRef}
          className="dv-search__input"
          name="search_query"
          type="text"
          inputMode="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={t.search.placeholder}
          aria-label={t.search.placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        {value && (
          <button
            type="button"
            className="dv-search__clear"
            aria-label={t.search.clear}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setValue('');
              inputRef.current?.focus();
            }}
          >
            <Icon name="close" />
          </button>
        )}
      </div>
      <button
        type="submit"
        className="dv-search__btn"
        aria-label={t.search.button}
        onMouseEnter={(e) => showTooltip(e.currentTarget, t.search.button)}
        onMouseLeave={hideTooltip}
      >
        <Icon name="search" />
      </button>
    </form>
  );
}
