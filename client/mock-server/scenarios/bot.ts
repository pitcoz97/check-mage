import type { Square } from 'chess.js';

import { findSpell } from '../game/catalog';
import type { PlayerConnection, Room } from '../game/room';
import { filteredMoves, resolveCast, teleportDestinations, validateMove } from '../game/rules';
import { shuffle, type Rng } from '../util';
import type { WireClientType, WireColor, WireServerMessage } from '../wire';

export interface BotBehavior {
  /** Mosse da provare in ordine; se una non è legale si ripiega su una mossa casuale. */
  script?: readonly string[];
  castSpells?: boolean;
  /** Non agisce mai (scenario timeout). */
  stall?: boolean;
  offerDrawOnFirstTurn?: boolean;
  acceptDraws?: boolean;
  /** Si disconnette dopo N mosse proprie. */
  disconnectAfterMoves?: number;
  /** Dopo la disconnessione rientra dopo questi ms; `null` = non rientra mai. */
  reconnectAfterMs?: number | null;
}

/**
 * Avversario virtuale. Parla con il room attraverso la stessa `handle()` dei client reali, quindi passa
 * per le stesse validazioni; per scegliere cosa fare legge lo stato interno del room (è codice del mock).
 */
export class Bot {
  private conn: PlayerConnection;
  private connected = true;
  private movesMade = 0;
  private offeredDraw = false;
  private pending: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly room: Room,
    private readonly color: WireColor,
    private readonly behavior: BotBehavior,
    private readonly rng: Rng,
    private readonly delayMs: number,
  ) {
    this.conn = this.createConnection();
  }

  get connection(): PlayerConnection {
    return this.conn;
  }

  private createConnection(): PlayerConnection {
    return {
      send: (message) => this.onMessage(message),
      sendRaw: () => undefined,
      close: () => undefined,
    };
  }

  private onMessage(message: WireServerMessage): void {
    if (message.type === 'draw_offer' && this.behavior.acceptDraws === true) {
      setTimeout(() => this.send('draw_accepted'), this.delayMs);
      return;
    }
    const myTurnStarted =
      (message.type === 'phase_changed' && message.payload.active_player === this.room.usernameOf(this.color)) ||
      (message.type === 'game_start' && this.room.activeColor === this.color);
    if (myTurnStarted) this.schedule(() => this.act());
  }

  /** Una sola azione pendente alla volta: un nuovo evento sostituisce la reazione a quello precedente. */
  private schedule(action: () => void): void {
    if (this.pending !== null) clearTimeout(this.pending);
    this.pending = setTimeout(() => {
      this.pending = null;
      action();
    }, this.delayMs);
  }

  private send(type: WireClientType, payload: Record<string, unknown> = {}): void {
    if (!this.connected || this.room.isOver) return;
    this.room.handle(this.color, { type, payload });
  }

  private act(): void {
    if (this.behavior.stall === true || !this.connected || this.room.isOver || this.room.activeColor !== this.color) return;
    switch (this.room.currentPhase) {
      case 'draw':
        if (this.behavior.offerDrawOnFirstTurn === true && !this.offeredDraw) {
          this.offeredDraw = true;
          this.send('draw_offer');
        }
        return this.send('pass_phase');
      case 'main1':
      case 'main2': {
        const cast = this.behavior.castSpells === true ? this.pickCast() : null;
        if (cast === null) return this.send('pass_phase');
        this.send('cast_spell', cast);
        return this.schedule(() => this.act()); // un cast non cambia fase: si riprova
      }
      case 'move':
        return this.playMove();
      case 'end_turn':
        return;
    }
  }

  private playMove(): void {
    const move = this.pickMove();
    if (move === null) return;
    this.send('move', { move });
    this.movesMade += 1;
    if (this.behavior.disconnectAfterMoves === this.movesMade) this.dropConnection();
  }

  private dropConnection(): void {
    this.room.disconnect(this.color, this.conn);
    this.connected = false;
    const after = this.behavior.reconnectAfterMs;
    if (after === undefined || after === null) return;
    setTimeout(() => {
      if (this.room.isOver) return;
      this.conn = this.createConnection();
      this.connected = true;
      this.room.reconnect(this.color, this.conn);
    }, after);
  }

  private pickMove(): string | null {
    const board = this.room.currentBoard;
    const scripted = this.behavior.script?.[this.movesMade];
    if (scripted !== undefined && validateMove(board, this.color, scripted).ok) return scripted;
    const moves = filteredMoves(board, this.color);
    if (moves.length === 0) return null;
    const move = moves[Math.floor(this.rng() * moves.length)];
    return move === undefined ? null : `${move.from}${move.to}${move.promotion ?? ''}`;
  }

  /** Prima combinazione magia/bersagli che il room accetterebbe, provata a secco con resolveCast. */
  private pickCast(): { spell_id: string; targets: string[] } | null {
    const board = this.room.currentBoard;
    const mana = this.room.manaOf(this.color);
    const occupied = board.pieces.toWire();
    for (const card of this.room.handOf(this.color)) {
      const spell = findSpell(card.spellId);
      if (spell === undefined || !spell.phases.includes(this.room.currentPhase) || mana.current < spell.mana_cost) continue;

      const primaries: (Square | null)[] =
        spell.target_type === 'none' ? [null] : shuffle(occupied.map((p) => p.square as Square), this.rng);
      const needsDestination = spell.effects.some((e) => e.kind === 'move_piece');
      for (const primary of primaries) {
        const candidates: Square[][] =
          primary === null
            ? [[]]
            : needsDestination
              ? teleportDestinations(board, this.color, primary).map((dest) => [primary, dest])
              : [[primary]];
        for (const targets of candidates) {
          if (resolveCast(board, this.color, spell, targets).ok) return { spell_id: spell.id, targets };
        }
      }
    }
    return null;
  }

  dispose(): void {
    if (this.pending !== null) clearTimeout(this.pending);
    this.connected = false;
  }
}
