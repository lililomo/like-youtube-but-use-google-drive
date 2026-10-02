import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { useHotkey } from '../../hooks/useHotkey';
import { t } from '../../i18n/id';
import { apiGet } from '../../lib/api';
import { storage } from '../../lib/storage';
import { Icon } from '../icons/Icon';
import { showTooltip, hideTooltip } from '../ui/Tooltip';

const HISTORY_KEY = 'dv.searchHistory';

function readHistory(): string[] {
  const h = storage.get<unknown>(HISTORY_KEY, []);
  return Array.isArray(h) ? h.filter((x): x is string => typeof x === 'string').slice(0, 20) : [];
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

interface Item {
  text: string;
  fromHistory: boolean;
}

/** Bagian yang sudah diketik normal, sisanya tebal (seperti saran YouTube). */
function Highlight({ text, typed }: { text: string; typed: string }) {
  const lower = text.toLowerCase();
  const tq = typed.trim().toLowerCase();
  if (tq && lower.startsWith(tq)) {
    return (
      <>
        {text.slice(0, tq.length)}
        <b>{text.slice(tq.length)}</b>
      </>
    );
  }
  return <b>{text}</b>;
}

/** Kotak "Telusuri" ala YouTube. Mode `mobile` = input penuh dengan tombol kembali. */
export function SearchBox({ mobile = false, onBack }: { mobile?: boolean; onBack?: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const current = location.pathname === '/results' ? (params.get('search_query') ?? '') : '';
  const [value, setValue] = useState(current);
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [history, setHistory] = useState<string[]>(readHistory);
  const inputRef = useRef<HTMLInputElement>(null);
  const typed = useRef(value);

  useEffect(() => {
    setValue(current);
    typed.current = current;
  }, [current]);
  useEffect(() => {
    if (mobile) inputRef.current?.focus();
  }, [mobile]);

  const focusSearch = useCallback((e: KeyboardEvent | globalThis.KeyboardEvent) => {
    e.preventDefault();
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  useHotkey('/', focusSearch as (e: globalThis.KeyboardEvent) => void, !mobile);

  const debounced = useDebounced(typed.current.trim(), 150);
  const suggest = useQuery({
    queryKey: ['suggest', debounced],
    queryFn: ({ signal }) => apiGet<{ items: string[] }>(`/search/suggest?q=${encodeURIComponent(debounced)}`, signal),
    enabled: open && debounced.length > 0,
    staleTime: 60_000,
  });

  const items: Item[] = useMemo(() => {
    const q = typed.current.trim().toLowerCase();
    const hist = history.filter((h) => !q || h.toLowerCase().startsWith(q)).slice(0, q ? 3 : 10);
    const seen = new Set(hist.map((h) => h.toLowerCase()));
    const sugg = q ? (suggest.data?.items ?? []).filter((s) => !seen.has(s.toLowerCase())).slice(0, 10 - hist.length) : [];
    return [...hist.map((text) => ({ text, fromHistory: true })), ...sugg.map((text) => ({ text, fromHistory: false }))];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, suggest.data, value]);

  const go = (raw: string) => {
    const q = raw.trim();
    if (!q) return;
    const next = [q, ...history.filter((h) => h.toLowerCase() !== q.toLowerCase())].slice(0, 20);
    setHistory(next);
    storage.set(HISTORY_KEY, next);
    setOpen(false);
    setActive(-1);
    setValue(q);
    typed.current = q;
    inputRef.current?.blur();
    navigate(`/results?search_query=${encodeURIComponent(q)}`);
    onBack?.();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    go(value);
  };

  const removeHistory = (text: string) => {
    const next = history.filter((h) => h !== text);
    setHistory(next);
    storage.set(HISTORY_KEY, next);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!open || !items.length || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    e.preventDefault();
    const n = items.length;
    const next = e.key === 'ArrowDown' ? (active + 1 >= n ? -1 : active + 1) : active - 1 < -1 ? n - 1 : active - 1;
    setActive(next);
    setValue(next === -1 ? typed.current : (items[next]?.text ?? typed.current));
  };

  const showDropdown = open && focused && items.length > 0;

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
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={t.search.placeholder}
          aria-label={t.search.placeholder}
          aria-autocomplete="list"
          aria-expanded={showDropdown}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            typed.current = e.target.value;
            setActive(-1);
            setOpen(true);
          }}
          onFocus={() => {
            setFocused(true);
            setOpen(true);
          }}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
        />
        {value && (
          <button
            type="button"
            className="dv-search__clear"
            aria-label={t.search.clear}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setValue('');
              typed.current = '';
              setOpen(true);
              inputRef.current?.focus();
            }}
          >
            <Icon name="close" />
          </button>
        )}
        {showDropdown && (
          <ul className="dv-suggest" role="listbox" onMouseDown={(e) => e.preventDefault()}>
            {items.map((it, i) => (
              <li key={`${it.fromHistory ? 'h' : 's'}:${it.text}`} role="option" aria-selected={i === active} className={`dv-suggest__item${i === active ? ' is-active' : ''}`}>
                <button type="button" className="dv-suggest__text" onClick={() => go(it.text)} onMouseEnter={() => setActive(i)}>
                  <Icon name={it.fromHistory ? 'history' : 'search'} size={20} />
                  <span className="dv-suggest__label">
                    <Highlight text={it.text} typed={typed.current} />
                  </span>
                </button>
                {it.fromHistory && (
                  <button type="button" className="dv-suggest__remove" onClick={() => removeHistory(it.text)}>
                    {t.search.removeHistory}
                  </button>
                )}
              </li>
            ))}
          </ul>
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
