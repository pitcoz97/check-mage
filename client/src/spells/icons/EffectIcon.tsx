import type { ReactNode } from 'react';

/**
 * Icone degli effetti, a tratto come nel componente Carta del design (1.8px, estremità arrotondate). Il colore arriva
 * da `currentColor`, cioè dalla classe di chi le usa (l'arte della carta prende il colore dal registry).
 *
 * Una per **kind di effetto** e non per magia: una magia nuova con un effetto noto ha già la sua icona, e un kind
 * che il client non conosce prende quella neutra (§5.1.6). Salto, gelo, scudo e fulmine sono i tracciati del design;
 * pesca è l'icona "carte in mano" delle tavole della partita; cristallo, scintilla e punto di domanda seguono lo
 * stesso stile (REDESIGN_PLAN.md §10, D20).
 */

export const EFFECT_ICONS = ['burst', 'frost', 'shield', 'card', 'crystal', 'arrow', 'spark', 'question'] as const;
export type EffectIconName = (typeof EFFECT_ICONS)[number];

/** `viewBox` 24×24. */
const SHAPES: Record<EffectIconName, ReactNode> = {
  // Distruzione: fulmine.
  burst: <path d="M13.5 2L5 13.5h6.2L10 22l9-12h-6.3z" />,
  // Gelo: fiocco a tre assi con le punte.
  frost: (
    <path d="M12 2v20M3.3 7l17.4 10M20.7 7L3.3 17M9 4l3 2.5L15 4M9 20l3-2.5 3 2.5M4 10.5l3.5-.5L6 6.8M20 13.5l-3.5.5 1.5 3.2M4 13.5l3.5.5L6 17.2M20 10.5l-3.5-.5L18 6.8" />
  ),
  // Scudo con la runa.
  shield: (
    <>
      <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
      <path d="M12 7.5v9M9.3 10.2L12 7.5l2.7 2.7M9.5 16.5h5" />
    </>
  ),
  // Pesca: due carte.
  card: (
    <>
      <rect x="8" y="4" width="10" height="14" rx="1.5" transform="rotate(10 13 11)" />
      <rect x="5" y="5" width="10" height="14" rx="1.5" transform="rotate(-8 10 12)" />
    </>
  ),
  // Mana: cristallo sfaccettato.
  crystal: (
    <>
      <path d="M12 2.5l6.5 8.5L12 21.5 5.5 11z" />
      <path d="M5.5 11h13M12 2.5v19" />
    </>
  ),
  // Spostamento magico: il salto, con la scia.
  arrow: (
    <>
      <path d="M4 19c1.5-8 7.5-12.5 14-11" />
      <path d="M15 4.5L18.5 8 15 11.5" />
      <circle cx="4" cy="19" r="1.6" />
      <path d="M8 21h2M12 19.5h1.5" />
    </>
  ),
  // Nessun effetto: la scintilla del box del suggerimento.
  spark: <path d="M12 3l1.8 4.6L18.5 9.5l-4.7 1.9L12 16l-1.8-4.6L5.5 9.5l4.7-1.9z" />,
  // Ignoto: punto di domanda nel cerchio.
  question: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.6a2.4 2.4 0 1 1 3.4 2.2c-.6.3-1 .8-1 1.5v.6M12 16.8v.2" />
    </>
  ),
};

export function EffectIcon({ name, className = '' }: { name: EffectIconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {SHAPES[name]}
    </svg>
  );
}
