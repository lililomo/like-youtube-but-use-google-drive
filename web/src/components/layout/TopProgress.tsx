import { useIsFetching } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigation } from 'react-router';

/**
 * Bar progres merah tipis di atas halaman saat navigasi/memuat data halaman (seperti YouTube).
 * Aktif bila router sedang memuat (lazy route) atau ada query ber-meta {page:true} yang belum punya data.
 */
export function TopProgress() {
  const navigation = useNavigation();
  const fetchingPage = useIsFetching({ predicate: (q) => q.meta?.page === true && q.state.data === undefined });
  const busy = navigation.state !== 'idle' || fetchingPage > 0;
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    if (busy) {
      setVisible(true);
      setWidth(10);
      clearInterval(timer.current);
      timer.current = setInterval(() => setWidth((w) => (w < 90 ? w + (90 - w) * 0.1 : w)), 200);
      return;
    }
    clearInterval(timer.current);
    if (!visible) return;
    setWidth(100);
    const hide = setTimeout(() => {
      setVisible(false);
      setWidth(0);
    }, 300);
    return () => clearTimeout(hide);
  }, [busy, visible]);

  useEffect(() => () => clearInterval(timer.current), []);

  return (
    <div className={`dv-top-progress${visible ? ' is-visible' : ''}`} aria-hidden="true">
      <div className="dv-top-progress__bar" style={{ transform: `scaleX(${width / 100})` }} />
    </div>
  );
}
