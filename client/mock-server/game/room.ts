import { INFO, WS, type GameError } from '../serverTexts';
import type { Rng } from '../util';
import type { WireServerMessage, WireServerType } from '../wire';
import { paramBool, paramInt, paramStringMap, paramStrings, type Spell } from './catalog';
import { getGameStatus, isMoveLegal, applyMove as engineApplyMove } from './engine';
import {
  aroundKing,
  clearStaleEnPassant,
  countPieces,
  destroyPiece,
  EffectError,
  forwardSquare,
  isKingAttacked,
  movePieceFen,
  opponentOf,
  passTurn,
  pawnsSideBySide,
  pieceAt,
  pieceColor,
  pieceLetter,
  pieceName,
  piecesOf,
  placePiece,
  relativeRank,
  restoreCastling,
  setPiece,
  sideToMove,
  swapPieces,
  type Color,
} from './fen';
import {
  CastError,
  MatchState,
  type AdvanceResult,
  type DrawResult,
  type GraveEntry,
  type ManaState,
  type MatchOverrides,
} from './match';
import { validateTargets } from './targets';
import { KIND_SHIELD, Tracker, type ExpiredEffect } from './tracker';

/**
 * Porting di `game/room.go` (branch `fix/backend-requests`). I commenti `room.go:N` rimandano alla riga del server.
 */

/** Il `*Client` di Go: identità + canale d'uscita non bloccante (`client.go:155-176`). */
export interface GameClient {
  readonly userId: number;
  readonly username: string;
  send(message: WireServerMessage): void;
  /** `closeWith` (`client.go:142-153`): chiusura con codice applicativo. Assente per bot e segnaposto. */
  close?(code: number, reason: string): void;
}

export type GameResult = '1-0' | '0-1' | '1/2-1/2';

/** Codice di chiusura di una connessione sostituita (`game/client.go:28`). */
export const CLOSE_REPLACED = 4001;

/** `NullMove` (`room.go:37`): mossa consumata da uno scudo, `--` nel PGN. */
export const NULL_MOVE = '0000';

export interface RoomOptions {
  id: string;
  white: GameClient;
  black: GameClient;
  rng: Rng;
  baseTimeMs: number;
  incrementMs: number;
  reconnectTimeoutMs: number;
  overrides?: MatchOverrides;
  /** Solo test: posizione iniziale diversa da quella standard (il server parte sempre da `room.go:83`). */
  initialFen?: string;
  /** `room.go:1280-1281`. */
  tickMs?: number;
  broadcastMs?: number;
  /** Equivale alla goroutine di `announceEnd`: `SaveGame` + `RemoveRoom` (`room.go:1246-1256`). */
  onEnded?: (room: Room, result: GameResult, reason: string) => void;
}

interface Board {
  fen: string;
  moves: string[];
  turn: Color;
  status: string;
}

