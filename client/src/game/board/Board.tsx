import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { Color, Square, SquareEffects } from '../model';
import { statePresentation } from '../../spells/effects.registry';
import { PieceIcon } from '../pieces/PieceIcon';
import { isLightSquare, kingInCheckSquare, piecesOf, squaresInOrder, type PlacedPiece } from '../position';
import { useBoardTheme } from './boardTheme';
import { coordinateLabels } from '../fen';
import { BoardSquare } from './BoardSquare';
import { dropOnSquare, tapSquare, type BoardContext, type PickupRefusal, type Selection } from './selection';

/**
 * Scacchiera: disegna la posizione che manda il server e raccoglie le mosse (tap-casella → tap-casella, più il drag).
 * Non conosce la connessione: riceve lo stato e chiama `onMove`.
 */

/**
 * Scacchiera in modalità targeting: si scelgono le caselle per una magia, non si muovono pezzi. Fuori dai bersagli
 * il tap annulla (briefing §7.5).
 */
export interface BoardTargeting {
  readonly squares: ReadonlySet<Square>;
  onPick(square: Square): void;
  onCancel(): void;
}

export interface BoardProps {
  readonly context: BoardContext;
  /** Orientamento: il proprio lato in basso; senza colore si guarda dalla parte del bianco. */
  readonly orientation: Color;
  /** Ultima mossa giocata, da evidenziare. */
  readonly lastMove: { readonly from: Square; readonly to: Square } | null;
  /** Mossa propria mostrata prima della conferma del server: solo un'anteprima grafica. */
  readonly optimistic: { readonly from: Square; readonly to: Square } | null;
  /** Stati persistenti per casella, dal server: il badge segue il pezzo perché lo segue la casella (G1). */
  readonly effects?: readonly SquareEffects[];
  /** Scelta dei bersagli di una magia in corso: `null` quando si gioca normalmente. */
  readonly targeting?: BoardTargeting | null;
  /** Caselle da far pulsare dopo la risoluzione di una magia. */
  readonly flash?: readonly Square[];
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

export function Board({
  context,
  orientation,
  lastMove,
  optimistic,
  effects = [],
  targeting = null,
  flash = [],
  onMove,
  onRefused,
}: BoardProps) {
  const { t } = useTranslation();
  const theme = useBoardTheme();
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

  // Entrando in targeting la selezione di una mossa decade: le due modalità non convivono.
  const [wasTargeting, setWasTargeting] = useState(targeting !== null);
  if (wasTargeting !== (targeting !== null)) {
    setWasTargeting(targeting !== null);
    setSelection(null);
  }

  const pieces = withOptimistic(piecesOf(context.fen), optimistic);
  const pieceOn = new Map(pieces.map((piece) => [piece.square, piece]));
  const checkSquare = kingInCheckSquare(context.fen);
  const effectsOn = new Map(effects.map((entry) => [entry.square, entry.effects]));
  const squareStatesOn = new Map(context.squareStates.map((entry) => [entry.square, entry.effects]));
  const flashing = new Set(flash);

  /** Etichetta accessibile di uno stato sul pezzo: "Congelato, ancora 2 turni". */
  function stateLabel(kind: string, remainingTurns: number): string {
    const state = statePresentation(kind).label(t);
    return remainingTurns === 1 ? t('spells.state.badgeOne', { state }) : t('spells.state.badgeMany', { state, count: remainingTurns });
  }

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

  /** Tap su una casella: in targeting sceglie un bersaglio (o annulla), altrimenti muove. */
  function onSquareClick(square: Square): void {
    if (targeting === null) {
      apply(tapSquare(context, selection, square));
      return;
    }
    if (targeting.squares.has(square)) targeting.onPick(square);
    else targeting.onCancel();
  }

  function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>, square: Square): void {
    // In targeting i pezzi non si trascinano: si sceglie un bersaglio.
    if (targeting !== null || event.button !== 0 || !pieceOn.has(square)) return;
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
      data-board-theme={theme}
      className="grid aspect-square w-full grid-cols-8 grid-rows-8 touch-none overflow-hidden rounded-6 shadow-board select-none"
    >
      {squares.map((square, index) => {
        const piece = pieceOn.get(square);
        // Prima gli stati della casa (muro, santuario), poi quelli del pezzo.
        const states = [...(squareStatesOn.get(square) ?? []), ...(effectsOn.get(square) ?? [])];
        const isTarget = targeting === null ? selection?.targets.includes(square) === true : targeting.squares.has(square);
        const pieceLabel =
          piece === undefined ? square : `${square}, ${t(`board.piece.${piece.kind}`)} ${t(piece.color === 'white' ? 'match.colorWhite' : 'match.colorBlack')}`;
        const label = [pieceLabel, ...states.map((state) => stateLabel(state.kind, state.remainingTurns))].join(', ');
        return (
          <button
            key={square}
            type="button"
            data-square={square}
            data-selected={selection?.from === square}
            data-target={isTarget}
            data-cast-target={targeting !== null && isTarget}
            aria-label={label}
            className={[
              '@container relative p-0',
              isLightSquare(square) ? 'bg-board-light' : 'bg-board-dark',
              flashing.has(square) ? 'spell-flash' : '',
            ].join(' ')}
            onPointerDown={(event) => onPointerDown(event, square)}
            onPointerMove={onPointerMove}
            onPointerUp={(event) => onPointerUp(event, square)}
            onClick={() => {
              if (skipClick.current) skipClick.current = false;
              else onSquareClick(square);
            }}
          >
            <BoardSquare
              light={isLightSquare(square)}
              piece={piece}
              ghost={dragging?.square === square}
              lastMove={lastMove?.from === square || lastMove?.to === square}
              selected={selection?.from === square}
              check={checkSquare === square}
              states={states}
              hint={isTarget ? (targeting === null ? 'move' : 'cast') : null}
              {...coordinateLabels(square, index)}
            />
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
