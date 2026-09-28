import { useSyncExternalStore } from 'react';

/** Soglia `lg` di Tailwind: da qui in su valgono le tavole desktop. */
export const DESKTOP_QUERY = '(min-width: 1024px)';

/**
 * Una media query come stato React. Per le schermate che hanno un albero diverso su desktop e su Android (non solo
 * classi diverse): senza `matchMedia` (test, SSR) vale `false`, cioè Android.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
    () => false,
  );
}
