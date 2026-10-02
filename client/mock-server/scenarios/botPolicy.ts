import { CATALOG, LIMIT_PER_TURN, paramInt, paramStrings, type Spell } from '../game/catalog';
import { applyMove, isInCheck, legalMoves } from '../game/engine';
import { aroundKing, opponentOf, pawnsSideBySide, pieceAt, pieceColor, squareAttackedOn, squareName, type Color } from '../game/fen';
import { validateTargets } from '../game/targets';
import type { Tracker } from '../game/tracker';
import type { Rng } from '../util';
import type { WirePhase } from '../wire';

/**
 * Porting di `internal/bot`: le scelte del bot avversario per livello.
 * - Le magie seguono le stesse regole del Go (`bot/spells.go`, `bot/score.go`).
 * - Le mosse no: il mock non ha Stockfish. Il base muove a caso, l'intermedio prende il pezzo di valore più alto che
 *   può, l'avanzato guarda anche la risposta migliore dell'avversario (due mezze mosse). È l'unica parte non fedele
 *   (ASSUMPTIONS §13).
 */

export type BotLevel = 'base' | 'intermediate' | 'advanced';

export const BOT_LEVELS: readonly BotLevel[] = ['base', 'intermediate', 'advanced'];

export function isBotLevel(value: string): value is BotLevel {
  return (BOT_LEVELS as readonly string[]).includes(value);
}

/** `bot.MaxCastsPerPhase`. */
export const MAX_CASTS_PER_PHASE = 3;

/** `bot.View`. */
export interface BotView {
  fen: string;
  color: Color;
  phase: WirePhase;
  hand: readonly string[];
  mana: number;
  casts: Readonly<Record<string, number>>;
  graveyard: readonly string[];
  tracker: Tracker;
}

/** Gli stessi campi di `cast_spell`. */
export interface BotCast {
  spell_id: string;
  targets: string[];
  choice?: { piece: string };
}

interface Profile {
  randomMove: number;
  castChance: number;
  spells: 'random' | 'simple' | 'careful';
}

// `bot/levels.go`
const PROFILES: Record<BotLevel, Profile> = {
  base: { randomMove: 1, castChance: 0.5, spells: 'random' },
  intermediate: { randomMove: 0, castChance: 0, spells: 'simple' },
  advanced: { randomMove: 0, castChance: 0, spells: 'careful' },
};

// `bot/spells.go`
const SIMPLE_THRESHOLD = 0.3;
const MANA_WEIGHT = 0.35;
const MAX_TARGET_SETS = 400;
const SITUATIONAL = 0.1;

const randomIndex = (n: number, rng: Rng) => Math.floor(rng() * n);

const ALL_SQUARES: readonly string[] = Array.from({ length: 64 }, (_, i) => squareName(7 - Math.floor(i / 8), i % 8));

const KIND_VALUES: Readonly<Record<string, number>> = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9 };
const LETTER_VALUES: Readonly<Record<string, number>> = { p: 1, n: 3, b: 3, r: 5, q: 9 };

const kindValue = (kind: string | undefined) => (kind === undefined ? 0 : (KIND_VALUES[kind] ?? 0));
const pieceValue = (piece: string | null) => (piece === null ? 0 : (LETTER_VALUES[piece.toLowerCase()] ?? 0));

// --- Mosse -------------------------------------------------------------------------------------------------------

/** Valore del pezzo catturato da una mossa (0 se non cattura; l'en passant conta come casa vuota). */
const captureValue = (fen: string, move: string) => pieceValue(pieceAt(fen, move.slice(2, 4)));

/** Punteggio di una mossa per l'avanzato: cattura meno la cattura migliore dell'avversario dopo; il matto vince. */
function lookAhead(fen: string, move: string): number {
  const next = applyMove(fen, move);
  const replies = legalMoves(next);
  if (replies.length === 0) return isInCheck(next) ? 1000 : 0;
  return captureValue(fen, move) - Math.max(0, ...replies.map((reply) => captureValue(next, reply)));
}

