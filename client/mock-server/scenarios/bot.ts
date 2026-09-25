import { CATALOG, paramStrings, type Spell } from '../game/catalog';
import { legalMoves } from '../game/engine';
import { parsePlacement, squareName, type Color } from '../game/fen';
import type { GameClient, Room } from '../game/room';
import { validateTargets } from '../game/targets';
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
    // Solo le mosse giocabili: niente pezzi congelati, muri o catture su un santuario. Le rune non bloccano le mosse e
    // il bot non le guarda: quelle nascoste dell'avversario non sono nello stato che riceverebbe un client.
    const legal = legalMoves(room.board.fen).filter((m) => room.isPlayable(m));
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

  /** Prima carta abbordabile con bersagli validi (e una scelta, se serve), in ordine di mano. */
  private pickCast(room: Room): { spell_id: string; targets: string[]; choice?: { piece: string } } | null {
    const ps = room.match.player(this.color);
    for (const id of ps.hand) {
      const spell = CATALOG.get(id);
      if (spell === undefined || this.rejected.has(id) || spell.mana_cost > ps.mana || !spell.phases.includes(room.match.currentPhase)) continue;
      const targets = this.targetsFor(room, spell);
      if (targets === null) continue;
      const choice = this.choiceFor(room, spell);
      if (choice === null) continue;
      return choice === '' ? { spell_id: id, targets } : { spell_id: id, targets, choice: { piece: choice } };
    }
    return null;
  }

  /**
   * Scelta del pezzo: l'ultima ammessa per la promozione (la regina), il primo tipo presente nel cimitero per il
   * ritorno dal cimitero. `''` = nessuna scelta richiesta, `null` = la magia ora non si può lanciare.
   */
  private choiceFor(room: Room, spell: Spell): string | null {
    for (const effect of spell.effects) {
      if (effect.kind === 'promote_piece') return paramStrings(effect.params, 'choices').at(-1) ?? null;
      if (effect.kind === 'revive_piece') {
        const grave = room.match.player(this.color).graveyard;
        return paramStrings(effect.params, 'pieces').find((kind) => grave.some((g) => g.piece === kind)) ?? null;
      }
    }
    return '';
  }

  /**
   * Bersagli passo per passo: la prima casella che `validateTargets` accetta (pedoni prima, e per le magie senza
   * `require_effect` pezzi senza effetti addosso, così un gelo non si spreca su un pezzo già congelato). Una posizione
   * che il server rifiuta con `illegal_position` finisce in `rejected` e il bot prova un'altra carta.
   */
  private targetsFor(room: Room, spell: Spell): string[] | null {
    const pieces: { square: string; piece: string }[] = [];
    parsePlacement(room.board.fen).forEach((row, r) =>
      row.forEach((cell, c) => {
        if (cell !== null) pieces.push({ square: squareName(r, c), piece: cell });
      }),
    );
    const pawnsFirst = [...pieces].sort((a, b) => Number(b.piece.toLowerCase() === 'p') - Number(a.piece.toLowerCase() === 'p'));
    const allSquares = Array.from({ length: 64 }, (_, i) => squareName(Math.floor(i / 8), i % 8));
    // Le rune vanno al centro, dove qualcuno ci passerà: prima le case più vicine al centro.
    const centre = (sq: string) => {
      const col = sq.charCodeAt(0) - 97;
      const rank = sq.charCodeAt(1) - 49;
      return Math.max(Math.abs(col - 3.5), Math.abs(rank - 3.5));
    };
    const squares = spell.effects.some((e) => e.kind === 'place_rune') ? [...allSquares].sort((a, b) => centre(a) - centre(b)) : allSquares;

    const chosen: string[] = [];
    for (const [index, spec] of spell.targets.entries()) {
      const candidates =
        spec.type === 'square'
          ? squares
          : pawnsFirst
              .map((p) => p.square)
              .filter((sq) => spec.require_effect !== undefined || (!room.tracker.isFrozen(sq) && !room.tracker.hasShield(sq)));
      const pick = candidates.find((sq) => {
        try {
          validateTargets(room.board.fen, room.tracker, spell.targets.slice(0, index + 1), [...chosen, sq], this.color);
          return true;
        } catch {
          return false;
        }
      });
      if (pick === undefined) return null;
      chosen.push(pick);
    }
    return chosen;
  }

  dispose(): void {
    if (this.pending !== null) clearTimeout(this.pending);
    this.over = true;
  }
}
