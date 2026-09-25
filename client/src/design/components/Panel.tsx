import type { HTMLAttributes } from 'react';

/** Superficie piatta del design: pannelli, barre laterali, card. Nessun bordo né ombra, la separa il colore. */
export function Panel({ className = '', ...rest }: HTMLAttributes<HTMLElement>) {
  return <section className={`rounded-12 bg-panel ${className}`} {...rest} />;
}
