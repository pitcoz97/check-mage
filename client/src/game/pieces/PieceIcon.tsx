import type { Color, PieceKind } from '../model';

/**
 * Pezzi del design: i glifi Unicode **pieni** per entrambi i colori, nel font dei pezzi ritagliato
 * (`src/design/fonts/checkmage-pieces.woff2`, REDESIGN_PLAN.md §10 D2). Il colore e il contorno li mette il CSS
 * (`.piece-light`/`.piece-dark`), la dimensione è l'80% del contenitore: la stessa icona serve la casa, il pezzo
 * trascinato e la promozione.
 */

/** U+FE0E chiede la forma "testo": senza, Android e iOS possono disegnare ♟ come emoji. */
const TEXT_PRESENTATION = '\u{FE0E}';

const GLYPHS: Record<PieceKind, string> = {
  king: '♚',
  queen: '♛',
  rook: '♜',
  bishop: '♝',
  knight: '♞',
  pawn: '♟',
};

export interface PieceIconProps {
  readonly kind: PieceKind;
  readonly color: Color;
  readonly className?: string;
}

export function PieceIcon({ kind, color, className = '' }: PieceIconProps) {
  return (
    <span aria-hidden="true" className={`@container flex size-full items-center justify-center ${className}`}>
      <span
        data-piece={`${color}-${kind}`}
        className={`font-pieces pb-[4%] text-[80cqw] leading-none ${color === 'white' ? 'piece-light' : 'piece-dark'}`}
      >
        {GLYPHS[kind] + TEXT_PRESENTATION}
      </span>
    </span>
  );
}
