import { Chess, DEFAULT_POSITION } from 'chess.js';

import type { Rng } from '../util';
import {
  errorMessage,
  type ErrorCode,
  type WireClientMessage,
  type WireColor,
  type WireGameStart,
  type WirePhase,
  type WireServerMessage,
} from '../wire';
import { findSpell } from './catalog';
import { buildDeck, type Card } from './deck';
import { PieceRegistry } from './pieces';
import { blockedOutcome, chessOutcome, other, resolveCast, validateMove, type Board, type Outcome } from './rules';

export interface PlayerConnection {
  send(message: WireServerMessage): void;
  /** Frame testuale arbitrario: usato solo dallo scenario ostile. */
  sendRaw(text: string): void;
  close(): void;
}

export interface SeatInit {
  userId: number;
  username: string;
}

/** `full` = contratto + estensioni assunte; `minimal` = solo il contratto documentato (scenario contract-minimal). */
export type ProtocolVariant = 'full' | 'minimal';

export interface RoomOptions {
  roomId: string;
  white: SeatInit;
  black: SeatInit;
  rng: Rng;
  clockMs: number;
  reconnectTimeoutMs: number;
  variant?: ProtocolVariant;
  /** Solo test/scenari: posizione iniziale diversa da quella standard. */
  fen?: string;
  /** Solo test/scenari: ordine delle prime carte del mazzo. */
  deckTop?: Partial<Record<WireColor, string[]>>;
  /** Solo scenari: mana massimo minimo garantito (es. 10 per lo scenario `spells`). */
  startingMaxMana?: number;
  tickMs?: number;
  now?: () => number;
  onGameOver?: (summary: GameOverSummary) => void;
}

export interface GameOverSummary {
  roomId: string;
  white: SeatInit;
  black: SeatInit;
  result: '1-0' | '0-1' | '1/2-1/2';
  reason: string;
}

interface Seat extends SeatInit {
  conn: PlayerConnection | null;
  deck: Card[];
  hand: Card[];
  mana: { current: number; max: number };
  turnsTaken: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
}

const INITIAL_HAND = 4;
const MANA_CAP = 10;

type EndReason = Outcome['reason'] | 'agreement' | 'resign' | 'timeout' | 'abandonment' | 'server_shutdown';

export class Room {
  readonly roomId: string;
  private readonly seats: Record<WireColor, Seat>;
  private board: Board;
  private readonly moves: string[] = [];
  private phase: WirePhase = 'draw';
  private active: WireColor = 'white';
  private turnNumber = 0;
  private readonly clocks: Record<WireColor, number>;
  private clockStartedAt = 0;
  private pendingDrawFrom: WireColor | null = null;
  private over = false;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => number;
  private readonly variant: ProtocolVariant;

  constructor(private readonly options: RoomOptions) {
    this.roomId = options.roomId;
    this.now = options.now ?? Date.now;
    this.variant = options.variant ?? 'full';
    const chess = new Chess(options.fen ?? DEFAULT_POSITION);
    this.board = { chess, pieces: PieceRegistry.fromChess(chess, options.rng) };
    this.clocks = { white: options.clockMs, black: options.clockMs };
    const seat = (init: SeatInit, color: WireColor): Seat => ({
      ...init,
      conn: null,
      deck: buildDeck(options.rng, options.deckTop?.[color]),
      hand: [],
      mana: { current: 0, max: 0 },
      turnsTaken: 0,
      reconnectTimer: null,
    });
    this.seats = { white: seat(options.white, 'white'), black: seat(options.black, 'black') };
    this.active = chess.turn() === 'w' ? 'white' : 'black';
  }

  // --- Lettura (bot e test) ------------------------------------------------------------------------

  get isOver(): boolean {
    return this.over;
  }
  get currentPhase(): WirePhase {
    return this.phase;
  }
  get activeColor(): WireColor {
    return this.active;
  }
  get currentBoard(): Board {
    return this.board;
  }
  handOf(color: WireColor): readonly Card[] {
    return this.seats[color].hand;
  }
  manaOf(color: WireColor): { current: number; max: number } {
    return { ...this.seats[color].mana };
  }
  usernameOf(color: WireColor): string {
    return this.seats[color].username;
  }
  colorOfUser(userId: number): WireColor | null {
    if (this.seats.white.userId === userId) return 'white';
    if (this.seats.black.userId === userId) return 'black';
    return null;
  }

  // --- Ciclo di vita -------------------------------------------------------------------------------

  attach(color: WireColor, conn: PlayerConnection): void {
    this.seats[color].conn = conn;
  }

  start(): void {
    for (const color of ['white', 'black'] as const) this.draw(this.seats[color], INITIAL_HAND);
    this.clockStartedAt = this.now();
    this.beginTurn(this.active, { silent: true });
    for (const color of ['white', 'black'] as const) this.sendInitialState(color);
    this.ticker = setInterval(() => this.tick(), this.options.tickMs ?? 1000);
  }

