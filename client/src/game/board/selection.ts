import type { Color, Phase, Square } from '../model';
import { legalTargets, needsPromotion, piecesOf } from '../position';

/**
 * Macchina della selezione sulla scacchiera: tap-casella → tap-casella (obbligatorio, è il pattern mobile) e drag,
 * che confluiscono negli stessi stati. È pura: decide cosa selezionare e quale mossa mandare, non manda nulla.
 *
 * Un rifiuto porta sempre un motivo leggibile: la UI lo mostra invece di non reagire (briefing §7.5).
 */

export const PICKUP_REFUSALS = ['not_connected', 'not_playing', 'not_your_turn', 'wrong_phase', 'not_your_piece', 'piece_frozen'] as const;
export type PickupRefusal = (typeof PICKUP_REFUSALS)[number];

export interface BoardContext {
  readonly fen: string;
  readonly myColor: Color | null;
  readonly activePlayer: Color | 'unknown';
  readonly phase: Phase | 'unknown';
  /** Caselle con un pezzo congelato, dagli `active_effects` del server: il pickup è bloccato prima del tentativo. */
  readonly frozen: ReadonlySet<Square>;
  /** Partita in corso e socket aperto. */
  readonly canAct: boolean;
}

/** `null` = nessuna casella selezionata. */
export type Selection = { readonly from: Square; readonly targets: readonly Square[] } | null;

export type BoardOutcome =
  | { readonly kind: 'selection'; readonly selection: Selection }
  | { readonly kind: 'move'; readonly from: Square; readonly to: Square; readonly promotion: boolean }
  | { readonly kind: 'refused'; readonly reason: PickupRefusal };

/** Motivo per cui il pezzo non si può prendere, `null` se si può. */
export function pickupRefusal(ctx: BoardContext, square: Square): PickupRefusal | null {
  const piece = piecesOf(ctx.fen).find((p) => p.square === square);
  if (piece === undefined || ctx.myColor === null || piece.color !== ctx.myColor) return 'not_your_piece';
  if (!ctx.canAct) return 'not_connected';
  if (ctx.activePlayer !== ctx.myColor) return 'not_your_turn';
  if (ctx.phase !== 'move') return 'wrong_phase';
  if (ctx.frozen.has(square)) return 'piece_frozen';
  return null;
}

function pickup(ctx: BoardContext, square: Square): BoardOutcome {
  const refusal = pickupRefusal(ctx, square);
  if (refusal !== null) return { kind: 'refused', reason: refusal };
  return { kind: 'selection', selection: { from: square, targets: legalTargets(ctx.fen, square) } };
}

function moveTo(ctx: BoardContext, from: Square, to: Square): BoardOutcome {
  return { kind: 'move', from, to, promotion: needsPromotion(ctx.fen, from, to) };
}

/**
 * Tap su una casella. Senza selezione prende il pezzo; con una selezione muove sul bersaglio valido, deseleziona se
 * si ritocca la casella di partenza, passa a un altro proprio pezzo, altrimenti annulla.
 */
export function tapSquare(ctx: BoardContext, selection: Selection, square: Square): BoardOutcome {
  if (selection === null) return pickup(ctx, square);
  if (square === selection.from) return { kind: 'selection', selection: null };
  if (selection.targets.includes(square)) return moveTo(ctx, selection.from, square);
  const next = pickup(ctx, square);
  // Tap su una casella qualsiasi: la selezione cade senza avvisi (non è un tentativo di mossa).
  return next.kind === 'selection' ? next : { kind: 'selection', selection: null };
}

/** Rilascio di un drag partito da `selection.from`: fuori dai bersagli la selezione resta, per continuare col tap. */
export function dropOnSquare(ctx: BoardContext, selection: Selection, square: Square): BoardOutcome {
  if (selection === null) return { kind: 'selection', selection: null };
  if (selection.targets.includes(square)) return moveTo(ctx, selection.from, square);
  return { kind: 'selection', selection };
}
