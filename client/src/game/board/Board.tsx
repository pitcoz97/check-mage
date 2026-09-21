import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { Color, Square } from '../model';
import { PieceIcon } from '../pieces/PieceIcon';
import { isLightSquare, kingInCheckSquare, piecesOf, squaresInOrder, type PlacedPiece } from '../position';
import { dropOnSquare, tapSquare, type BoardContext, type PickupRefusal, type Selection } from './selection';

/**
 * Scacchiera: disegna la posizione che manda il server e raccoglie le mosse (tap-casella → tap-casella, più il drag).
 * Non conosce la connessione: riceve lo stato e chiama `onMove`.
 */

export interface BoardProps {
  readonly context: BoardContext;
  /** Orientamento: il proprio lato in basso; senza colore si guarda dalla parte del bianco. */
  readonly orientation: Color;
  /** Ultima mossa giocata, da evidenziare. */
  readonly lastMove: { readonly from: Square; readonly to: Square } | null;
  /** Mossa propria mostrata prima della conferma del server: solo un'anteprima grafica. */
  readonly optimistic: { readonly from: Square; readonly to: Square } | null;
  onMove(from: Square, to: Square, promotion: boolean): void;
  onRefused(reason: PickupRefusal): void;
}

/** Applica l'anteprima della propria mossa alla posizione del server, senza calcolare nessuna regola. */
function withOptimistic(pieces: PlacedPiece[], optimistic: BoardProps['optimistic']): PlacedPiece[] {
  if (optimistic === null) return pieces;
  const moving = pieces.find((p) => p.square === optimistic.from);
  if (moving === undefined) return pieces;
  return [
    ...pieces.filter((p) => p.square !== optimistic.from && p.square !== optimistic.to),
    { ...moving, square: optimistic.to },
  ];
}

export function Board({ context, orientation, lastMove, optimistic, onMove, onRefused }: BoardProps) {
  const { t } = useTranslation();
  const [selection, setSelection] = useState<Selection>(null);
  /** Trascinamento in corso: porta con sé la selezione nata al pickup, così il tap-tap resta indipendente. */
  const [dragging, setDragging] = useState<{ square: Square; x: number; y: number; selection: Selection } | null>(null);
  /** Dopo un drag che ha prodotto una mossa il browser manda anche un click: va ignorato. */
  const skipClick = useRef(false);

  // Una posizione nuova (mossa dell'avversario, riconnessione) invalida la selezione: si azzera durante il
  // render, senza effetti (https://react.dev/learn/you-might-not-need-an-effect).
  const [seenFen, setSeenFen] = useState(context.fen);
  if (seenFen !== context.fen) {
    setSeenFen(context.fen);
    setSelection(null);
  }

  const pieces = withOptimistic(piecesOf(context.fen), optimistic);
  const pieceOn = new Map(pieces.map((piece) => [piece.square, piece]));
  const checkSquare = kingInCheckSquare(context.fen);

  function apply(outcome: ReturnType<typeof tapSquare>): void {
    if (outcome.kind === 'selection') setSelection(outcome.selection);
    else if (outcome.kind === 'refused') onRefused(outcome.reason);
    else {
      setSelection(null);
      onMove(outcome.from, outcome.to, outcome.promotion);
    }
  }

  function squareUnder(x: number, y: number): Square | null {
    // `elementFromPoint` manca in qualche ambiente di test: senza, il rilascio vale sulla casella di partenza.
    const at = document.elementFromPoint?.bind(document);
    const square = at?.(x, y)?.closest('[data-square]')?.getAttribute('data-square') ?? null;
    return square as Square | null;
  }

  function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>, square: Square): void {
    if (event.button !== 0 || !pieceOn.has(square)) return;
    const outcome = tapSquare(context, selection, square);
    // Il drag parte solo se il pickup è andato a buon fine; il tap resta la via principale.
    if (outcome.kind === 'selection' && outcome.selection?.from === square) {
      setDragging({ square, x: event.clientX, y: event.clientY, selection: outcome.selection });
      // La cattura del puntatore tiene il drag anche fuori dalla casella; manca in qualche ambiente di test.
      const capture = event.currentTarget.setPointerCapture?.bind(event.currentTarget);
      capture?.(event.pointerId);
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLButtonElement>): void {
    if (dragging === null) return;
    setDragging({ ...dragging, x: event.clientX, y: event.clientY });
  }

  function onPointerUp(event: ReactPointerEvent<HTMLButtonElement>, square: Square): void {
    if (dragging === null) return;
    const target = squareUnder(event.clientX, event.clientY) ?? square;
    setDragging(null);
    // Rilascio sulla casella di partenza: è un tap, lo gestisce il click che segue.
    if (target === dragging.square) return;
    skipClick.current = true;
    apply(dropOnSquare(context, dragging.selection, target));
  }

  const squares = squaresInOrder(orientation);
  const draggedPiece = dragging === null ? undefined : pieceOn.get(dragging.square);

  return (
    <div
      role="grid"
      aria-label={t('match.board')}
      className="grid aspect-square w-full grid-cols-8 grid-rows-8 touch-none overflow-hidden rounded-sm select-none"
    >
      {squares.map((square) => {
        const piece = pieceOn.get(square);
        const isTarget = selection?.targets.includes(square) === true;
        const label = piece === undefined ? square : `${square}, ${t(`board.piece.${piece.kind}`)} ${t(piece.color === 'white' ? 'match.colorWhite' : 'match.colorBlack')}`;
        return (
          <button
            key={square}
            type="button"
            data-square={square}
            data-selected={selection?.from === square}
            data-target={isTarget}
            aria-label={label}
            className={[
              'relative flex items-center justify-center p-0',
              isLightSquare(square) ? 'bg-board-light' : 'bg-board-dark',
              selection?.from === square ? 'outline outline-2 -outline-offset-2 outline-board-select' : '',
              lastMove?.from === square || lastMove?.to === square ? 'shadow-[inset_0_0_0_100vmax_var(--board-last)]' : '',
              checkSquare === square ? 'shadow-[inset_0_0_0_100vmax_var(--board-check)]' : '',
            ].join(' ')}
            onPointerDown={(event) => onPointerDown(event, square)}
            onPointerMove={onPointerMove}
            onPointerUp={(event) => onPointerUp(event, square)}
            onClick={() => {
              if (skipClick.current) skipClick.current = false;
              else apply(tapSquare(context, selection, square));
            }}
          >
            {piece !== undefined && (
              <span className={`pointer-events-none block size-[88%] ${dragging?.square === square ? 'opacity-30' : ''}`}>
                <PieceIcon kind={piece.kind} color={piece.color} />
              </span>
            )}
            {isTarget && (
              <span
                aria-hidden="true"
                data-hint={piece === undefined ? 'move' : 'capture'}
                className={
                  piece === undefined
                    ? 'pointer-events-none absolute size-1/3 rounded-full bg-board-hint'
                    : 'pointer-events-none absolute inset-0 rounded-full border-[6px] border-board-hint'
                }
              />
            )}
          </button>
        );
      })}
      {dragging !== null && draggedPiece !== undefined && (
        <span
          aria-hidden="true"
          className="pointer-events-none fixed z-50 block size-16 -translate-x-1/2 -translate-y-1/2"
          style={{ left: dragging.x, top: dragging.y }}
        >
          <PieceIcon kind={draggedPiece.kind} color={draggedPiece.color} />
        </span>
      )}
    </div>
  );
}