  disconnect(color: WireColor, conn: PlayerConnection): void {
    const seat = this.seats[color];
    if (this.over || seat.conn !== conn) return;
    seat.conn = null;
    this.emit(other(color), { type: 'opponent_disconnected', payload: { message: "L'avversario si è disconnesso" } });
    seat.reconnectTimer = setTimeout(
      () => this.finish({ reason: 'abandonment', winner: other(color) }),
      this.options.reconnectTimeoutMs,
    );
  }

  /** G5: al rientro entro la finestra il giocatore riceve di nuovo lo stato completo. */
  reconnect(color: WireColor, conn: PlayerConnection): void {
    const seat = this.seats[color];
    if (seat.reconnectTimer !== null) clearTimeout(seat.reconnectTimer);
    seat.reconnectTimer = null;
    if (seat.conn !== null && seat.conn !== conn) seat.conn.close();
    seat.conn = conn;
    this.emit(color, { type: 'game_start', payload: this.gameStartPayload(color) });
    // Contratto minimale: nessuno snapshot del layer magie, solo la scacchiera.
    if (this.variant === 'minimal') this.emit(color, this.gameStateMessage());
  }

  shutdown(): void {
    if (!this.over) this.finish({ reason: 'server_shutdown', winner: null });
  }

  // --- Messaggi dal client -------------------------------------------------------------------------

  handle(color: WireColor, message: WireClientMessage): void {
    if (this.over) return this.reject(color, 'no_active_game');
    switch (message.type) {
      case 'resign':
        return this.finish({ reason: 'resign', winner: other(color) }); // M9: ammesso sempre
      case 'draw_offer':
        return this.onDrawOffer(color);
      case 'draw_accepted':
        return this.onDrawAnswer(color, true);
      case 'draw_declined':
        return this.onDrawAnswer(color, false);
      case 'pass_phase':
        return this.onPassPhase(color);
      case 'move':
        return this.onMove(color, message.payload['move']);
      case 'cast_spell':
        return this.onCast(color, message.payload);
    }
  }

  private onDrawOffer(color: WireColor): void {
    if (color !== this.active) return this.reject(color, 'not_your_turn');
    if (this.phase === 'end_turn') return this.reject(color, 'wrong_phase');
    this.pendingDrawFrom = color;
    this.emit(other(color), { type: 'draw_offer', payload: { from: this.seats[color].username } });
  }

  private onDrawAnswer(color: WireColor, accepted: boolean): void {
    if (this.pendingDrawFrom !== other(color)) return this.reject(color, 'no_draw_offer');
    this.pendingDrawFrom = null;
    if (accepted) this.finish({ reason: 'agreement', winner: null });
    // A17: il rifiuto non viene notificato a chi ha offerto.
  }

  private onPassPhase(color: WireColor): void {
    if (color !== this.active) return this.reject(color, 'not_your_turn');
    switch (this.phase) {
      case 'draw':
        return this.setPhase('main1');
      case 'main1': {
        this.setPhase('move');
        const blocked = blockedOutcome(this.board, color); // M7
        if (blocked !== null) this.finish(blocked);
        return;
      }
      case 'main2':
        return this.endTurn();
      case 'move': // la mossa è obbligatoria (§3.4)
      case 'end_turn':
        return this.reject(color, 'wrong_phase');
    }
  }

  private onMove(color: WireColor, uci: unknown): void {
    if (color !== this.active) return this.reject(color, 'not_your_turn');
    if (this.phase !== 'move') return this.reject(color, 'wrong_phase');
    const verdict = validateMove(this.board, color, uci);
    if (!verdict.ok) return this.reject(color, verdict.code);

    const { from, to, promotion } = verdict.move;
    const move = this.board.chess.move(promotion === undefined ? { from, to } : { from, to, promotion });
    this.board.pieces.applyMove(move);
    this.moves.push(`${move.from}${move.to}${move.promotion ?? ''}`);
    this.broadcast(this.gameStateMessage());

    const outcome = chessOutcome(this.board.chess);
    if (outcome !== null) return this.finish(outcome);
    this.setPhase('main2'); // dopo la mossa il server avanza da solo
  }

