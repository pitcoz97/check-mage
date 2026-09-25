import type { ActiveEffect } from '../model';
import type { PlacedPiece } from '../fen';
import { StateBadge, statePresentation } from '../../spells/effects.registry';
import { PieceIcon } from '../pieces/PieceIcon';

/**
 * Contenuto visivo di una casa, dal componente Scacchiera del design (REDESIGN_PLAN.md §1.2), condiviso dalla
 * scacchiera di gioco e dalla miniatura. Chi lo usa fornisce il contenitore: `relative` e `@container`, perché
 * pezzo, badge e coordinate si misurano sulla casa.
 *
 * Strati, dal basso: veli (ultima mossa, selezione, scacco), stati del pezzo, pezzo, bersagli, badge, coordinate.
 */

/** Suggerimento sulla casa: mossa legale del pezzo scelto, oppure bersaglio di una magia. */
export type SquareHint = 'move' | 'cast' | null;

export interface BoardSquareProps {
  readonly light: boolean;
  readonly piece?: PlacedPiece | undefined;
  /** Il pezzo è in mano al drag: resta un'ombra al suo posto. */
  readonly ghost?: boolean;
  readonly lastMove?: boolean;
  readonly selected?: boolean;
  readonly check?: boolean;
  readonly states?: readonly ActiveEffect[];
  readonly hint?: SquareHint;
  /** Coordinate da scrivere nella casa: la traversa sulla prima colonna, la colonna sull'ultima traversa. */
  readonly rankLabel?: string | null;
  readonly fileLabel?: string | null;
}

const LAYER = 'pointer-events-none absolute';

export function BoardSquare({
  light,
  piece,
  ghost = false,
  lastMove = false,
  selected = false,
  check = false,
  states = [],
  hint = null,
  rankLabel = null,
  fileLabel = null,
}: BoardSquareProps) {
  // Le coordinate prendono il colore della casa opposta, come nel design.
  const coordinate = `${LAYER} text-[max(9px,19cqw)] leading-none font-bold ${light ? 'text-board-dark' : 'text-board-light'}`;
  return (
    <>
      {lastMove && <span aria-hidden="true" className={`${LAYER} inset-0 bg-board-last`} />}
      {selected && <span aria-hidden="true" className={`${LAYER} inset-0 bg-board-select`} />}
      {check && (
        <span
          aria-hidden="true"
          data-check
          className={`${LAYER} inset-0 bg-[radial-gradient(circle,var(--board-check)_0%,transparent_72%)]`}
        />
      )}
      {states.map((state) => {
        const veil = statePresentation(state.kind).veil;
        return veil === '' ? null : <span key={state.kind} aria-hidden="true" className={`${LAYER} ${veil}`} />;
      })}
      {piece !== undefined && (
        <span className={`${LAYER} inset-0 ${ghost ? 'opacity-30' : ''}`}>
          <PieceIcon kind={piece.kind} color={piece.color} />
        </span>
      )}
      {hint !== null && <HintMark hint={hint} occupied={piece !== undefined} />}
      {states.length > 0 && (
        <span aria-hidden="true" data-effects className={`${LAYER} top-[3px] right-[3px] flex flex-col items-end gap-px`}>
          {states.map((state) => (
            <span key={state.kind} className="flex items-center gap-px">
              <span className="rounded-pill bg-app/80 px-[0.35em] text-[max(8px,15cqw)] leading-tight font-bold text-primary tabular-nums">
                {state.remainingTurns}
              </span>
              <StateBadge kind={state.kind} className="size-[max(12px,26cqw)]" />
            </span>
          ))}
        </span>
      )}
      {rankLabel !== null && <span aria-hidden="true" data-coordinate className={`${coordinate} top-0.5 left-1`}>{rankLabel}</span>}
      {fileLabel !== null && <span aria-hidden="true" data-coordinate className={`${coordinate} right-1 bottom-px`}>{fileLabel}</span>}
    </>
  );
}

/**
 * Bersagli: punto sulla casa vuota, anello con velo sulla casa occupata. Magia in viola con alone (design), mossa
 * legale con la stessa forma nel colore della notte traslucido (D3): si distinguono per colore, non per forma.
 */
function HintMark({ hint, occupied }: { hint: Exclude<SquareHint, null>; occupied: boolean }) {
  const kind = hint === 'cast' ? 'cast' : occupied ? 'capture' : 'move';
  if (occupied) {
    return (
      <span
        aria-hidden="true"
        data-hint={kind}
        className={`${LAYER} inset-0 ${hint === 'cast' ? 'bg-board-cast-veil shadow-ring-cast-target' : 'shadow-ring-move-target'}`}
      />
    );
  }
  return (
    <span aria-hidden="true" data-hint={kind} className={`${LAYER} inset-0 flex items-center justify-center`}>
      <span className={`size-[30%] rounded-full ${hint === 'cast' ? 'bg-board-cast-dot shadow-glow-cast-dot' : 'bg-board-hint'}`} />
    </span>
  );
}
