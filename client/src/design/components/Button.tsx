import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: Variant;
  readonly fullWidth?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-primary hover:bg-accent-hover',
  secondary: 'bg-elevated text-primary border border-subtle hover:border-muted',
  danger: 'bg-danger text-primary hover:opacity-90',
};

/** Bottone base: hit target ≥ 44px, focus visibile, stato disabilitato leggibile (briefing §6). */
export function Button({ variant = 'primary', fullWidth = false, className = '', type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={[
        'inline-flex min-h-[var(--hit-target)] items-center justify-center gap-2 rounded-md px-4 text-base font-semibold',
        'transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        fullWidth ? 'w-full' : '',
        className,
      ].join(' ')}
      {...rest}
    />
  );
}
