import { useSyncExternalStore } from 'react';

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', cb);
      return () => mql.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Breakpoint layout ala YouTube (SPEC §15.4). */
export function useBreakpoints() {
  const wide = useMediaQuery('(min-width: 1313px)');
  const mid = useMediaQuery('(min-width: 792px)');
  const mobile = useMediaQuery('(max-width: 656px)');
  return { wide, mid, mobile };
}