/** Il migliore secondo score, a parità a caso. */
function best(moves: readonly string[], score: (move: string) => number, rng: Rng): string {
  let top: string[] = [];
  let topScore = -Infinity;
  for (const move of moves) {
    const s = score(move);
    if (s > topScore) [top, topScore] = [[move], s];
    else if (s === topScore) top.push(move);
  }
  return top[randomIndex(top.length, rng)] ?? moves[0] ?? '';
}

/** `bot.ChooseMove`, con le regole del mock al posto di Stockfish. `''` se non c'è nessuna mossa. */
export function chooseMove(level: BotLevel, fen: string, playable: readonly string[], special: readonly string[], rng: Rng): string {
  const all = [...playable, ...special];
  if (all.length === 0) return '';
  if (playable.length === 0 || rng() < PROFILES[level].randomMove) return all[randomIndex(all.length, rng)] ?? '';
  if (level === 'intermediate') return best(playable, (m) => captureValue(fen, m), rng);
  return best(playable, (m) => lookAhead(fen, m), rng);
}

// --- Magie -------------------------------------------------------------------------------------------------------

/** `bot.ChooseSpell`: la magia da lanciare ora, o `null` per passare. */
export function chooseSpell(level: BotLevel, view: BotView, rejected: ReadonlySet<string>, rng: Rng): BotCast | null {
  const options = castable(view, rejected);
  if (options.length === 0) return null;
  const profile = PROFILES[level];
  if (profile.spells === 'random') return rng() < profile.castChance ? randomCast(view, options, rng) : null;

  let chosen: BotCast | null = null;
  let bestScore = 0;
  let ties = 0;
  for (const spell of options) {
    const choice = choiceFor(view, spell);
    if (choice === null) continue;
    for (const targets of targetSets(view, spell, ALL_SQUARES, MAX_TARGET_SETS)) {
      let score = scoreCast(view, spell, targets, choice);
      if (profile.spells === 'careful') {
        score -= MANA_WEIGHT * spell.mana_cost;
        if (score <= 0) continue;
      } else if (score < SIMPLE_THRESHOLD) continue;
      const cast = toCast(spell, targets, choice);
      if (chosen === null || score > bestScore) [chosen, bestScore, ties] = [cast, score, 1];
      else if (score === bestScore) {
        ties++;
        if (randomIndex(ties, rng) === 0) chosen = cast;
      }
    }
  }
  return chosen;
}

const toCast = (spell: Spell, targets: string[], choice: string): BotCast =>
  choice === '' ? { spell_id: spell.id, targets } : { spell_id: spell.id, targets, choice: { piece: choice } };

function castable(view: BotView, rejected: ReadonlySet<string>): Spell[] {
  const out: Spell[] = [];
  const seen = new Set<string>();
  for (const id of view.hand) {
    const spell = CATALOG.get(id);
    if (spell === undefined || seen.has(id) || rejected.has(id) || spell.mana_cost > view.mana || !spell.phases.includes(view.phase)) continue;
    const limit = spell.limits?.[LIMIT_PER_TURN];
    if (limit !== undefined && (view.casts[id] ?? 0) >= limit) continue;
    seen.add(id);
    out.push(spell);
  }
  return out;
}

function randomCast(view: BotView, options: readonly Spell[], rng: Rng): BotCast | null {
  const order = [...options].sort(() => rng() - 0.5);
  for (const spell of order) {
    const choice = choiceFor(view, spell);
    if (choice === null) continue;
    const squares = [...ALL_SQUARES].sort(() => rng() - 0.5);
    const [targets] = targetSets(view, spell, squares, 1);
    if (targets !== undefined) return toCast(spell, targets, choice);
  }
  return null;
}

/** `bot.targetSets`: combinazioni di bersagli valide secondo `validateTargets`, al più `limit`. */
function targetSets(view: BotView, spell: Spell, squares: readonly string[], limit: number): string[][] {
  if (spell.targets.length === 0) return [[]];
  const out: string[][] = [];
  const walk = (prefix: string[]) => {
    if (prefix.length === spell.targets.length) {
      out.push(prefix);
      return;
    }
    for (const square of squares) {
      if (out.length >= limit) return;
      const next = [...prefix, square];
      try {
        validateTargets(view.fen, view.tracker, spell.targets, next, view.color);
      } catch {
        continue;
      }
      walk(next);
    }
  };
  walk([]);
  return out;
}

