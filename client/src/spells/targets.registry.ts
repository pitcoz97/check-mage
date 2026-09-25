import type { TFunction } from 'i18next';

import type { Color, Square } from '../game/model';
import { piecesOf, squaresInOrder } from '../game/position';
import { effectsAllowTarget } from './effects.registry';
import { isKnownTargetType, type KnownTargetType, type Spell } from './schema';

/**
 * Registry dei bersagli: `target_type` → quante caselle servono e quali evidenziare (briefing §5.1.5).
 *
 * Aggiungere un tipo di bersaglio = aggiungere un resolver, senza toccare la scacchiera. Qui ci sono solo le regole
 * che il server verifica sulla **forma** del bersaglio: quello che dipende dalla posizione risultante (un re che
 * resterebbe sotto scacco) lo decide lui, e il client mostra il rifiuto.
 */

export interface TargetContext {
  readonly fen: string;
  readonly myColor: Color;
}

export interface TargetResolver {
  /** Numero di caselle richieste (`spells/spells.go:37-46`). */
  readonly count: number;
  /** Caselle candidate al passo `step` (0-based). */
  candidates(ctx: TargetContext, step: number): readonly Square[];
  /** Istruzione da mostrare mentre si sceglie. */
  prompt(t: TFunction, step: number): string;
}

const opponentOf = (color: Color): Color => (color === 'white' ? 'black' : 'white');

const piecesOfColor = (ctx: TargetContext, color: Color): Square[] => piecesOf(ctx.fen).filter((p) => p.color === color).map((p) => p.square);

const emptySquares = (ctx: TargetContext): Square[] => {
  const occupied = new Set(piecesOf(ctx.fen).map((p) => p.square));
  return squaresInOrder('white').filter((square) => !occupied.has(square));
};

const RESOLVERS: Record<KnownTargetType, TargetResolver> = {
  none: {
    count: 0,
    candidates: () => [],
    prompt: (t) => t('spells.prompt.none'),
  },
  own_piece: {
    count: 1,
    candidates: (ctx) => piecesOfColor(ctx, ctx.myColor),
    prompt: (t) => t('spells.prompt.own_piece'),
  },
  enemy_piece: {
    count: 1,
    candidates: (ctx) => piecesOfColor(ctx, opponentOf(ctx.myColor)),
    prompt: (t) => t('spells.prompt.enemy_piece'),
  },
  piece: {
    count: 1,
    candidates: (ctx) => piecesOf(ctx.fen).map((p) => p.square),
    prompt: (t) => t('spells.prompt.piece'),
  },
  square: {
    count: 1,
    candidates: () => squaresInOrder('white'),
    prompt: (t) => t('spells.prompt.square'),
  },
  /** Due passi: un proprio pezzo e poi una casella **vuota** — il server non chiede una mossa legale
   *  (`effects.go:216-244`, porting in `mock-server/game/fen.ts:120`). */
  piece_move: {
    count: 2,
    candidates: (ctx, step) => (step === 0 ? piecesOfColor(ctx, ctx.myColor) : emptySquares(ctx)),
    prompt: (t, step) => t(step === 0 ? 'spells.prompt.piece_move.from' : 'spells.prompt.piece_move.to'),
  },
};

/** `null` se il client non conosce il tipo di bersaglio: la carta si vede ma non si può lanciare. */
export function targetResolver(targetType: string): TargetResolver | null {
  return isKnownTargetType(targetType) ? RESOLVERS[targetType] : null;
}

/**
 * Caselle da evidenziare al passo `step` per questa magia: i candidati del tipo di bersaglio, ristretti dagli
 * effetti (il re non si distrugge). Il filtro degli effetti vale per il primo bersaglio, che è quello su cui
 * agiscono.
 */
export function spellTargets(spell: Spell, ctx: TargetContext, step: number): readonly Square[] {
  const resolver = targetResolver(spell.targetType);
  if (resolver === null) return [];
  const candidates = resolver.candidates(ctx, step);
  if (step > 0) return candidates;
  const pieces = new Map(piecesOf(ctx.fen).map((piece) => [piece.square, piece]));
  return candidates.filter((square) => effectsAllowTarget(spell.effects, pieces.get(square)));
}