  private onCast(color: WireColor, payload: Record<string, unknown>): void {
    if (color !== this.active) return this.reject(color, 'not_your_turn');
    const spellId = payload['spell_id'];
    if (typeof spellId !== 'string') return this.reject(color, 'malformed_message');
    const spell = findSpell(spellId);
    if (spell === undefined) return this.reject(color, 'unknown_spell');
    if (!spell.phases.includes(this.phase)) return this.reject(color, 'wrong_phase');

    const seat = this.seats[color];
    const cardId = payload['card_id'];
    const card =
      typeof cardId === 'string'
        ? seat.hand.find((c) => c.id === cardId && c.spellId === spellId)
        : seat.hand.find((c) => c.spellId === spellId);
    if (card === undefined) return this.reject(color, 'card_not_in_hand');
    if (seat.mana.current < spell.mana_cost) return this.reject(color, 'insufficient_mana');

    const resolution = resolveCast(this.board, color, spell, payload['targets']);
    if (!resolution.ok) return this.reject(color, resolution.code);

    // Commit: da qui in poi niente può più fallire.
    seat.hand = seat.hand.filter((c) => c !== card);
    this.board = resolution.board;
    seat.mana.current = Math.min(MANA_CAP, seat.mana.current - spell.mana_cost + resolution.manaGain); // M6

    // M10: ordine dei messaggi.
    const targets = Array.isArray(payload['targets']) ? payload['targets'].map(String) : [];
    this.broadcast({
      type: 'spell_cast',
      payload: { player: seat.username, spell_id: spell.id, targets, effects_applied: resolution.applied },
    });
    this.broadcastMana(color);
    for (const status of resolution.statuses) {
      this.broadcast({
        type: 'effect_applied',
        payload: { piece_id: status.pieceId, effect_kind: status.kind, remaining_turns: status.turns },
      });
    }
    const drawn = this.draw(seat, resolution.draws);
    for (const c of drawn) this.emit(color, { type: 'card_drawn', payload: { card_id: c.id, spell_id: c.spellId } });
    this.broadcastHandSize(color);
    if (resolution.boardChanged) this.broadcast(this.gameStateMessage());
  }

  // --- Turni e fasi --------------------------------------------------------------------------------

  private beginTurn(color: WireColor, { silent }: { silent: boolean }): void {
    this.active = color;
    this.turnNumber += 1; // A13
    this.pendingDrawFrom = null; // A17
    const seat = this.seats[color];
    seat.turnsTaken += 1;
    const grown = Math.min(MANA_CAP, 1 + Math.floor((seat.turnsTaken - 1) / 2)); // M6
    const max = Math.max(grown, Math.min(MANA_CAP, this.options.startingMaxMana ?? 0));
    seat.mana = { current: max, max };
    this.phase = 'draw';
    const drawn = this.draw(seat, 1);
    if (silent) return;

    this.broadcastPhase();
    this.broadcastMana(color);
    for (const c of drawn) this.emit(color, { type: 'card_drawn', payload: { card_id: c.id, spell_id: c.spellId } });
    this.broadcastHandSize(color);
  }

  private setPhase(phase: WirePhase): void {
    this.phase = phase;
    this.broadcastPhase();
  }

  private endTurn(): void {
    this.setPhase('end_turn');
    const hadEffects = this.board.pieces.toWire().some((p) => p.effects.length > 0);
    for (const expired of this.board.pieces.tickStatuses(this.active)) {
      this.broadcast({ type: 'effect_expired', payload: { piece_id: expired.pieceId, effect_kind: expired.kind } });
    }
    if (hadEffects) this.broadcast(this.gameStateMessage());
    this.settleClock();
    this.beginTurn(other(this.active), { silent: false });
  }

  private draw(seat: Seat, count: number): Card[] {
    const drawn = seat.deck.splice(0, count); // mazzo finito: semplicemente non si pesca
    seat.hand.push(...drawn);
    return drawn;
  }

  // --- Orologio ------------------------------------------------------------------------------------

  /** M8: corre l'orologio del giocatore attivo per tutto il turno. */
  private settleClock(): void {
    const t = this.now();
    this.clocks[this.active] = Math.max(0, this.clocks[this.active] - (t - this.clockStartedAt));
    this.clockStartedAt = t;
  }

  private tick(): void {
    if (this.over) return;
    this.settleClock();
    if (this.clocks[this.active] <= 0) {
      this.finish({ reason: 'timeout', winner: other(this.active) });
      return;
    }
    this.broadcast({
      type: 'timer_update',
      payload: { white_time: this.clocks.white, black_time: this.clocks.black, turn: this.active },
    });
  }

  // --- Fine partita --------------------------------------------------------------------------------

  private finish(outcome: { reason: EndReason; winner: WireColor | null }): void {
    if (this.over) return;
    this.settleClock();
    this.over = true;
    if (this.ticker !== null) clearInterval(this.ticker);
    for (const seat of Object.values(this.seats)) if (seat.reconnectTimer !== null) clearTimeout(seat.reconnectTimer);

    const result = outcome.winner === 'white' ? '1-0' : outcome.winner === 'black' ? '0-1' : '1/2-1/2';
    this.broadcast({
      type: 'game_over',
      payload: {
        result,
        reason: outcome.reason,
        winner: outcome.winner === null ? null : this.seats[outcome.winner].username,
      },
    });
    this.options.onGameOver?.({
      roomId: this.roomId,
      white: { userId: this.seats.white.userId, username: this.seats.white.username },
      black: { userId: this.seats.black.userId, username: this.seats.black.username },
      result,
      reason: outcome.reason,
    });
  }