/** `bot.choiceFor`: `''` senza scelta, `null` se la magia ora non si può lanciare. */
function choiceFor(view: BotView, spell: Spell): string | null {
  for (const effect of spell.effects) {
    if (effect.kind === 'promote_piece') return strongest(paramStrings(effect.params, 'choices'), () => true);
    if (effect.kind === 'revive_piece') return strongest(paramStrings(effect.params, 'pieces'), (k) => view.graveyard.includes(k));
  }
  return '';
}

function strongest(kinds: readonly string[], allowed: (kind: string) => boolean): string | null {
  let top: string | null = null;
  for (const kind of kinds) {
    if (allowed(kind) && (top === null || kindValue(kind) > kindValue(top))) top = kind;
  }
  return top;
}

const isOwn = (piece: string, color: Color) => pieceColor(piece) === color;

/** `bot.scoreCast`. */
function scoreCast(view: BotView, spell: Spell, targets: readonly string[], choice: string): number {
  const enemy = opponentOf(view.color);
  let square = '';
  let piece: string | null = null;
  for (const t of targets) {
    const p = pieceAt(view.fen, t);
    if (p !== null) {
      [square, piece] = [t, p];
      break;
    }
  }
  const own = piece !== null && isOwn(piece, view.color);
  const value = pieceValue(piece);

  let score = 0;
  for (const effect of spell.effects) {
    switch (effect.kind) {
      case 'destroy_piece':
        score += own ? -value : value;
        break;
      case 'freeze_piece':
        if (piece !== null && !view.tracker.isFrozen(square)) score += own ? -value / 2 : value / 2;
        break;
      case 'freeze_all': {
        const kinds = paramStrings(effect.params, 'pieces');
        score += 0.3 * countPieces(view, enemy, kinds, (sq) => !view.tracker.isFrozen(sq));
        break;
      }
      case 'shield_piece':
        if (own && !view.tracker.hasShield(square)) score += squareAttackedOn(view.fen, square, enemy) ? 0.7 * value : 0.1;
        break;
      case 'shield_area': {
        const params = effect.params ?? {};
        const area =
          params['around'] === 'own_king'
            ? aroundKing(view.fen, view.color, paramInt(params, 'radius', 1))
            : params['filter'] === 'own_pawns_side_by_side'
              ? pawnsSideBySide(view.fen, view.color)
              : [];
        for (const sq of area) {
          if (!view.tracker.hasShield(sq) && squareAttackedOn(view.fen, sq, enemy)) score += 0.7 * pieceValue(pieceAt(view.fen, sq));
        }
        break;
      }
      case 'draw_card':
        score += paramInt(effect.params, 'amount', 1);
        break;
      case 'gain_mana':
        score += 0.3 * paramInt(effect.params, 'amount', 1);
        break;
      case 'summon_pawn':
        score += 1;
        break;
      case 'revive_piece':
        score += kindValue(choice);
        break;
      case 'promote_piece':
        score += kindValue(choice) - 1;
        break;
      case 'move_piece':
        score += 0.3;
        break;
      default:
        score += SITUATIONAL;
    }
  }
  return score;
}

const LETTER_KINDS: Readonly<Record<string, string>> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

function countPieces(view: BotView, color: Color, kinds: readonly string[], keep: (square: string) => boolean): number {
  let n = 0;
  for (const square of ALL_SQUARES) {
    const p = pieceAt(view.fen, square);
    if (p === null || !isOwn(p, color)) continue;
    const kind = LETTER_KINDS[p.toLowerCase()] ?? '';
    if (kind === 'king' || (kinds.length > 0 && !kinds.includes(kind))) continue;
    if (keep(square)) n++;
  }
  return n;
}
