import type { Color, Square } from '../model';
import { coordinateLabels, isLightSquare, piecesOf, squaresInOrder } from '../fen';
import { useBoardTheme } from './boardTheme';
import { BoardSquare } from './BoardSquare';

/**
 * Scacchiera in miniatura, non interattiva: la partita in corso nella home (REDESIGN_PLAN.md F14). Stesse case della
 * scacchiera di gioco, ma senza chess.js, così resta fuori dal chunk della partita. Per i lettori di schermo è
 * un'immagine con la sua descrizione.
 */
export interface MiniBoardProps {
  readonly fen: string;
  readonly orientation: Color;
  readonly lastMove?: { readonly from: Square; readonly to: Square } | null;
  /** Descrizione per i lettori di schermo, già tradotta. */
  readonly label: string;
  readonly className?: string;
}

export function MiniBoard({ fen, orientation, lastMove = null, label, className = '' }: MiniBoardProps) {
  const theme = useBoardTheme();
  const pieceOn = new Map(piecesOf(fen).map((piece) => [piece.square, piece]));
  return (
    <div
      role="img"
      aria-label={label}
      data-board-theme={theme}
      className={`grid aspect-square grid-cols-8 grid-rows-8 overflow-hidden rounded-6 shadow-board ${className}`}
    >
      {squaresInOrder(orientation).map((square, index) => (
        <div key={square} data-square={square} className={`@container relative ${isLightSquare(square) ? 'bg-board-light' : 'bg-board-dark'}`}>
          <BoardSquare
            light={isLightSquare(square)}
            piece={pieceOn.get(square)}
            lastMove={lastMove?.from === square || lastMove?.to === square}
            {...coordinateLabels(square, index)}
          />
        </div>
      ))}
    </div>
  );
}
