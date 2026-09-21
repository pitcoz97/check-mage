/**
 * Icone degli effetti, disegnate per questo progetto (CREDITS.md) nello stesso spirito del set di pezzi: sagome
 * piene, nessun colore letterale. Il colore arriva da `currentColor`, cioè dalla classe di tono della carta.
 *
 * Una per **kind di effetto** e non per magia: una magia nuova con un effetto noto ha già la sua icona, e un kind
 * che il client non conosce prende quella neutra (§5.1.6).
 */

export const EFFECT_ICONS = ['burst', 'frost', 'shield', 'card', 'crystal', 'arrow', 'spark', 'question'] as const;
export type EffectIconName = (typeof EFFECT_ICONS)[number];

/** `viewBox` 24×24. Ogni voce è una lista di tracciati riempiti con `currentColor`. */
const SHAPES: Record<EffectIconName, string[]> = {
  // Distruzione: scoppio a otto punte.
  burst: ['M12 1.5l2.6 5.6 5.6-2.6-2.6 5.6 5.4 1.9-5.4 1.9 2.6 5.6-5.6-2.6L12 22.5l-2.6-5.6-5.6 2.6 2.6-5.6L1 10.5l5.4-1.9-2.6-5.6 5.6 2.6z'],
  // Gelo: fiocco a tre assi.
  frost: [
    'M11 1.5h2v21h-2z',
    'M2.3 6.5l1-1.7 18.4 10.6-1 1.7z',
    'M21.7 6.5l1 1.7L4.3 18.8l-1-1.7z',
    'M8 3.6l4 2.6 4-2.6 1.1 1.7L12 8.6 6.9 5.3z',
    'M8 20.4l4-2.6 4 2.6 1.1-1.7L12 15.4l-5.1 3.3z',
  ],
  // Scudo: stemma pieno.
  shield: ['M12 1.5l8.5 3v7.1c0 5-3.5 9.2-8.5 10.9-5-1.7-8.5-5.9-8.5-10.9V4.5z'],
  // Pesca: carta con l'angolo alzato.
  card: ['M5 2.5h9.5L19 7v14.5H5z', 'M14 2.9v4.4h4.3z'],
  // Mana: cristallo.
  crystal: ['M12 1.5l6.5 7.4L12 22.5 5.5 8.9z'],
  // Spostamento magico: freccia curva.
  arrow: ['M4 19.5c0-7.2 4.4-11.5 11-11.9V3.5l7 6.4-7 6.4v-4.1c-4.7.3-7.6 2.8-9 7.3z'],
  // Nessun effetto: scintilla piccola.
  spark: ['M12 5l1.7 5.3L19 12l-5.3 1.7L12 19l-1.7-5.3L5 12l5.3-1.7z'],
  // Ignoto: cerchio spezzato.
  question: ['M12 2.5a9.5 9.5 0 0 1 8.2 14.3l-1.8-1A7.4 7.4 0 0 0 12 4.6z', 'M3.8 7.2l1.8 1A7.4 7.4 0 0 0 12 19.4v2.1A9.5 9.5 0 0 1 3.8 7.2z', 'M10.6 10.6h2.8v2.8h-2.8z'],
};

export function EffectIcon({ name, className = '' }: { name: EffectIconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={className}>
      {SHAPES[name].map((d) => (
        <path key={d} d={d} fill="currentColor" />
      ))}
    </svg>
  );
}