  // --- Serializzazione -----------------------------------------------------------------------------

  private gameStartPayload(color: WireColor): WireGameStart {
    const { white, black } = this.seats;
    const core: WireGameStart = { room_id: this.roomId, white: white.username, black: black.username, fen: this.board.chess.fen() };
    if (this.variant === 'minimal') return core;
    this.settleClock();
    return {
      ...core,
      moves: [...this.moves],
      white_time: this.clocks.white,
      black_time: this.clocks.black,
      time_control: { initial_ms: this.options.clockMs, increment_ms: 0 },
      pieces: this.board.pieces.toWire(),
      phase: this.phase,
      active_player: this.seats[this.active].username,
      turn_number: this.turnNumber,
      hand: this.seats[color].hand.map((c) => ({ card_id: c.id, spell_id: c.spellId })),
      hand_sizes: { [white.username]: white.hand.length, [black.username]: black.hand.length },
      deck_sizes: { [white.username]: white.deck.length, [black.username]: black.deck.length },
      mana: { [white.username]: { ...white.mana }, [black.username]: { ...black.mana } },
    };
  }

  private gameStateMessage(): WireServerMessage {
    this.settleClock();
    return {
      type: 'game_state',
      payload: {
        board: {
          fen: this.board.chess.fen(),
          moves: [...this.moves],
          turn: this.board.chess.turn() === 'w' ? 'white' : 'black',
          status: this.over ? 'finished' : 'active',
        },
        white_time: this.clocks.white,
        black_time: this.clocks.black,
        pieces: this.board.pieces.toWire(),
      },
    };
  }

  /** In `minimal` il contratto non ha stato magie in game_start (G4): lo si ricostruisce con gli eventi base. */
  private sendInitialState(color: WireColor): void {
    this.emit(color, { type: 'game_start', payload: this.gameStartPayload(color) });
    if (this.variant === 'full') return;
    this.emit(color, this.gameStateMessage());
    this.emit(color, this.phaseMessage());
    for (const c of ['white', 'black'] as const) {
      const seat = this.seats[c];
      this.emit(color, { type: 'mana_changed', payload: { player: seat.username, current: seat.mana.current, max: seat.mana.max } });
      this.emit(color, { type: 'hand_size_changed', payload: { player: seat.username, size: seat.hand.length } });
    }
    for (const card of this.seats[color].hand) {
      this.emit(color, { type: 'card_drawn', payload: { card_id: card.id, spell_id: card.spellId } });
    }
  }

  private phaseMessage(): WireServerMessage {
    return {
      type: 'phase_changed',
      payload: { phase: this.phase, active_player: this.seats[this.active].username, turn_number: this.turnNumber },
    };
  }

  private broadcastPhase(): void {
    this.broadcast(this.phaseMessage());
  }

  private broadcastMana(color: WireColor): void {
    const seat = this.seats[color];
    this.broadcast({ type: 'mana_changed', payload: { player: seat.username, current: seat.mana.current, max: seat.mana.max } });
  }

  private broadcastHandSize(color: WireColor): void {
    const seat = this.seats[color];
    this.broadcast({
      type: 'hand_size_changed',
      payload: { player: seat.username, size: seat.hand.length, deck_size: seat.deck.length },
    });
  }

  private reject(color: WireColor, code: ErrorCode): void {
    this.emit(color, errorMessage(code));
  }

  private broadcast(message: WireServerMessage): void {
    this.emit('white', message);
    this.emit('black', message);
  }

  private emit(color: WireColor, message: WireServerMessage): void {
    this.seats[color].conn?.send(this.variant === 'minimal' ? toMinimal(message) : message);
  }
}

/** Riduce un messaggio al solo contratto documentato (§3.2–3.3), togliendo le estensioni assunte. */
function toMinimal(message: WireServerMessage): WireServerMessage {
  switch (message.type) {
    case 'game_state': {
      const { pieces: _pieces, ...payload } = message.payload;
      return { type: 'game_state', payload };
    }
    case 'card_drawn': // G2: senza id d'istanza, card_id è lo spell_id
      return { type: 'card_drawn', payload: { card_id: message.payload.spell_id ?? message.payload.card_id } };
    case 'hand_size_changed': {
      const { deck_size: _deckSize, ...payload } = message.payload;
      return { type: 'hand_size_changed', payload };
    }
    case 'error': // G6: payload non strutturato
      return { type: 'error', payload: { message: message.payload.message } };
    default:
      return message;
  }
}
