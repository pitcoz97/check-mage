import type { Contract } from '../config';
import { INFO, WS, type ServerText } from '../serverTexts';
import type { Rng } from '../util';
import type { WireServerMessage, WireServerType } from '../wire';
import { paramInt, type Spell } from './catalog';
import { getGameStatus, isInCheck, isMoveLegal, applyMove as engineApplyMove } from './engine';
import { destroyPiece, EffectError, movePieceFen, passTurn, sideToMove, withSideToMove, type Color } from './fen';
import { CastError, MatchState, type AdvanceResult, type DrawResult, type ManaState, type MatchOverrides } from './match';
import { KIND_SHIELD, Tracker, type ExpiredEffect } from './tracker';

/**
 * Porting di `game/room.go`. I commenti `room.go:N` rimandano alla riga del server.
 * Replica di proposito i bug ancora presenti (BACKEND-REQUESTS B1, B2, B4, B5, B7, B13, B14).
 */

/** Il `*Client` di Go: identità + canale d'uscita non bloccante (`client.go:94-115`). */
export interface GameClient {
  readonly userId: number;
  readonly username: string;
  send(message: WireServerMessage): void;
}

export type GameResult = '1-0' | '0-1' | '1/2-1/2';

export interface RoomOptions {
  id: string;
  white: GameClient;
  black: GameClient;
  rng: Rng;
  contract: Contract;
  baseTimeMs: number;
  incrementMs: number;
  reconnectTimeoutMs: number;
  overrides?: MatchOverrides;
  /** Solo test: posizione iniziale diversa da quella standard (il server parte sempre da `room.go:56`). */
  initialFen?: string;
  /** `room.go:1042-1043`. */
  tickMs?: number;
  broadcastMs?: number;
  /** Equivale alla goroutine di `endGame`: `SaveGame` + `RemoveRoom` (`room.go:997-1019`). */
  onEnded?: (room: Room, result: GameResult, reason: string) => void;
}

interface Board {
  fen: string;
  moves: string[];
  turn: Color;
  status: string;
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

export class Room {
  readonly id: string;
  white: GameClient;
  black: GameClient;
  readonly board: Board;
  readonly match: MatchState;
  readonly tracker: Tracker;
  whiteTime: number;
  blackTime: number;
  private drawOfferer: GameClient | null = null;
  private readonly disconnectedTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly posCounts = new Map<string, number>();
  private timers: ReturnType<typeof setInterval>[] = [];
  private timerStarted = false;
  private timerStopped = false;

  /** `room.go:49-95`. */
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

  /** Seconda metà di `NewRoom` (`room.go:75-89`), separata per poter agganciare i client prima dei broadcast. */
  start(): void {
    this.broadcastState();
    this.sendHand('white');
    this.sendHand('black');
    for (const res of this.match.autoAdvance()) this.applyAdvanceBroadcasts(res);
    this.ensureTimer();
  }

  // --- Messaggi -------------------------------------------------------------------------------------

  /** `room.go:268-310`. Nessun controllo di fine partita (B4). */
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
        return this.handleCastSpell(sender, typeof data['spell_id'] === 'string' ? data['spell_id'] : '', targets);
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

  /** `room.go:312-434`. */
  private handleMove(sender: GameClient, move: string): void {
    const senderColor = this.getColor(sender);
    if (senderColor !== this.board.turn) return this.sendError(sender, WS.notYourTurn);
    if (this.match.currentPhase !== 'move') return this.sendError(sender, WS.cannotMoveInPhase(this.match.currentPhase));
    if (!isMoveLegal(this.board.fen, move)) return this.sendError(sender, WS.illegalMove(move));

    const from = move.slice(0, 2);
    const to = move.slice(2, 4);
    if (this.tracker.isFrozen(from)) return this.sendError(sender, WS.frozen(from));

    const shieldAbsorbed = this.tracker.hasShield(to);
    if (senderColor === 'white') this.whiteTime += this.options.incrementMs;
    else this.blackTime += this.options.incrementMs;

    if (shieldAbsorbed) {
      // Nessun pezzo si muove e la mossa non viene registrata (B7).
      this.tracker.consumeShield(to);
      this.board.fen = passTurn(this.board.fen);
      this.board.turn = sideToMove(this.board.fen);
    } else {
      this.board.moves.push(move);
      this.board.fen = engineApplyMove(this.board.fen, move);
      this.board.turn = sideToMove(this.board.fen);
      this.tracker.movePiece(from, to, move.length >= 5 ? (move[4] as string) : null);
    }
    this.recordPosition();

    let status = getGameStatus(this.board.fen);
    if (status === 'ongoing' && this.isThreefold()) status = 'draw';

    switch (status) {
      case 'checkmate':
        this.board.status = 'checkmate';
        return this.endGame(senderColor === 'white' ? '1-0' : '0-1', 'checkmate');
      case 'stalemate':
        this.board.status = 'stalemate';
        return this.endGame('1/2-1/2', 'stalemate');
      case 'draw':
        this.board.status = 'draw';
        return this.endGame('1/2-1/2', 'draw');
      case 'ongoing': {
        const results = [this.match.advance(), ...this.match.autoAdvance()];
        const expired = this.tickEffectsOnNewTurn(results);
        if (shieldAbsorbed) {
          this.broadcast('effect_expired', { square: to, effect_kind: KIND_SHIELD, reason: 'shield_absorbed' });
        }
        this.broadcastState();
        for (const res of results) this.applyAdvanceBroadcasts(res);
        this.broadcastExpired(expired);
      }
    }
  }

