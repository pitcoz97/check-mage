import type { ReactNode } from 'react';

/**
 * Icone dell'interfaccia, dai tracciati delle tavole (a tratto, 1.8px di default, estremità arrotondate). Il colore
 * arriva da `currentColor`: nessun colore letterale qui.
 */

export type AppIconName =
  | 'logo'
  | 'play'
  | 'decks'
  | 'collection'
  | 'ranking'
  | 'friends'
  | 'settings'
  | 'trophy'
  | 'bell'
  | 'chevron'
  | 'home'
  | 'search'
  | 'lock'
  | 'check'
  | 'close'
  | 'plus'
  | 'minus'
  | 'more'
  | 'spark';

const SHAPES: Record<AppIconName, ReactNode> = {
  logo: (
    <>
      <path d="M7 21h10M8 17h8l-1-7H9zM9 10V5h2v2h2V5h2v5" />
      <path d="M19 3l.6 1.4L21 5l-1.4.6L19 7l-.6-1.4L17 5l1.4-.6z" />
    </>
  ),
  play: <path d="M9 20h6M10 16h4l-.5-5h-3zM12 11a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />,
  decks: (
    <>
      <rect x="7" y="4" width="11" height="15" rx="2" />
      <path d="M5 7v11a2 2 0 0 0 2 2h8" />
    </>
  ),
  collection: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  ranking: <path d="M5 20V12M12 20V5M19 20v-5" />,
  friends: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20c.5-3.5 3-5.5 6-5.5s5.5 2 6 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.7.7 2.8 2.5 3 5.2" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </>
  ),
  trophy: <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3" />,
  bell: <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0" />,
  chevron: <path d="M9 5l7 7-7 7" />,
  // Non disegnata: la casa, per tornare alla home dal foglio della partita su Android.
  home: <path d="M4 11l8-7 8 7M6 9.5V20h12V9.5M10 20v-5h4v5" />,
  // Dalla tavola "Collezione": ricerca, lucchetto delle carte non possedute, spunta del filtro, chiusura del foglio.
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  // Dalla tavola "Mazzi": + e − delle righe, «Autocompleta». Il menu dell'editor Android non è disegnato.
  plus: <path d="M6 12h12M12 6v12" />,
  minus: <path d="M6 12h12" />,
  more: (
    <>
      <circle cx="12" cy="5.5" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="12" cy="18.5" r="1.4" />
    </>
  ),
  spark: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />,
};

export function AppIcon({ name, className = '', strokeWidth = 1.8 }: { name: AppIconName; className?: string; strokeWidth?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {SHAPES[name]}
    </svg>
  );
}

/** Il marchio delle tavole: quadrato oro col bordo 3D e il simbolo scuro. */
export function LogoMark({ size }: { size: 'sm' | 'md' | 'lg' }) {
  const box = { sm: 'size-9 rounded-9', md: 'size-10 rounded-10', lg: 'size-11 rounded-10' }[size];
  const icon = { sm: 'size-[22px]', md: 'size-6', lg: 'size-[26px]' }[size];
  return (
    <span aria-hidden="true" className={`flex shrink-0 items-center justify-center bg-gold text-on-gold shadow-edge-gold ${box}`}>
      <AppIcon name="logo" strokeWidth={2} className={icon} />
    </span>
  );
}
