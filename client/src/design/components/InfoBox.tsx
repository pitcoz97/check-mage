import type { HTMLAttributes } from 'react';

/**
 * Riquadro incassato delle tavole (il box del suggerimento, i campi): superficie `#1F1D24`, raggio 10. Il tono
 * aggiunge l'anello di stato del design: viola per ciò che chiede una scelta, oro per l'attesa, pericolo per le
 * conferme distruttive. Usato per avvisi e scelte che le tavole non disegnano (REDESIGN_PLAN.md D20).
 */
type Tone = 'neutral' | 'arcane' | 'gold' | 'danger';

const TONE: Record<Tone, string> = {
  neutral: 'shadow-ring-quiet',
  arcane: 'shadow-ring-hint-casting',
  gold: 'shadow-ring-gold',
  danger: 'shadow-ring-danger',
};

export function InfoBox({ tone = 'neutral', className = '', ...rest }: HTMLAttributes<HTMLDivElement> & { tone?: Tone }) {
  return <div className={`rounded-10 bg-sunken px-3.5 py-3 text-14 ${TONE[tone]} ${className}`} {...rest} />;
}
