import { CATALOG, type Spell } from '../game/catalog';
import { legalMoves } from '../game/engine';
import {
  destroyPiece,
  isKingAttacked,
  movePieceFen,
  opponentOf,
  parsePlacement,
  pieceColor,
  sideToMove,
  squareName,
  type Color,
} from '../game/fen';
import type { GameClient, Room } from '../game/room';
import type { WireClientType, WireServerMessage } from '../wire';

export interface BotBehavior {
  /** Mosse da provare in ordine; se una non è legale si ripiega sulla prima mossa legale. */
  script?: readonly string[];
  castSpells?: boolean;
  /** Non agisce mai (scenario timeout). */
  stall?: boolean;
  offerDrawOnFirstTurn?: boolean;
  /** Offerte del client da rifiutare prima di accettare (0 = accetta subito; assente = ignora). */
  declineDrawsBeforeAccepting?: number;
  /** Dopo N mosse proprie: si disconnette (`leave`) oppure fa "riavviare il server". */
  afterMoves?: { count: number; action: 'disconnect' | 'restart'; returnAfterMs: number | null };
}

export interface BotHooks {
  /** Simula il riavvio del server per la room (chiusura dei socket, room dormiente). */
  restart(room: Room): void;
}

/**
 * Avversario virtuale. Agisce tramite `room.handleMessage`, quindi passa per le stesse validazioni dei client
 * reali; per scegliere cosa fare legge lo stato del room (è codice del mock).
 */
export class Bot {
  private client: GameClient;
  private movesMade = 0;
  private offeredDraw = false;
  private declined = 0;
  private over = false;
  private connected = true;
  private pending: ReturnType<typeof setTimeout> | null = null;
  /** Magie rifiutate dal room nella fase corrente: non si ritentano, così il bot non resta bloccato. */
  private readonly rejected = new Set<string>();
  private lastCast: string | null = null;

  constructor(
    readonly userId: number,
    readonly username: string,
    private readonly color: Color,
    private readonly behavior: BotBehavior,
    private readonly delayMs: number,
    private readonly hooks: BotHooks,
    private room: Room | null = null,
  ) {
    this.client = this.newClient();
  }

  get gameClient(): GameClient {
    return this.client;
  }

  attach(room: Room): void {
    this.room = room;
  }

  private newClient(): GameClient {
    return { userId: this.userId, username: this.username, send: (m) => this.onMessage(m) };
  }

  private onMessage(message: WireServerMessage): void {
    if (message.type === 'game_over') {
      this.over = true;
      return;
    }
    if (message.type === 'error' && this.lastCast !== null) {
      this.rejected.add(this.lastCast);
      return;
    }
    if (message.type === 'phase_changed') this.rejected.clear();
    if (message.type === 'draw_offer' && this.behavior.declineDrawsBeforeAccepting !== undefined) {
      const accept = this.declined >= this.behavior.declineDrawsBeforeAccepting;
      if (!accept) this.declined++;
      setTimeout(() => this.send(accept ? 'draw_accepted' : 'draw_declined'), this.delayMs);
      return;
    }
    const mine = message.payload['active_player'] === this.color;
    if ((message.type === 'phase_changed' && mine) || (message.type === 'game_state' && mine)) this.schedule();
  }

  private schedule(): void {
    if (this.pending !== null) clearTimeout(this.pending);
    this.pending = setTimeout(() => {
      this.pending = null;
      this.act();
    }, this.delayMs);
  }

  private send(type: WireClientType, payload: Record<string, unknown> = {}): void {
    if (this.room === null || this.over || !this.connected) return;
    this.room.handleMessage(this.client, type, payload);
  }

  private act(): void {
    const room = this.room;
    if (room === null || this.behavior.stall === true || this.over || !this.connected) return;
    if (room.match.activePlayer !== this.color) return;

    if (this.behavior.offerDrawOnFirstTurn === true && !this.offeredDraw) {
      this.offeredDraw = true;
      this.send('draw_offer');
    }

    switch (room.match.currentPhase) {
      case 'main1':
      case 'main2': {
        const cast = this.behavior.castSpells === true ? this.pickCast(room) : null;
        if (cast === null) return this.send('pass_phase');
        this.lastCast = cast.spell_id;
        this.send('cast_spell', cast);
        this.lastCast = null;
        return this.schedule(); // un cast può lasciare la fase invariata
      }
      case 'move':
        return this.playMove(room);
      default:
        return;
    }
  }