  /** `room.go:437-476`. */
  private handlePassPhase(sender: GameClient): void {
    const senderColor = this.getColor(sender);
    if (!this.match.isActive(senderColor)) return this.sendError(sender, WS.notYourTurn);
    if (!this.match.allows('pass_phase')) return this.sendError(sender, WS.cannotPassInPhase(this.match.currentPhase));

    const results = [this.match.advance(), ...this.match.autoAdvance()];
    const expired = this.tickEffectsOnNewTurn(results);
    const ended = this.checkRolloverGameEnd(results);
    for (const res of results) this.applyAdvanceBroadcasts(res);
    this.broadcastExpired(expired);
    if (ended !== null) this.endGame(ended.result, ended.reason);
  }

  /** `room.go:480-567`. */
  private handleCastSpell(sender: GameClient, spellId: string, targets: string[] | null): void {
    const senderColor = this.getColor(sender);
    let boardChanged = false;
    let drawn: DrawResult[] = [];

    let res;
    try {
      res = this.match.castSpell(senderColor, spellId, targets, (def, t) => {
        const out = this.applySpellEffects(def, t, senderColor);
        boardChanged = out.changed;
        drawn = out.drawn;
        return out.applied;
      });
    } catch (error) {
      if (error instanceof CastError || error instanceof EffectError) return this.sendError(sender, error.text);
      throw error;
    }

    if (boardChanged) this.recordPosition();
    const autoResults = this.match.autoAdvance();
    const expired = this.tickEffectsOnNewTurn(autoResults);
    const ended = this.checkRolloverGameEnd(autoResults);

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
    for (const ar of autoResults) this.applyAdvanceBroadcasts(ar);
    this.broadcastExpired(expired);
    if (ended !== null) this.endGame(ended.result, ended.reason);
  }

  /** `room.go:573-673`. Lancia `EffectError` per annullare il cast senza costi. */
  private applySpellEffects(def: Spell, targets: string[], caster: Color) {
    const applied: Record<string, unknown>[] = [];
    const drawn: DrawResult[] = [];
    let fen = this.board.fen;
    let changed = false;

    for (const eff of def.effects) {
      const target = targets[0];
      switch (eff.kind) {
        case 'noop':
          applied.push({ kind: eff.kind });
          break;
        case 'destroy_piece': {
          if (target === undefined) throw new EffectError(WS.needsTarget(def.name));
          const result = destroyPiece(fen, target, caster);
          fen = result.fen;
          changed = true;
          this.tracker.removeAt(target);
          applied.push({ kind: eff.kind, target, piece_destroyed: result.destroyed });
          break;
        }
        case 'freeze_piece':
        case 'shield_piece': {
          if (target === undefined) throw new EffectError(WS.needsTarget(def.name));
          const turns = paramInt(eff.params, 'turns', 1);
          if (eff.kind === 'freeze_piece') this.tracker.freeze(target, caster, turns, def.id);
          else this.tracker.shield(target, caster, turns, def.id);
          applied.push({ kind: eff.kind, target, remaining_turns: turns });
          break;
        }
        case 'draw_card': {
          const count = paramInt(eff.params, 'count', 1);
          for (let i = 0; i < count; i++) {
            const d = this.match.drawFor(caster);
            if (d.cardId !== '') drawn.push(d);
          }
          applied.push({ kind: eff.kind, count: drawn.length });
          break;
        }
        case 'gain_mana': {
          const amount = paramInt(eff.params, 'amount', 1);
          const m = this.match.gainMana(caster, amount);
          applied.push({ kind: eff.kind, amount, mana: m.current });
          break;
        }
        case 'move_piece': {
          const to = targets[1];
          if (target === undefined || to === undefined) throw new EffectError(WS.needsFromTo(def.name));
          const next = movePieceFen(fen, target, to, caster);
          // Solo il re di chi lancia (B5).
          if (isInCheck(withSideToMove(next, caster))) throw new EffectError(WS.exposesOwnKing);
          fen = next;
          changed = true;
          this.tracker.movePiece(target, to, null); // B13, B14
          applied.push({ kind: eff.kind, from: target, to });
          break;
        }
        default:
          throw new EffectError(WS.unsupportedEffect(eff.kind));
      }
    }
    if (changed) this.board.fen = fen; // una magia non cambia il lato al tratto
    return { applied, changed, drawn };
  }