/** Esito di una partita appena conclusa, da annunciare (`room.go:1196-1202`). */
interface GameEnd {
  result: GameResult;
  reason: string;
  winner: string | null;
}

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** `json.Unmarshal` del payload in una struct: `undefined` (payload assente) è un errore, `null` no. */
function decodePayload(payload: unknown, fields: Record<string, 'string' | 'string[]'>): Record<string, unknown> | null {
  if (payload === undefined) return null;
  if (payload === null) return {};
  if (typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  for (const [key, type] of Object.entries(fields)) {
    const value = record[key];
    if (value === undefined || value === null) continue;
    if (type === 'string' && typeof value !== 'string') return null;
    if (type === 'string[]' && (!Array.isArray(value) || !value.every((v) => typeof v === 'string'))) return null;
  }
  return record;
}

/** `captureSquare` (`room.go:413-421`): casella del pezzo catturato, anche per l'en passant; `null` se non cattura. */
function captureSquare(fen: string, from: string, to: string): string | null {
  if (pieceAt(fen, to) !== null) return to;
  const mover = pieceAt(fen, from);
  if ((mover === 'P' || mover === 'p') && from[0] !== to[0]) return `${to[0]}${from[1]}`;
  return null;
}

/**
 * `validateNoCheck` (`room.go`): niente scacco da magia, in main1 come in main2. Il re di chi lancia non resta sotto
 * scacco; il re avversario non va sotto scacco per la magia (se lo era già per la mossa del turno, la magia è ammessa).
 */
function validateNoCheck(before: string, after: string, caster: Color): void {
  if (isKingAttacked(after, caster)) throw new EffectError(WS.kingLeftInCheck(caster));
  const opponent = opponentOf(caster);
  if (isKingAttacked(after, opponent) && !isKingAttacked(before, opponent)) throw new EffectError(WS.spellGivesCheck(opponent));
}

/**
 * `moveEndpoints` (`room.go`): partenza e arrivo di un `move_piece`, dai due bersagli oppure, con `relative:
 * "forward"`, dal solo pezzo e dai passi in avanti. Il movimento relativo non cattura e con `no_promotion` non arriva
 * all'ultima traversa.
 */
function moveEndpoints(fen: string, params: Record<string, unknown> | undefined, targets: string[], caster: Color): [string, string] {
  const relative = typeof params?.['relative'] === 'string' ? params['relative'] : '';
  const from = targets[0];
  if (relative === '') {
    const to = targets[1];
    if (from === undefined || to === undefined) throw new EffectError(WS.moveNeedsTwo(targets.length));
    return [from, to];
  }
  if (relative !== 'forward' || from === undefined) throw new EffectError(WS.unsupportedRelative(relative));
  const to = forwardSquare(from, caster, paramInt(params, 'squares', 1));
  if (pieceAt(fen, to) !== null) throw new EffectError(WS.forwardBlocked(to));
  if (paramBool(params, 'no_promotion') && relativeRank(to, caster) === 8) throw new EffectError(WS.wouldPromote(to));
  return [from, to];
}

export class Room {
  readonly id: string;
  white: GameClient;
  black: GameClient;
  readonly board: Board;
  readonly match: MatchState;
  tracker: Tracker;
  whiteTime: number;
  blackTime: number;
  private drawOfferer: GameClient | null = null;
  private readonly disconnectedTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly posCounts = new Map<string, number>();
  private timers: ReturnType<typeof setInterval>[] = [];
  private timerStarted = false;
  /** `room.go:56`: la partita è conclusa, nessuna azione è più accettata. */
  private ended = false;
  /** Solo test: `dispose` impedisce al timer di ripartire. */
  private disposed = false;

  /** `room.go:76-98`. */
  constructor(private readonly options: RoomOptions) {
    this.id = options.id;
    const fen = options.initialFen ?? START_FEN;
    this.board = { fen, moves: [], turn: sideToMove(fen), status: 'active' };
    this.white = options.white;
    this.black = options.black;
    this.match = new MatchState(options.rng, options.overrides);
    this.whiteTime = options.baseTimeMs;
    this.blackTime = options.baseTimeMs;
    this.tracker = new Tracker(this.board.fen);
    this.recordPosition();
  }

  /** Seconda metà di `NewRoom` (`room.go:103-121`), separata per poter agganciare i client prima dei broadcast. */
  start(): void {
    this.broadcastState();
    this.sendHand('white');
    this.sendHand('black');
    for (const res of this.match.autoAdvance()) this.applyAdvanceBroadcasts(res);
    this.ensureTimer();
  }

  // --- Messaggi -------------------------------------------------------------------------------------

  /** `room.go:365-408`. */
  handleMessage(sender: GameClient, type: string, payload: unknown): void {
    switch (type) {
      case 'move': {
        const data = decodePayload(payload, { move: 'string' });
        if (data === null) return this.sendError(sender, WS.malformedMove);
        return this.handleMove(sender, typeof data['move'] === 'string' ? data['move'] : '');
      }
      case 'pass_phase':
        return this.handlePassPhase(sender);
      case 'cast_spell': {
        const data = decodePayload(payload, { spell_id: 'string', targets: 'string[]' });
        if (data === null) return this.sendError(sender, WS.malformedCast);
        const targets = Array.isArray(data['targets']) ? (data['targets'] as string[]) : null;
        // `choice` è un oggetto `{piece}`: un tipo sbagliato fa fallire lo Unmarshal come nel server.
        const rawChoice = data['choice'];
        if (rawChoice !== undefined && rawChoice !== null && (typeof rawChoice !== 'object' || Array.isArray(rawChoice))) {
          return this.sendError(sender, WS.malformedCast);
        }
        const piece = (rawChoice as Record<string, unknown> | null | undefined)?.['piece'];
        if (piece !== undefined && piece !== null && typeof piece !== 'string') return this.sendError(sender, WS.malformedCast);
        const choice = typeof piece === 'string' ? piece : '';
        return this.handleCastSpell(sender, typeof data['spell_id'] === 'string' ? data['spell_id'] : '', targets, choice);
      }
      case 'resign':
        return this.handleResign(sender);
      case 'draw_offer':
        return this.handleDrawOffer(sender);
      case 'draw_accepted':
        return this.handleDrawResponse(sender, true);
      case 'draw_declined':
        return this.handleDrawResponse(sender, false);
      default:
        return this.sendError(sender, WS.unknownType(type));
    }
  }

  /** `room.go:423-570`. */
  private handleMove(sender: GameClient, move: string): void {
    if (this.ended) return this.sendError(sender, WS.gameOver);
    const senderColor = this.getColor(sender);
    if (senderColor !== this.board.turn) return this.sendError(sender, WS.notYourTurn);
    if (this.match.currentPhase !== 'move') return this.sendError(sender, WS.cannotMoveInPhase(this.match.currentPhase));
    if (move.length < 4 || !isMoveLegal(this.board.fen, move)) return this.sendError(sender, WS.illegalMove(move));

    const from = move.slice(0, 2);
    const to = move.slice(2, 4);
    if (this.tracker.isFrozen(from)) return this.sendError(sender, WS.frozen(from));

    // Lo scudo assorbe la cattura (anche en passant), salvo che la mossa nulla lasci in scacco chi muove:
    // la cattura era l'unico modo di uscire dallo scacco, quindi lo scudo si rompe (`room.go:461-473`).
    const captured = captureSquare(this.board.fen, from, to);
    const graveOwners: Color[] = [];
    let shieldAbsorbed = captured !== null && this.tracker.hasShield(captured);
    if (shieldAbsorbed && isKingAttacked(passTurn(this.board.fen), senderColor)) shieldAbsorbed = false;

    if (senderColor === 'white') this.whiteTime += this.options.incrementMs;
    else this.blackTime += this.options.incrementMs;

    if (shieldAbsorbed && captured !== null) {
      this.tracker.consumeShield(captured);
      this.board.fen = passTurn(this.board.fen);
      this.board.moves.push(NULL_MOVE);
    } else {
      // Il pezzo catturato (anche en passant) va nel cimitero del proprietario.
      const owner = captured === null ? null : this.buryCaptured(captured);
      if (owner !== null) graveOwners.push(owner);
      this.board.moves.push(move);
      this.board.fen = engineApplyMove(this.board.fen, move);
      this.tracker.movePiece(from, to, move.length >= 5 ? (move[4] as string) : null);
    }
    this.board.turn = sideToMove(this.board.fen);
    this.recordPosition();

    // L'offerta di patta decade quando chi l'ha ricevuta muove (`room.go:503-508`).
    let drawOfferExpiredFor: GameClient | null = null;
    if (this.drawOfferer !== null && this.drawOfferer.userId !== sender.userId) {
      this.drawOfferer = null;
      drawOfferExpiredFor = this.getOpponent(sender);
    }

    let status = this.gameStatus();
    if (status === 'ongoing' && this.isThreefold()) status = 'draw';

    let end: GameEnd | null = null;
    let results: AdvanceResult[] = [];
    let expired: ExpiredEffect[] = [];
    switch (status) {
      case 'checkmate':
        end = this.finish(senderColor === 'white' ? '1-0' : '0-1', 'checkmate', 'checkmate');
        break;
      case 'stalemate':
        end = this.finish('1/2-1/2', 'stalemate', 'stalemate');
        break;
      case 'draw':
        end = this.finish('1/2-1/2', 'draw', 'draw');
        break;
      case 'ongoing':
        results = [this.match.advance(), ...this.match.autoAdvance()];
        expired = this.tickEffectsOnNewTurn(results);
    }

    if (shieldAbsorbed) {
      this.broadcast('effect_expired', { square: captured, effect_kind: KIND_SHIELD, reason: 'shield_absorbed' });
    }
    drawOfferExpiredFor?.send(msg('draw_declined', { message: INFO.drawLapsed(sender.username), reason: 'move_played' }));
    // Lo stato parte anche a fine partita: i client vedono la mossa decisiva prima del game_over.
    this.broadcastState();
    this.broadcastGraveyards(graveOwners);
    for (const res of results) this.applyAdvanceBroadcasts(res);
    this.broadcastExpired(expired);
    this.announceEnd(end);
  }

  /** `room.go:573-620`. */
  private handlePassPhase(sender: GameClient): void {
    if (this.ended) return this.sendError(sender, WS.gameOver);
    const senderColor = this.getColor(sender);
    if (!this.match.isActive(senderColor)) return this.sendError(sender, WS.notYourTurn);
    if (!this.match.allows('pass_phase')) return this.sendError(sender, WS.cannotPassInPhase(this.match.currentPhase));

    const results = [this.match.advance(), ...this.match.autoAdvance()];
    const expired = this.tickEffectsOnNewTurn(results);
    const end = this.checkRolloverGameEnd(results);
    for (const res of results) this.applyAdvanceBroadcasts(res);
    this.broadcastExpired(expired);
    if (end !== null) this.broadcastState();
    this.announceEnd(end);
  }

  /** `room.go:624-718`. */
  private handleCastSpell(sender: GameClient, spellId: string, targets: string[] | null, choice: string): void {
    if (this.ended) return this.sendError(sender, WS.gameOver);
    const senderColor = this.getColor(sender);
    let boardChanged = false;
    let drawn: DrawResult[] = [];
    let graveOwners: Color[] = [];

    let res;
    try {
      res = this.match.castSpell(senderColor, spellId, targets, (def, t) => {
        const out = this.applySpellEffects(def, t, senderColor, choice);
        boardChanged = out.changed;
        drawn = out.drawn;
        graveOwners = out.graveOwners;
        return out.applied;
      });
    } catch (error) {
      if (error instanceof CastError || error instanceof EffectError) return this.sendError(sender, error.error);
      throw error;
    }

    if (boardChanged) this.recordPosition();
    const autoResults = this.match.autoAdvance();
    const expired = this.tickEffectsOnNewTurn(autoResults);
    // Se il cast chiude il turno si valuta il nuovo giocatore attivo; se chi lancia ha ancora il tratto (main1) e la
    // scacchiera è cambiata, si valuta lui: un Patto di sangue può lasciarlo senza mosse.
    let end = this.checkRolloverGameEnd(autoResults);
    if (end === null && boardChanged && sideToMove(this.board.fen) === this.match.activePlayer) end = this.checkActivePlayerEnd();

    this.broadcast('spell_cast', {
      player: senderColor,
      spell_id: res.spell.id,
      targets: res.targets,
      effects_applied: res.effectsApplied,
    });
    this.broadcastMana({ player: senderColor, current: res.manaAfter, max: res.manaMax });
    this.broadcast('hand_size_changed', { player: senderColor, size: res.handSize });
    for (const d of drawn) this.clientOf(senderColor).send(msg('card_drawn', { card_id: d.cardId, deck_size: d.deckSize }));
    if (boardChanged) this.broadcastState();
    this.broadcastGraveyards(graveOwners);
    for (const ar of autoResults) this.applyAdvanceBroadcasts(ar);
    this.broadcastExpired(expired);
    if (end !== null && !boardChanged) this.broadcastState();
    this.announceEnd(end);
  }

  /**
   * `applySpellEffects` (`room.go`): valida i bersagli, applica gli effetti su una copia di FEN, Tracker e cimiteri,
   * controlla la posizione finale e solo allora sostituisce lo stato; pesca e mana per ultimi. Lancia `EffectError`
   * per annullare il cast senza costi.
   */
  private applySpellEffects(def: Spell, targets: string[], caster: Color, choice: string) {
    validateTargets(this.board.fen, this.tracker, def.targets, targets, caster);

    let fen = this.board.fen;
    const tracker = this.tracker.clone();
    const graves: Record<Color, GraveEntry[]> = { white: [...this.match.white.graveyard], black: [...this.match.black.graveyard] };
    const gravesChanged = new Set<Color>();
    let changed = false;
    const applied: Record<string, unknown>[] = [];
    const deferred: (() => void)[] = [];
    const drawn: DrawResult[] = [];
    const target = (): string => {
      const square = targets[0];
      if (square === undefined) throw new EffectError(WS.needsTarget(def.name));
      return square;
    };
    const noEffect = (reason: string) => new EffectError(WS.noEffect(def.name, reason));
    const invalidChoice = (reason: string) => new EffectError(WS.invalidChoice(def.name, choice, reason));
    // Il pezzo nella casa va nel cimitero del proprietario, prima di sparire da FEN e Tracker.
    const bury = (square: string) => {
      const info = tracker.info(square);
      const piece = info?.piece ?? pieceAt(fen, square);
      if (piece === null) return;
      const owner = pieceColor(piece);
      graves[owner].push({ piece: pieceName(piece), piece_id: info?.id ?? 0 });
      gravesChanged.add(owner);
    };

    for (const eff of def.effects) {
      const entry: Record<string, unknown> = { kind: eff.kind };
      switch (eff.kind) {
        case 'destroy_piece': {
          const square = target();
          bury(square);
          const result = destroyPiece(fen, square);
          fen = result.fen;
          changed = true;
          tracker.removeAt(square);
          entry['target'] = square;
          entry['piece_destroyed'] = result.destroyed;
          break;
        }
        case 'freeze_piece':
        case 'shield_piece': {
          const square = target();
          const duration = paramInt(eff.params, 'duration', 1);
          if (eff.kind === 'freeze_piece') tracker.freeze(square, caster, duration, def.id);
          else tracker.shield(square, caster, duration, def.id);
          entry['target'] = square;
          entry['remaining_turns'] = duration;
          break;
        }
        case 'freeze_all': {
          const side = eff.params?.['side'] === 'own' ? caster : opponentOf(caster);
          const squares = piecesOf(fen, side, paramStrings(eff.params, 'pieces'));
          if (squares.length === 0) throw noEffect('no_pieces');
          const duration = paramInt(eff.params, 'duration', 1);
          for (const square of squares) tracker.freeze(square, caster, duration, def.id);
          entry['targets'] = squares;
          entry['remaining_turns'] = duration;
          break;
        }
        case 'shield_area': {
          let squares: string[];
          if (eff.params?.['around'] === 'own_king') squares = aroundKing(fen, caster, paramInt(eff.params, 'radius', 1));
          else if (eff.params?.['filter'] === 'own_pawns_side_by_side') squares = pawnsSideBySide(fen, caster);
          else throw new EffectError(WS.unknownAreaFilter(def.id));
          if (squares.length === 0) throw noEffect('no_pieces');
          const duration = paramInt(eff.params, 'duration', 1);
          for (const square of squares) tracker.shield(square, caster, duration, def.id);
          entry['targets'] = squares;
          entry['remaining_turns'] = duration;
          break;
        }
        case 'draw_card': {
          const amount = paramInt(eff.params, 'amount', 1);
          deferred.push(() => {
            let count = 0;
            for (let i = 0; i < amount; i++) {
              const d = this.match.drawFor(caster);
              if (d.cardId !== '') {
                drawn.push(d);
                count++;
              }
            }
            entry['count'] = count;
          });
          break;
        }
        case 'gain_mana': {
          const amount = paramInt(eff.params, 'amount', 1);
          const exceedCap = paramBool(eff.params, 'can_exceed_cap');
          deferred.push(() => {
            entry['amount'] = amount;
            entry['mana'] = this.match.gainMana(caster, amount, exceedCap).current;
          });
          break;
        }
        case 'move_piece': {
          const [from, to] = moveEndpoints(fen, eff.params, targets, caster);
          fen = movePieceFen(fen, from, to, caster);
          changed = true;
          tracker.relocate(from, to); // spostamento magico: niente arrocco né en passant
          entry['from'] = from;
          entry['to'] = to;
          break;
        }
        case 'swap_pieces': {
          const [a, b] = targets;
          if (a === undefined || b === undefined) throw new EffectError(WS.swapNeedsTwoTargets(def.name, targets.length));
          fen = swapPieces(fen, a, b);
          changed = true;
          tracker.swap(a, b);
          entry['targets'] = [a, b];
          break;
        }
        case 'transform_piece': {
          const square = target();
          const piece = pieceAt(fen, square);
          const to = piece === null ? undefined : paramStringMap(eff.params, 'map')[pieceName(piece)];
          const letter = piece === null || to === undefined ? null : pieceLetter(to, pieceColor(piece));
          if (letter === null || to === undefined) throw new EffectError(WS.cannotTransform(square));
          fen = setPiece(fen, square, letter);
          changed = true;
          tracker.setType(square, letter);
          entry['target'] = square;
          entry['piece'] = to;
          break;
        }
        case 'promote_piece': {
          const square = target();
          if (choice === '') throw invalidChoice('missing');
          if (!paramStrings(eff.params, 'choices').includes(choice)) throw invalidChoice('not_allowed');
          const piece = pieceAt(fen, square);
          const letter = piece === null ? null : pieceLetter(choice, pieceColor(piece));
          if (letter === null) throw invalidChoice('not_allowed');
          fen = setPiece(fen, square, letter);
          changed = true;
          tracker.setType(square, letter);
          entry['target'] = square;
          entry['piece'] = choice;
          break;
        }
        case 'revive_piece': {
          const square = target();
          const available = paramStrings(eff.params, 'pieces').filter((kind) => graves[caster].some((g) => g.piece === kind));
          if (available.length === 0) throw noEffect('empty_graveyard');
          let kind = choice;
          if (kind === '') {
            if (available.length > 1) throw invalidChoice('missing');
            kind = available[0] as string;
          }
          if (!available.includes(kind)) throw invalidChoice('not_allowed');
          const letter = pieceLetter(kind, caster) as string;
          fen = placePiece(fen, square, letter);
          changed = true;
          tracker.add(square, letter);
          const index = graves[caster].findIndex((g) => g.piece === kind);
          graves[caster].splice(index, 1);
          gravesChanged.add(caster);
          entry['target'] = square;
          entry['piece'] = kind;
          break;
        }
        case 'restore_castling_rights': {
          const next = restoreCastling(fen, caster);
          if (next === null) throw noEffect('no_castling');
          fen = next;
          changed = true;
          break;
        }
        case 'summon_pawn': {
          const square = target();
          const pawn = caster === 'white' ? 'P' : 'p';
          const limit = paramInt(eff.params, 'max_pawns', 0);
          if (limit > 0 && countPieces(fen, pawn) >= limit) throw new EffectError(WS.maxPawns(limit, square));
          fen = placePiece(fen, square, pawn);
          changed = true;
          tracker.add(square, pawn);
          entry['target'] = square;
          entry['piece'] = 'pawn';
          break;
        }
        default:
          throw new EffectError(WS.unsupportedEffect(eff.kind));
      }
      applied.push(entry);
    }

    if (changed) {
      fen = clearStaleEnPassant(fen);
      validateNoCheck(this.board.fen, fen, caster);
      this.board.fen = fen; // una magia non cambia il lato al tratto
    }
    this.tracker = tracker;
    const graveOwners: Color[] = [];
    for (const color of ['white', 'black'] as const) {
      if (!gravesChanged.has(color)) continue;
      this.match.player(color).graveyard = graves[color];
      graveOwners.push(color);
    }
    for (const apply of deferred) apply();
    return { applied, changed, drawn, graveOwners };
  }

  /** `buryCaptured` (`room.go`): il pezzo catturato da una mossa va nel cimitero del proprietario. */
  private buryCaptured(square: string): Color | null {
    const info = this.tracker.info(square);
    const piece = info?.piece ?? pieceAt(this.board.fen, square);
    if (piece === null) return null;
    const owner = pieceColor(piece);
    this.match.player(owner).graveyard.push({ piece: pieceName(piece), piece_id: info?.id ?? 0 });
    return owner;
  }

  /** `graveyard_changed` a entrambi, per ogni cimitero cambiato. */
  private broadcastGraveyards(owners: readonly Color[]): void {
    for (const player of owners) {
      this.broadcast('graveyard_changed', { player, graveyard: this.match.player(player).graveyard.map((g) => g.piece) });
    }
  }

  /** `tickEffectsOnNewTurn` (`room.go`): durate alla fine del turno di chi ha appena chiuso. */
  private tickEffectsOnNewTurn(results: AdvanceResult[]): ExpiredEffect[] {
    const rollover = results.find((r) => r.newTurn);
    if (rollover === undefined) return [];
    return this.tracker.tickTurnEnd(opponentOf(rollover.activePlayer));
  }

  /** `gameStatus` + `isPlayable` (`room.go`): le mosse dei pezzi congelati non sono giocabili. */
  private gameStatus() {
    return getGameStatus(this.board.fen, (move) => move.length < 4 || !this.tracker.isFrozen(move.slice(0, 2)));
  }

  /** `checkRolloverGameEnd` (`room.go`). */
  private checkRolloverGameEnd(results: AdvanceResult[]): GameEnd | null {
    return results.some((r) => r.newTurn) ? this.checkActivePlayerEnd() : null;
  }

  /** `checkActivePlayerEnd` (`room.go`): il giocatore attivo è il lato al tratto della FEN. */
  private checkActivePlayerEnd(): GameEnd | null {
    switch (this.gameStatus()) {
      case 'checkmate':
        return this.finish(this.match.activePlayer === 'white' ? '0-1' : '1-0', 'checkmate', 'checkmate');
      case 'stalemate':
        return this.finish('1/2-1/2', 'stalemate', 'stalemate');
      case 'draw':
        return this.finish('1/2-1/2', 'draw', 'draw');
      default:
        return null;
    }
  }

  /** `room.go:1389-1410`. */
  private handleResign(sender: GameClient): void {
    if (this.ended) return this.sendError(sender, WS.gameOver);
    const end = this.finish(this.getColor(sender) === 'white' ? '0-1' : '1-0', 'resign', 'resigned');
    this.broadcastState();
    this.announceEnd(end);
  }

  /** `room.go:1413-1448`: nessun controllo di turno. */
  private handleDrawOffer(sender: GameClient): void {
    if (this.ended) return this.sendError(sender, WS.gameOver);
    if (this.drawOfferer !== null) return this.sendError(sender, WS.drawOfferPending);
    this.drawOfferer = sender;
    this.getOpponent(sender).send(msg('draw_offer', { from: sender.username }));
    sender.send(msg('draw_offer_sent', { message: INFO.drawOfferSent }));
  }

  /** `room.go:1451-1501`. */
  private handleDrawResponse(sender: GameClient, accepted: boolean): void {
    if (this.ended) return this.sendError(sender, WS.gameOver);
    if (this.drawOfferer === null) return this.sendError(sender, WS.noDrawOffer);
    if (this.drawOfferer.userId === sender.userId) return this.sendError(sender, WS.ownDrawOffer);
    this.drawOfferer = null;
    // Chi ha offerto è l'avversario di chi risponde: la connessione attuale, che può essere cambiata.
    const offerer = this.getOpponent(sender);
    if (accepted) {
      const end = this.finish('1/2-1/2', 'agreement', 'draw');
      this.broadcastState();
      this.announceEnd(end);
      return;
    }
    offerer.send(msg('draw_declined', { message: INFO.drawDeclined(sender.username), reason: 'declined' }));
  }

  // --- Connessioni ----------------------------------------------------------------------------------

  /** `room.go:1031-1091`. */
  leave(client: GameClient): void {
    if (this.ended || this.board.status !== 'active') return;
    // Una connessione già sostituita (secondo tab, cambio di rete) non conta come disconnessione.
    if (client !== this.white && client !== this.black) return;

    this.getOpponent(client).send(msg('opponent_disconnected', { message: INFO.opponentDisconnected }));
    const userId = client.userId;
    const old = this.disconnectedTimers.get(userId);
    if (old !== undefined) clearTimeout(old);
    const timer = setTimeout(() => {
      if (this.disconnectedTimers.get(userId) !== timer) return;
      this.disconnectedTimers.delete(userId);
      const end = this.finish(this.getColor(client) === 'white' ? '0-1' : '1-0', 'abandonment', 'abandoned');
      if (end !== null) this.broadcastState();
      this.announceEnd(end);
    }, this.options.reconnectTimeoutMs);
    this.disconnectedTimers.set(userId, timer);
  }

  /** `room.go:1094-1149`. */
  reconnect(client: GameClient): void {
    const timer = this.disconnectedTimers.get(client.userId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.disconnectedTimers.delete(client.userId);
    }
    let replaced: GameClient | null = null;
    if (this.white.userId === client.userId) {
      replaced = this.white;
      this.white = client;
    } else if (this.black.userId === client.userId) {
      replaced = this.black;
      this.black = client;
    }
    // La connessione precedente ancora aperta (secondo tab) non deve poter continuare a giocare.
    if (replaced !== null && replaced !== client && replaced.close !== undefined) {
      this.sendError(replaced, WS.replacedInGame);
      replaced.close(CLOSE_REPLACED, 'replaced_by_new_connection');
    }
    this.ensureTimer();

    client.send(msg('game_state', { ...this.publicState(), reconnected: true }));
    this.sendHand(this.getColor(client));
    this.getOpponent(client).send(msg('opponent_reconnected', { message: INFO.opponentReconnected(client.username) }));
  }

  /**
   * Simula il riavvio del server (`manager.go:134-190`): orologio fermo, client sostituiti da segnaposto
   * che scartano i messaggi. Al primo `reconnect` l'orologio riparte.
   */
  suspendForRestart(): void {
    this.stopTimers();
    this.timerStarted = false;
    const placeholder = (c: GameClient): GameClient => ({ userId: c.userId, username: c.username, send: () => undefined });
    this.white = placeholder(this.white);
    this.black = placeholder(this.black);
  }

  // --- Orologio e fine partita ----------------------------------------------------------------------

  /** `room.go:129-139`. */
  private ensureTimer(): void {
    if (this.timerStarted || this.ended || this.disposed) return;
    this.timerStarted = true;
    let last = Date.now();
    this.timers = [
      setInterval(() => {
        const now = Date.now();
        this.tick(now - last);
        last = now;
      }, this.options.tickMs ?? 100),
      setInterval(() => this.broadcastTimers(), this.options.broadcastMs ?? 1000),
    ];
  }

  private stopTimers(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  /** `room.go:1279-1327`: scala il tempo realmente trascorso sul giocatore attivo della FSM. */
  private tick(elapsedMs: number): void {
    if (this.ended) return;
    let end: GameEnd | null = null;
    if (this.match.activePlayer === 'white') {
      this.whiteTime -= elapsedMs;
      if (this.whiteTime <= 0) {
        this.whiteTime = 0;
        end = this.finish('0-1', 'timeout', 'timeout');
      }
    } else {
      this.blackTime -= elapsedMs;
      if (this.blackTime <= 0) {
        this.blackTime = 0;
        end = this.finish('1-0', 'timeout', 'timeout');
      }
    }
    if (end === null) return;
    this.broadcastTimers();
    this.broadcastState();
    this.announceEnd(end);
  }

  /**
   * `finishLocked` (`room.go:1209-1237`): chiude la partita una volta sola (status terminale, timer e offerta).
   * Restituisce `null` se era già chiusa, così `game_over`, salvataggio ed ELO non si ripetono.
   */
  private finish(result: GameResult, reason: string, status: string): GameEnd | null {
    if (this.ended) return null;
    this.ended = true;
    this.board.status = status;
    this.drawOfferer = null;
    this.stopTimers();
    for (const timer of this.disconnectedTimers.values()) clearTimeout(timer);
    this.disconnectedTimers.clear();
    const winner = result === '1-0' ? this.white.username : result === '0-1' ? this.black.username : null;
    return { result, reason, winner };
  }

  /** `announceEnd` (`room.go:1241-1271`): `game_over` e salvataggio. Con `null` non fa nulla. */
  private announceEnd(end: GameEnd | null): void {
    if (end === null) return;
    setImmediate(() => this.options.onEnded?.(this, end.result, end.reason));
    const payload: Record<string, unknown> = { result: end.result, reason: end.reason };
    if (end.winner !== null) payload['winner'] = end.winner;
    this.broadcast('game_over', payload);
  }

  /** `room.go:1176-1188`: mosse UCI numerate, `--` per una mossa assorbita. */
  pgn(): string {
    return this.board.moves
      .map((m) => (m === NULL_MOVE ? '--' : m))
      .map((m, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${m}` : m))
      .join(' ')
      .trim();
  }

  /** `room.go:1190-1194`: `"minuti+secondi"`, es. `"10+5"`. */
  timeControl(): string {
    return `${String(this.options.baseTimeMs / 60_000)}+${String(this.options.incrementMs / 1000)}`;
  }

  /** `room.go:161-165`. */
  isActive(): boolean {
    return !this.ended && this.board.status === 'active';
  }

  // --- Serializzazione ------------------------------------------------------------------------------

  /** `room.go:1360-1386`. */
  publicState(): Record<string, unknown> {
    const { white, black } = this.match;
    return {
      board: { fen: this.board.fen, moves: [...this.board.moves], turn: this.board.turn, status: this.board.status },
      white_player: { id: this.white.userId, username: this.white.username },
      black_player: { id: this.black.userId, username: this.black.username },
      time_control: { base_ms: this.options.baseTimeMs, increment_ms: this.options.incrementMs },
      white_time: Math.round(this.whiteTime),
      black_time: Math.round(this.blackTime),
      phase: this.match.currentPhase,
      active_player: this.match.activePlayer,
      turn_number: this.match.turnNumber,
      white_mana: white.mana,
      white_max_mana: white.max_mana,
      black_mana: black.mana,
      black_max_mana: black.max_mana,
      white_hand_size: white.hand.length,
      black_hand_size: black.hand.length,
      white_deck_size: white.deck.length,
      black_deck_size: black.deck.length,
      active_effects: this.tracker.activeEffects(),
      white_graveyard: white.graveyard.map((g) => g.piece),
      black_graveyard: black.graveyard.map((g) => g.piece),
    };
  }

  private broadcastState(): void {
    this.broadcast('game_state', this.publicState());
  }

  /** `room.go:1004-1019`. */
  private sendHand(color: Color): void {
    const ps = this.match.player(color);
    this.clientOf(color).send(msg('hand', { hand: [...ps.hand], mana: ps.mana, max_mana: ps.max_mana, deck_size: ps.deck.length }));
  }

  /** `room.go:951-966`. */
  private applyAdvanceBroadcasts(res: AdvanceResult): void {
    this.broadcast('phase_changed', { phase: res.phase, active_player: res.activePlayer, turn_number: res.turnNumber });
    if (!res.newTurn) return;
    if (res.mana !== null) this.broadcastMana(res.mana);
    if (res.draw !== null) this.broadcastDraw(res.draw);
  }

  private broadcastMana(m: ManaState): void {
    this.broadcast('mana_changed', { player: m.player, current: m.current, max: m.max });
  }

  /** `room.go:979-992`. */
  private broadcastDraw(d: DrawResult): void {
    if (d.cardId !== '') this.clientOf(d.player).send(msg('card_drawn', { card_id: d.cardId, deck_size: d.deckSize }));
    this.broadcast('hand_size_changed', { player: d.player, size: d.handSize });
  }

  /** `room.go:902-916`. */
  private broadcastExpired(expired: ExpiredEffect[]): void {
    for (const e of expired) {
      this.broadcast('effect_expired', { square: e.square, effect_kind: e.kind, piece_id: e.pieceId });
    }
  }

  /** `room.go:1331-1340`: `turn` è il giocatore attivo. */
  private broadcastTimers(): void {
    this.broadcast('timer_update', {
      white_time: Math.round(this.whiteTime),
      black_time: Math.round(this.blackTime),
      turn: this.match.activePlayer,
    });
  }

  private broadcast(type: WireServerType, payload: Record<string, unknown>): void {
    const message = msg(type, payload);
    this.white.send(message);
    this.black.send(message);
  }

  /** `sendErr` (`client.go:126-137`): `{message, code, details?}`. */
  private sendError(client: GameClient, error: GameError): void {
    const payload: Record<string, unknown> = { message: error.message, code: error.code };
    if (error.details !== undefined && Object.keys(error.details).length > 0) payload['details'] = { ...error.details };
    client.send(msg('error', payload));
  }

  private recordPosition(): void {
    const key = this.board.fen.split(' ').slice(0, 4).join(' ');
    this.posCounts.set(key, (this.posCounts.get(key) ?? 0) + 1);
  }

  private isThreefold(): boolean {
    return (this.posCounts.get(this.board.fen.split(' ').slice(0, 4).join(' ')) ?? 0) >= 3;
  }

  /** `room.go:1160-1165`: per `UserID`. */
  getColor(client: GameClient): Color {
    return this.white.userId === client.userId ? 'white' : 'black';
  }

  private getOpponent(client: GameClient): GameClient {
    return this.white.userId === client.userId ? this.black : this.white;
  }

  private clientOf(color: Color): GameClient {
    return color === 'white' ? this.white : this.black;
  }

  /** Solo per i test: ferma gli intervalli senza terminare la partita. */
  dispose(): void {
    this.disposed = true;
    this.stopTimers();
    for (const timer of this.disconnectedTimers.values()) clearTimeout(timer);
  }
}

function msg(type: WireServerType, payload: Record<string, unknown>): WireServerMessage {
  return { type, payload };
}
