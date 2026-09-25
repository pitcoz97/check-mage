import type { Color, PieceKind, Square } from './model';

/**
 * Lettura del formato FEN per il **rendering**: dove stanno i pezzi e come si dispongono le case. Nessuna regola di
 * gioco e nessuna dipendenza da chess.js, così la miniatura della home resta fuori dal chunk della partita.
 * Le regole (mosse legali, scacco, promozione) restano in `position.ts`, e solo come spunto visivo.
 */

export interface PlacedPiece {
  readonly square: Square;
  readonly color: Color;
  readonly kind: PieceKind;
}

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'] as const;

const KIND_OF: Readonly<Record<string, PieceKind>> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

/** I pezzi sulla scacchiera. FEN illeggibile → nessun pezzo (la UI resta vuota, non esplode). */
export function piecesOf(fen: string): PlacedPiece[] {
  const rows = (fen.trim().split(/\s+/)[0] ?? '').split('/');
  if (rows.length !== RANKS.length) return [];
  const pieces: PlacedPiece[] = [];
  for (const [rowIndex, row] of rows.entries()) {
    let file = 0;
    for (const char of row) {
      if (/[1-8]/.test(char)) {
        file += Number(char);
        continue;
      }
      const kind = KIND_OF[char.toLowerCase()];
      const fileName = FILES[file];
      const rank = RANKS[rowIndex];
      if (kind === undefined || fileName === undefined || rank === undefined) return [];
      pieces.push({ square: `${fileName}${rank}`, color: char === char.toUpperCase() ? 'white' : 'black', kind });
      file += 1;
    }
    if (file !== FILES.length) return [];
  }
  return pieces;
}

/** Caselle nell'ordine di rendering: il proprio lato sta sempre in basso. */
export function squaresInOrder(orientation: Color): Square[] {
  const files = orientation === 'white' ? FILES : [...FILES].reverse();
  const ranks = orientation === 'white' ? RANKS : [...RANKS].reverse();
  return ranks.flatMap((rank) => files.map((file) => `${file}${rank}` as Square));
}

export function isLightSquare(square: Square): boolean {
  const file = FILES.indexOf(square[0] as (typeof FILES)[number]);
  const rank = Number(square[1]);
  return (file + rank) % 2 === 0;
}

/**
 * Coordinate scritte dentro le case, come nel design: la traversa sulla prima colonna a sinistra, la colonna
 * sull'ultima traversa in basso. `index` è la posizione nell'ordine di `squaresInOrder`, quindi seguono l'orientamento.
 */
export function coordinateLabels(square: Square, index: number): { rankLabel: string | null; fileLabel: string | null } {
  return {
    rankLabel: index % FILES.length === 0 ? square[1] ?? null : null,
    fileLabel: Math.floor(index / FILES.length) === RANKS.length - 1 ? square[0] ?? null : null,
  };
}