  /** `room.go:678-686`. */
  private tickEffectsOnNewTurn(results: AdvanceResult[]): ExpiredEffect[] {
    const rollover = results.find((r) => r.newTurn);
    if (rollover === undefined) return [];
    return this.tracker.tickColor(rollover.activePlayer === 'white' ? 'black' : 'white');
  }

  /** `room.go:695-722`. */
  private checkRolloverGameEnd(results: AdvanceResult[]): { result: GameResult; reason: string } | null {
    if (!results.some((r) => r.newTurn)) return null;
    switch (getGameStatus(this.board.fen)) {
      case 'checkmate':
        this.board.status = 'checkmate';
        return { result: this.match.activePlayer === 'white' ? '0-1' : '1-0', reason: 'checkmate' };
      case 'stalemate':
        this.board.status = 'stalemate';
        return { result: '1/2-1/2', reason: 'stalemate' };
      case 'draw':
        this.board.status = 'draw';
        return { result: '1/2-1/2', reason: 'draw' };
      default:
        return null;
    }
  }

  /** `room.go:1122-1140`: lo status resta `active` (B1). */
  private handleResign(sender: GameClient): void {
    this.endGame(this.getColor(sender) === 'white' ? '0-1' : '1-0', 'resign');
  }

  /** `room.go:1143-1170`: nessun controllo di turno. */
  private handleDrawOffer(sender: GameClient): void {
    if (this.drawOfferer !== null) return this.sendError(sender, WS.drawOfferPending);
    this.drawOfferer = sender;
    this.getOpponent(sender).send(msg('draw_offer', { from: sender.username }));
    sender.send(msg('draw_offer_sent', { message: INFO.drawOfferSent }));
  }

  /** `room.go:1173-1210`. */
  private handleDrawResponse(sender: GameClient, accepted: boolean): void {
    if (this.drawOfferer === null) return this.sendError(sender, WS.noDrawOffer);
    if (this.drawOfferer.userId === sender.userId) return this.sendError(sender, WS.ownDrawOffer);
    const offerer = this.drawOfferer;
    this.drawOfferer = null;
    if (accepted) {
      this.board.status = 'draw';
      this.endGame('1/2-1/2', 'agreement');
    } else {
      offerer.send(msg('draw_declined', { message: INFO.drawDeclined(sender.username) }));
    }
  }

  // --- Connessioni ----------------------------------------------------------------------------------

  /** `room.go:853-888`: nessun controllo che `client` sia ancora quello registrato (B2). */
  leave(client: GameClient): void {
    if (this.board.status !== 'active') return;
    this.getOpponent(client).send(msg('opponent_disconnected', { message: INFO.opponentDisconnected }));
    // Una seconda Leave sovrascrive la voce senza fermare il timer precedente, come in Go.
    this.disconnectedTimers.set(
      client.userId,
      setTimeout(() => {
        this.endGame(this.getColor(client) === 'white' ? '0-1' : '1-0', 'abandonment');
      }, this.options.reconnectTimeoutMs),
    );
  }

  /** `room.go:891-937`. */
  reconnect(client: GameClient): void {
    const timer = this.disconnectedTimers.get(client.userId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.disconnectedTimers.delete(client.userId);
    }
    if (this.white.userId === client.userId) this.white = client;
    else if (this.black.userId === client.userId) this.black = client;
    this.ensureTimer();

    client.send(msg('game_state', { ...this.publicState(), reconnected: true }));
    this.sendHand(this.getColor(client));
    this.getOpponent(client).send(msg('opponent_reconnected', { message: INFO.opponentReconnected(client.username) }));
  }

  /**
   * Simula il riavvio del server (`manager.go:121-173`): orologio fermo, client sostituiti da segnaposto
   * che scartano i messaggi. Al primo `reconnect` l'orologio riparte.
   */
  suspendForRestart(): void {
    this.stopTimers();
    this.timerStarted = false;
    this.timerStopped = false;
    const placeholder = (c: GameClient): GameClient => ({ userId: c.userId, username: c.username, send: () => undefined });
    this.white = placeholder(this.white);
    this.black = placeholder(this.black);
  }

  // --- Orologio e fine partita ----------------------------------------------------------------------

  private ensureTimer(): void {
    if (this.timerStarted || this.timerStopped) return;
    this.timerStarted = true;
    this.timers = [
      setInterval(() => this.tick(), this.options.tickMs ?? 100),
      setInterval(() => this.broadcastTimers(), this.options.broadcastMs ?? 1000),
    ];
  }

