import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'gold' | 'danger';
type Size = 'sm' | 'compact' | 'md' | 'action' | 'lg' | 'hero';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: Variant;
  /**
   * Altezze delle tavole: `sm` 44px (patta, resa), `compact` 44px più marcato (CTA della fase su Android), `md` 48px,
   * `action` 60px (CTA della fase in partita), `lg` 60px (CTA principale di una schermata), `hero` 60/68px con il
   * bordo 3D più alto ("Gioca classificata" nella home).
   */
  readonly size?: Size;
  readonly fullWidth?: boolean;
}

/**
 * Il bordo inferiore più scuro (ombra interna) dà il rilievo del design; premuto, il bordo sparisce.
 * `danger` non è nel design: riprende i colori della carta "fulmine" (REDESIGN_PLAN.md §10, D20).
 */
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-play text-on-play font-extrabold',
  secondary: 'bg-elevated text-primary font-bold shadow-edge-elevated',
  gold: 'bg-gold text-on-gold font-extrabold shadow-edge-gold',
  danger: 'bg-danger-surface text-on-danger font-bold shadow-edge-danger',
};

const SIZES: Record<Size, string> = {
  sm: 'min-h-11 rounded-10 px-3.5 text-14',
  compact: 'min-h-11 rounded-10 px-3.5 text-15',
  md: 'min-h-12 rounded-10 px-4 text-15',
  action: 'min-h-15 rounded-10 px-6 text-18',
  lg: 'min-h-15 rounded-10 px-6 text-20',
  hero: 'min-h-15 rounded-12 px-6 text-[19px] tracking-[0.02em] lg:min-h-[68px] lg:text-24',
};

/** Il bordo 3D del primario: più alto sulla CTA della home, come nella tavola. */
const PRIMARY_EDGE = { hero: 'shadow-edge-play-lg', other: 'shadow-edge-play' } as const;

/** Bottone base: hit target ≥ 44px, focus visibile, stato disabilitato leggibile (briefing §6). */
export function Button({ variant = 'primary', size = 'md', fullWidth = false, className = '', type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={[
        'inline-flex min-w-[var(--hit-target)] items-center justify-center gap-2 transition-[filter,box-shadow]',
        'hover:brightness-110 active:shadow-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100',
        VARIANTS[variant],
        variant === 'primary' ? PRIMARY_EDGE[size === 'hero' ? 'hero' : 'other'] : '',
        SIZES[size],
        fullWidth ? 'w-full' : '',
        className,
      ].join(' ')}
      {...rest}
    />
  );
}
