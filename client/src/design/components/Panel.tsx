import type { HTMLAttributes } from 'react';

/** Superficie silenziosa attorno alla scacchiera: pannelli, barre laterali, card. */
export function Panel({ className = '', ...rest }: HTMLAttributes<HTMLElement>) {
  return <section className={`rounded-md border border-subtle bg-panel ${className}`} {...rest} />;
}