  private stopTimers(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  /** `room.go:1052-1073`: scorre il tempo del giocatore attivo della FSM. */
  private tick(): void {
    const step = this.options.tickMs ?? 100;
    if (this.match.activePlayer === 'white') {
      this.whiteTime -= step;
      if (this.whiteTime <= 0) {
        this.whiteTime = 0;
        this.endGame('0-1', 'timeout');
      }
    } else {
      this.blackTime -= step;
      if (this.blackTime <= 0) {
        this.blackTime = 0;
        this.endGame('1-0', 'timeout');
      }
    }
  }

  /** `room.go:975-1035`. Non è idempotente e non imposta lo status (B1). */
  private endGame(result: GameResult, reason: string): void {
    this.stopTimers();
    this.timerStopped = true;
    for (const timer of this.disconnectedTimers.values()) clearTimeout(timer);

    const payload: Record<string, unknown> = { result, reason };
    if (result === '1-0') payload['winner'] = this.white.username;
    if (result === '0-1') payload['winner'] = this.black.username;
    setImmediate(() => this.options.onEnded?.(this, result, reason));
    this.broadcast('game_over', payload);
  }

  /** `room.go:963-972`: mosse UCI numerate (B7). */
  pgn(): string {
    return this.board.moves
      .map((m, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${m}` : m))
      .join(' ')
      .trim();
  }

  isActive(): boolean {
    return this.board.status === 'active';
  }

  // --- Serializzazione ------------------------------------------------------------------------------

  /** `room.go:1101-1119` (+ P0-5 nel contratto `proposed`). */
  publicState(): Record<string, unknown> {
    const { white, black } = this.match;
    const state: Record<string, unknown> = {
      board: { fen: this.board.fen, moves: [...this.board.moves], turn: this.board.turn, status: this.board.status },
      white_time: this.whiteTime,
      black_time: this.blackTime,
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
    };
    if (this.options.contract === 'proposed') {
      state['white_player'] = { id: this.white.userId, username: this.white.username };
      state['black_player'] = { id: this.black.userId, username: this.black.username };
    }
    return state;
  }

  private broadcastState(): void {
    this.broadcast('game_state', this.publicState());
  }

  /** `room.go:827-842`. */
  private sendHand(color: Color): void {
    const ps = this.match.player(color);
    this.clientOf(color).send(msg('hand', { hand: [...ps.hand], mana: ps.mana, max_mana: ps.max_mana, deck_size: ps.deck.length }));
  }

  /** `room.go:774-789`. */
  private applyAdvanceBroadcasts(res: AdvanceResult): void {
    this.broadcast('phase_changed', { phase: res.phase, active_player: res.activePlayer, turn_number: res.turnNumber });
    if (!res.newTurn) return;
    if (res.mana !== null) this.broadcastMana(res.mana);
    if (res.draw !== null) this.broadcastDraw(res.draw);
  }

  private broadcastMana(m: ManaState): void {
    this.broadcast('mana_changed', { player: m.player, current: m.current, max: m.max });
  }

  /** `room.go:802-815`. */
  private broadcastDraw(d: DrawResult): void {
    if (d.cardId !== '') this.clientOf(d.player).send(msg('card_drawn', { card_id: d.cardId, deck_size: d.deckSize }));
    this.broadcast('hand_size_changed', { player: d.player, size: d.handSize });
  }

  /** `room.go:725-738`. */
  private broadcastExpired(expired: ExpiredEffect[]): void {
    for (const e of expired) {
      this.broadcast('effect_expired', { square: e.square, effect_kind: e.kind, piece_id: e.pieceId });
    }
  }

  private broadcastTimers(): void {
    this.broadcast('timer_update', { white_time: this.whiteTime, black_time: this.blackTime, turn: this.match.activePlayer });
  }

  private broadcast(type: WireServerType, payload: Record<string, unknown>): void {
    const message = msg(type, payload);
    this.white.send(message);
    this.black.send(message);
  }

  private sendError(client: GameClient, text: ServerText): void {
    const payload: Record<string, unknown> = { message: text.message };
    if (this.options.contract === 'proposed') payload['code'] = text.code; // P1-3
    client.send(msg('error', payload));
  }

  private recordPosition(): void {
    const key = this.board.fen.split(' ').slice(0, 4).join(' ');
    this.posCounts.set(key, (this.posCounts.get(key) ?? 0) + 1);
  }

  private isThreefold(): boolean {
    return (this.posCounts.get(this.board.fen.split(' ').slice(0, 4).join(' ')) ?? 0) >= 3;
  }

  /** `room.go:948-960`: per `UserID`. */
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
    this.stopTimers();
    this.timerStopped = true;
    for (const timer of this.disconnectedTimers.values()) clearTimeout(timer);
  }
}

function msg(type: WireServerType, payload: Record<string, unknown>): WireServerMessage {
  return { type, payload };
}
