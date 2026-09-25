/**
 * Icone dei badge di stato sulla scacchiera, dai tracciati del componente Scacchiera del design: fiocco a tratto e
 * scudo pieno. Sono diverse dalle icone delle carte (`EffectIcon`), più grandi e dettagliate. I colori stanno nelle
 * classi di chi le usa (registry degli stati), mai qui.
 */

export type StateIconName = 'frost' | 'shield' | 'question';

export function StateIcon({ name, className = '' }: { name: StateIconName; className?: string }) {
  const common = { viewBox: '0 0 24 24', 'aria-hidden': true, focusable: false, className } as const;
  if (name === 'frost') {
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <path d="M12 2v20M3.3 7l17.4 10M20.7 7L3.3 17M9 4l3 2 3-2M9 20l3-2 3 2" />
      </svg>
    );
  }
  if (name === 'shield') {
    return (
      <svg {...common} fill="currentColor" stroke="var(--state-shield-ink)" strokeWidth="1.6" strokeLinejoin="round">
        <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
      </svg>
    );
  }
  return (
    <svg {...common} fill="currentColor" stroke="var(--bg-app)" strokeWidth="1.2">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7M12 17.2v.3" fill="none" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
