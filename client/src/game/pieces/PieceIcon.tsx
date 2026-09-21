import type { Color, PieceKind } from '../model';

/**
 * Set di pezzi disegnato per questo progetto (CREDITS.md): stessa sagoma per i due colori, che si distinguono solo
 * per il riempimento, e un contorno unico che li tiene leggibili su entrambe le caselle. Nessun colore letterale:
 * tutto da `tokens.css`.
 *
 * `viewBox` 45×45, come i set da scacchiera classici, così una sagoma si può sostituire senza toccare il layout.
 */

const BASE = 'M10.5 37.5h24l2 4.5h-28z';

const SHAPES: Record<PieceKind, string[]> = {
  pawn: ['M22.5 8.5a5 5 0 1 1 0 10 5 5 0 0 1 0-10z', 'M17.5 19.5c3 2 7 2 10 0l3.5 15h-17z', BASE],
  knight: [
    'M14 37.5c0-8 3.5-12.5 9-15.5 2-1.1 2.2-2.8 1-4.2l-3.4 2.3-2-3.2c-1.2 2.2-3 3.9-5.3 4.9-2 .8-1.2-3 1-6.2 3-4.3 8-7.1 13.2-7.1 6 0 10 5.3 11 12.3.9 6 .4 11.6-.4 16.7z',
    BASE,
  ],
  bishop: [
    'M22.5 6.5c4.2 4.3 7.5 8.6 7.5 12.8 0 4.4-3.3 6.9-7.5 6.9s-7.5-2.5-7.5-6.9c0-4.2 3.3-8.5 7.5-12.8z',
    'M22.5 10.5v10M19 16.5h7',
    'M14.5 26.5h16l1.5 5h-19z',
    'M13 32.5h19l1.5 5h-22z',
    BASE,
  ],
  rook: [
    'M11 8.5h4.5v3.5h4.5V8.5h5v3.5h4.5V8.5H34v9l-3 3H14l-3-3z',
    'M14.5 20.5h16l1.5 12h-19z',
    'M12 32.5h21l1.5 5h-24z',
    BASE,
  ],
  queen: [
    'M9 13.5l3.5 12h20l3.5-12-6 6.5-3.5-9.5-3.5 9.5-3.5-9.5-3.5 9.5z',
    'M11.5 26.5h22l1 6h-24z',
    'M12 33.5h21l1 4h-23z',
    BASE,
  ],
  king: [
    'M21 5.5h3v3.5h3.5v3H24v3.5h-3V12h-3.5V9H21z',
    'M22.5 16.5c-6.3 0-10.5 4.1-10.5 9.2 0 4.3 3.6 7.3 10.5 7.3s10.5-3 10.5-7.3c0-5.1-4.2-9.2-10.5-9.2z',
    'M12 33.5h21l1 4h-23z',
    BASE,
  ],
};

/** Cerchietti sulle punte della corona: solo la donna. */
const QUEEN_DOTS: readonly { cx: number; cy: number }[] = [
  { cx: 9, cy: 13.5 },
  { cx: 15, cy: 10 },
  { cx: 22.5, cy: 8 },
  { cx: 30, cy: 10 },
  { cx: 36, cy: 13.5 },
];

export interface PieceIconProps {
  readonly kind: PieceKind;
  readonly color: Color;
  readonly className?: string;
}

export function PieceIcon({ kind, color, className = '' }: PieceIconProps) {
  const fill = color === 'white' ? 'var(--piece-light)' : 'var(--piece-dark)';
  return (
    <svg viewBox="0 0 45 45" aria-hidden="true" focusable="false" className={`size-full ${className}`}>
      <g fill={fill} stroke="var(--piece-edge)" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round">
        {SHAPES[kind].map((d, i) => (
          <path key={i} d={d} fill={kind === 'bishop' && i === 1 ? 'none' : fill} />
        ))}
        {kind === 'queen' && QUEEN_DOTS.map((dot) => <circle key={dot.cx} cx={dot.cx} cy={dot.cy} r="1.9" />)}
      </g>
    </svg>
  );
}
