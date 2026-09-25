import { WS } from '../serverTexts';
import type { PieceKind, TargetSpec } from './catalog';
import { EffectError, parsePlacement, parseSquare, pieceColor, pieceName, relativeRank, type Color } from './fen';
import { KIND_WALL } from './squares';
import type { Tracker } from './tracker';

/**
 * Porting di `effects/targets.go`: ogni bersaglio rispetta il suo `TargetSpec`, nello stesso ordine. I bersagli sono
 * caselle distinte e il re non è mai un bersaglio, salvo un `own_piece` che lo elenca in `pieces`.
 */

export function validateTargets(fen: string, tracker: Tracker, specs: readonly TargetSpec[], targets: readonly string[], caster: Color): void {
  const grid = parsePlacement(fen);
  const seen = new Set<string>();
  specs.forEach((spec, index) => {
    const square = targets[index];
    if (square === undefined) return;
    const reject = (reason: string, message: string) => new EffectError(WS.target(index, reason, square, message));

    let row: number;
    let col: number;
    try {
      [row, col] = parseSquare(square);
    } catch {
      throw reject('off_board', `casella non valida: ${JSON.stringify(square)}`);
    }
    if (seen.has(square)) throw reject('duplicate', `la casella ${square} è già stata scelta`);
    seen.add(square);
    const piece = grid[row]?.[col] ?? null;

    if (spec.type === 'square') {
      if (spec.empty_square === true && piece !== null) throw reject('not_empty', `la casella ${square} non è vuota`);
      // Una casa col muro non è vuota: niente muri impilati, niente pezzi evocati o teletrasportati lì.
      if (spec.empty_square === true && tracker.hasSquareEffect(square, KIND_WALL)) throw reject('wall', `la casella ${square} ha un muro`);
    } else {
      if (piece === null) throw reject('no_piece', `nessun pezzo in ${square}`);
      const own = pieceColor(piece) === caster;
      if (own !== (spec.type === 'own_piece')) throw reject('wrong_owner', `il pezzo in ${square} è del colore sbagliato`);
      const kindReason = pieceKindRefusal(spec, pieceName(piece) as PieceKind);
      if (kindReason !== null) throw reject(kindReason, `il pezzo in ${square} non è un bersaglio ammesso`);
      if (spec.require_effect !== undefined && !tracker.hasEffect(square, spec.require_effect)) {
        throw reject('missing_effect', `il pezzo in ${square} non ha l'effetto ${spec.require_effect}`);
      }
    }

    const previous = targets[index - 1];
    if (spec.max_distance !== undefined && spec.max_distance > 0 && previous !== undefined) {
      const d = chebyshev(previous, square);
      if (d > spec.max_distance) throw reject('too_far', `${square} è a distanza ${d}, massimo ${spec.max_distance}`);
    }
    const rank = relativeRank(square, caster);
    if (spec.own_ranks !== undefined && spec.own_ranks.length > 0 && !spec.own_ranks.includes(rank)) {
      throw reject('rank', `la traversa di ${square} non è ammessa`);
    }
    if (spec.min_rank !== undefined && spec.min_rank > 0 && rank < spec.min_rank) {
      throw reject('rank', `${square} è prima della traversa ${spec.min_rank}`);
    }
  });
}

function pieceKindRefusal(spec: TargetSpec, kind: PieceKind): string | null {
  if (kind === 'king') return spec.type === 'own_piece' && spec.pieces?.includes('king') === true ? null : 'king';
  if (spec.pieces !== undefined && spec.pieces.length > 0 && !spec.pieces.includes(kind)) return 'piece_kind';
  return null;
}

function chebyshev(a: string, b: string): number {
  try {
    const [ar, ac] = parseSquare(a);
    const [br, bc] = parseSquare(b);
    return Math.max(Math.abs(ar - br), Math.abs(ac - bc));
  } catch {
    return 99;
  }
}
