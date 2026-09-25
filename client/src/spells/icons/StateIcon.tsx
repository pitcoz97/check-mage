/**
 * Icone dei badge di stato sulla scacchiera, dai tracciati del componente Scacchiera del design: fiocco a tratto e
 * scudo pieno. Sono diverse dalle icone delle carte (`EffectIcon`), più grandi e dettagliate. I colori stanno nelle
 * classi di chi le usa (registry degli stati), mai qui.
 */

export type StateIconName = 'frost' | 'shield' | 'wall' | 'sanctuary' | 'rune' | 'return' | 'burst' | 'question';

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
  if (name === 'wall') {
    // Non disegnata dal design (D20): tre file di mattoni.
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
        <path d="M3 5h18v14H3zM3 9.7h18M3 14.3h18M9 5v4.7M15 5v4.7M6 9.7v4.6M12 9.7v4.6M18 9.7v4.6M9 14.3V19M15 14.3V19" />
      </svg>
    );
  }
  if (name === 'rune') {
    // Non disegnate dal design (D20), provvisorie: un glifo runico; per il ritorno una freccia che torna indietro,
    // per l'esplosione una stella a otto punte.
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 3v18M8 8l8-5M8 13l8 5" />
      </svg>
    );
  }
  if (name === 'return') {
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3" />
      </svg>
    );
  }
  if (name === 'burst') {
    return (
      <svg {...common} fill="currentColor" stroke="var(--bg-app)" strokeWidth="1" strokeLinejoin="round">
        <path d="M12 2l2 6 6-3-3 6 6 1-6 2 3 6-6-3-2 6-2-6-6 3 3-6-6-2 6-1-3-6 6 3z" />
      </svg>
    );
  }
  if (name === 'sanctuary') {
    // Non disegnata dal design (D20): un frontone su due colonne.
    return (
      <svg {...common} fill="currentColor" stroke="var(--state-shield-ink)" strokeWidth="1.4" strokeLinejoin="round">
        <path d="M12 3l9 5H3zM5 10h3v8H5zM16 10h3v8h-3zM3 19h18v2H3z" />
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