  private playMove(room: Room): void {
    const legal = legalMoves(room.board.fen).filter((m) => !room.tracker.isFrozen(m.slice(0, 2)));
    const scripted = this.behavior.script?.[this.movesMade];
    const move = scripted !== undefined && legal.includes(scripted) ? scripted : legal[0];
    if (move === undefined) return;
    this.send('move', { move });
    this.movesMade++;

    const after = this.behavior.afterMoves;
    if (after === undefined || after.count !== this.movesMade) return;
    if (after.action === 'disconnect') {
      room.leave(this.client);
      this.connected = false;
    } else {
      this.hooks.restart(room);
      this.connected = false;
    }
    if (after.returnAfterMs === null) return;
    setTimeout(() => {
      if (this.over) return;
      this.client = this.newClient();
      this.connected = true;
      room.reconnect(this.client);
    }, after.returnAfterMs);
  }

  /** Prima carta abbordabile con bersagli validi, in ordine di mano. */
  private pickCast(room: Room): { spell_id: string; targets: string[] } | null {
    const ps = room.match.player(this.color);
    for (const id of ps.hand) {
      const spell = CATALOG.get(id);
      if (spell === undefined || this.rejected.has(id) || spell.mana_cost > ps.mana || !spell.phases.includes(room.match.currentPhase)) continue;
      const targets = this.targetsFor(room, spell);
      if (targets !== null) return { spell_id: id, targets };
    }
    return null;
  }

  private targetsFor(room: Room, spell: Spell): string[] | null {
    const pieces: { square: string; piece: string }[] = [];
    parsePlacement(room.board.fen).forEach((row, r) =>
      row.forEach((cell, c) => {
        if (cell !== null) pieces.push({ square: squareName(r, c), piece: cell });
      }),
    );
    const own = pieces.filter((p) => pieceColor(p.piece) === this.color && p.piece.toLowerCase() !== 'k');
    const enemy = pieces.filter((p) => pieceColor(p.piece) !== this.color && p.piece.toLowerCase() !== 'k');
    const pawnsFirst = (list: typeof pieces) => [...list].sort((a, b) => Number(b.piece.toLowerCase() === 'p') - Number(a.piece.toLowerCase() === 'p'));

    switch (spell.target_type) {
      case 'none':
        return [];
      case 'enemy_piece': {
        // Bersaglio senza effetti, così una Disintegrate non cancella il congelamento appena lanciato; e niente
        // posizioni che il server rifiuterebbe con `illegal_position` (`game/room.go:725-733`).
        const legalAfterDestroy = (square: string) => {
          if (!spell.effects.some((e) => e.kind === 'destroy_piece')) return true;
          const next = destroyPiece(room.board.fen, square, this.color).fen;
          return !isKingAttacked(next, opponentOf(sideToMove(next)));
        };
        const candidate = pawnsFirst(enemy).find(
          (p) => !room.tracker.isFrozen(p.square) && !room.tracker.hasShield(p.square) && legalAfterDestroy(p.square),
        );
        return candidate === undefined ? null : [candidate.square];
      }
      case 'own_piece': {
        const candidate = pawnsFirst(own).find((p) => !room.tracker.hasShield(p.square));
        return candidate === undefined ? null : [candidate.square];
      }
      case 'piece_move': {
        const occupied = new Set(pieces.map((p) => p.square));
        // Solo pezzi non pedoni e non re: basta per lo scenario e tiene le mosse leggibili.
        for (const from of own.filter((p) => p.piece.toLowerCase() !== 'p')) {
          for (let r = 2; r <= 5; r++) {
            for (let c = 0; c < 8; c++) {
              const to = squareName(r, c);
              if (occupied.has(to)) continue;
              try {
                const next = movePieceFen(room.board.fen, from.square, to, this.color);
                const waiting = opponentOf(sideToMove(next));
                if (!isKingAttacked(next, this.color) && !isKingAttacked(next, waiting)) return [from.square, to];
              } catch {
                continue;
              }
            }
          }
        }
        return null;
      }
      default:
        return null;
    }
  }

  dispose(): void {
    if (this.pending !== null) clearTimeout(this.pending);
    this.over = true;
  }
}
