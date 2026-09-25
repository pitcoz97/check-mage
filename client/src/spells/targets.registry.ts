import type { TFunction } from 'i18next';

import type { Color, SquareEffects, Square } from '../game/model';
import { piecesOf, squaresInOrder, type PlacedPiece } from '../game/position';
import type { ChoiceContext } from './effects.registry';
import { isKnownTargetType, type KnownTargetType, type Spell, type TargetSpec } from './schema';

/**
 * Registry dei bersagli: dal `TargetSpec` di ogni passo alle caselle da evidenziare (briefing §5.1.5).
 *
 * Il tipo del bersaglio (`square`, `own_piece`, `enemy_piece`) dà i candidati e l'istruzione; i filtri dello spec
 * (pezzi ammessi, stato richiesto, casa vuota, distanza, traverse) li restringono con le stesse regole del server
 * (`effects/targets.go`). È solo evidenziazione: quello che dipende dalla posizione risultante (uno scacco) lo decide
 * il server, e il client mostra il rifiuto.
 */

export interface TargetContext extends ChoiceContext {
  readonly fen: string;
  readonly myColor: Color;
  /** Stati attivi per casa (`active_effects`), per `require_effect`. */
  readonly effects: readonly SquareEffects[];
}

interface TargetTypeResolver {
  /** Caselle candidate per il solo tipo, prima dei filtri. */
  candidates(ctx: TargetContext): readonly Square[];
  /** Istruzione da mostrare mentre si sceglie. */
  prompt(t: TFunction): string;
}

const piecesOfColor = (ctx: TargetContext, own: boolean): Square[] =>
  piecesOf(ctx.fen)
    .filter((p) => (p.color === ctx.myColor) === own)
    .map((p) => p.square);

const RESOLVERS: Record<KnownTargetType, TargetTypeResolver> = {
  own_piece: { candidates: (ctx) => piecesOfColor(ctx, true), prompt: (t) => t('spells.prompt.own_piece') },
  enemy_piece: { candidates: (ctx) => piecesOfColor(ctx, false), prompt: (t) => t('spells.prompt.enemy_piece') },
  square: { candidates: () => squaresInOrder('white'), prompt: (t) => t('spells.prompt.square') },
};

/** `false` se il client non conosce il tipo di qualche bersaglio: la carta si vede ma non si può lanciare. */
export function targetsSupported(spell: Spell): boolean {
  return spell.targets.every((spec) => isKnownTargetType(spec.type));
}

/** Traversa vista da chi lancia: 1 = la sua prima (`effects.RelativeRank`). */
function relativeRank(square: Square, color: Color): number {
  const rank = Number(square[1]);
  return color === 'white' ? rank : 9 - rank;
}

function chebyshev(a: Square, b: Square): number {
  return Math.max(Math.abs(a.charCodeAt(0) - b.charCodeAt(0)), Math.abs(Number(a[1]) - Number(b[1])));
}

/** Le regole di `effects.ValidateTargets` per una casella al passo dato. */
function allowed(spec: TargetSpec, square: Square, piece: PlacedPiece | undefined, ctx: TargetContext, chosen: readonly Square[]): boolean {
  if (chosen.includes(square)) return false;
  if (spec.type === 'square') {
    if (spec.emptySquare && piece !== undefined) return false;
  } else {
    if (piece === undefined) return false;
    // Il re non è mai un bersaglio, salvo un proprio pezzo che lo elenca esplicitamente.
    if (piece.kind === 'king' && !(spec.type === 'own_piece' && spec.pieces.includes('king'))) return false;
    if (piece.kind !== 'king' && spec.pieces.length > 0 && !spec.pieces.includes(piece.kind)) return false;
    if (spec.requireEffect !== null) {
      const effects = ctx.effects.find((entry) => entry.square === square)?.effects ?? [];
      if (!effects.some((effect) => effect.kind === spec.requireEffect)) return false;
    }
  }
  const previous = chosen.at(-1);
  if (spec.maxDistance > 0 && previous !== undefined && chebyshev(previous, square) > spec.maxDistance) return false;
  const rank = relativeRank(square, ctx.myColor);
  if (spec.ownRanks.length > 0 && !spec.ownRanks.includes(rank)) return false;
  return !(spec.minRank > 0 && rank < spec.minRank);
}

/** Caselle da evidenziare al passo `chosen.length` di questa magia; vuoto se il passo non esiste o il tipo è ignoto. */
export function spellTargets(spell: Spell, ctx: TargetContext, chosen: readonly Square[]): readonly Square[] {
  const spec = spell.targets[chosen.length];
  if (spec === undefined || !isKnownTargetType(spec.type)) return [];
  const pieces = new Map(piecesOf(ctx.fen).map((piece) => [piece.square, piece]));
  return RESOLVERS[spec.type].candidates(ctx).filter((square) => allowed(spec, square, pieces.get(square), ctx, chosen));
}

/** Istruzione per il passo `step` della magia, o `null` se il passo non esiste. */
export function targetPrompt(t: TFunction, spell: Spell, step: number): string | null {
  const spec = spell.targets[step];
  if (spec === undefined || !isKnownTargetType(spec.type)) return null;
  return RESOLVERS[spec.type].prompt(t);
}
