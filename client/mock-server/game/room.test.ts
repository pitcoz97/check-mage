import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Contract } from '../config';
import { createRng } from '../util';
import type { WireServerMessage, WireServerType } from '../wire';
import type { MatchOverrides } from './match';
import { Room, type GameClient } from './room';

/**
 * Porting dei casi di `game/room_test.go` e `game/reconnect_test.go`, più i flussi e i bug replicati.
 */

class FakeClient implements GameClient {
  readonly messages: WireServerMessage[] = [];
  constructor(
    readonly userId: number,
    readonly username: string,
  ) {}
  send(message: WireServerMessage): void {
    this.messages.push(message);
  }
  types(): WireServerType[] {
    return this.messages.map((m) => m.type);
  }
  all(type: WireServerType): Record<string, unknown>[] {
    return this.messages.filter((m) => m.type === type).map((m) => m.payload);
  }
  last(type: WireServerType): Record<string, unknown> | undefined {
    return this.all(type).at(-1);
  }
  clear(): void {
    this.messages.length = 0;
  }
}

const rooms: Room[] = [];
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  rooms.forEach((r) => r.dispose());
  rooms.length = 0;
  vi.useRealTimers();
});

const NOTHING_CASTABLE: MatchOverrides = { hand: { white: ['nova', 'nova', 'nova', 'nova'], black: ['nova', 'nova', 'nova', 'nova'] } };

function setup(opts: { overrides?: MatchOverrides; fen?: string; contract?: Contract; baseTimeMs?: number } = {}) {
  const white = new FakeClient(1, 'mario');
  const black = new FakeClient(2, 'luigi');
  const ended: string[] = [];
  const room = new Room({
    id: 'room-1-2',
    white,
    black,
    rng: createRng(7),
    contract: opts.contract ?? 'current',
    baseTimeMs: opts.baseTimeMs ?? 600_000,
    incrementMs: 5_000,
    reconnectTimeoutMs: 30_000,
    overrides: opts.overrides ?? NOTHING_CASTABLE,
    ...(opts.fen === undefined ? {} : { initialFen: opts.fen }),
    onEnded: (_r, result, reason) => ended.push(`${result} ${reason}`),
  });
  rooms.push(room);
  room.start();
  // Senza payload come un client che non lo invia: `json.Unmarshal(nil)` fallisce per move e cast.
  const send = (client: GameClient, type: string, payload?: unknown) => room.handleMessage(client, type, payload);
  const lastError = (c: FakeClient) => c.last('error')?.['message'];
  return { room, white, black, send, lastError, ended };
}

describe('avvio (room.go:49-95)', () => {
  it('game_state (draw) → hand privata → phase_changed dell’auto-avanzamento', () => {
    const { white, black } = setup();
    expect(white.types()).toEqual(['game_state', 'hand', 'phase_changed', 'phase_changed']);
    expect(white.messages[0]?.payload).toMatchObject({ phase: 'draw', active_player: 'white', turn_number: 1, white_hand_size: 4 });
    expect(white.all('phase_changed').map((p) => p['phase'])).toEqual(['main1', 'move']);
    expect(white.last('hand')).toEqual({ hand: ['nova', 'nova', 'nova', 'nova'], mana: 1, max_mana: 1, deck_size: 36 });
    expect(black.types()).toEqual(['game_state', 'hand', 'phase_changed', 'phase_changed']);
    expect(white.messages[0]?.payload).not.toHaveProperty('white_player');
  });

  it('con una carta castabile si ferma in main1; contratto proposed espone i giocatori', () => {
    const { white } = setup({ overrides: { hand: { white: ['spark'] } }, contract: 'proposed' });
    expect(white.all('phase_changed').map((p) => p['phase'])).toEqual(['main1']);
    expect(white.messages[0]?.payload).toMatchObject({
      white_player: { id: 1, username: 'mario' },
      black_player: { id: 2, username: 'luigi' },
    });
  });
});

describe('mosse (room.go:312-434)', () => {
  it('rifiuti: turno, fase, legalità, pezzo congelato; codice solo nel contratto proposed', () => {
    const { room, white, black, send, lastError } = setup({ contract: 'proposed' });
    send(black, 'move', { move: 'e7e5' });
    expect(black.last('error')).toEqual({ message: 'Non è il tuo turno', code: 'not_your_turn' });
    send(white, 'move', { move: 'e2e5' });
    expect(lastError(white)).toBe('Mossa illegale: e2e5');
    send(white, 'move');
    expect(lastError(white)).toBe('Formato mossa non valido');
    room.tracker.freeze('e2', 'black', 2, 'frostbolt');
    send(white, 'move', { move: 'e2e4' });
    expect(lastError(white)).toBe('Il pezzo in e2 è congelato');
    send(white, 'pass_phase');
    expect(lastError(white)).toBe('Non puoi passare nella fase move');
  });

  it('mossa → game_state → main2 → rollover al nero con mana e pesca privata; incremento', () => {
    const { room, white, black, send } = setup();
    white.clear();
    black.clear();
    send(white, 'move', { move: 'e2e4' });
    expect(black.types()).toEqual([
      'game_state',
      'phase_changed', // main2
      'phase_changed', // draw (nero)
      'mana_changed',
      'card_drawn',
      'hand_size_changed',
      'phase_changed', // main1
      'phase_changed', // move
    ]);
    expect(white.types()).not.toContain('card_drawn');
    expect(black.last('card_drawn')).toMatchObject({ deck_size: 35 });
    expect(black.all('phase_changed').map((p) => [p['phase'], p['active_player'], p['turn_number']])).toEqual([
      ['main2', 'white', 1],
      ['draw', 'black', 2],
      ['main1', 'black', 2],
      ['move', 'black', 2],
    ]);
    expect(room.whiteTime).toBe(605_000);
  });

  it('scudo che assorbe la cattura: nessun pezzo si muove, mossa non registrata (B7), il turno passa', () => {
    const fen = '4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1';
    const { room, white, black, send } = setup({ fen });
    room.tracker.shield('d5', 'black', 2, 'aegis');
    black.clear();
    send(white, 'move', { move: 'e4d5' });
    expect(black.types().slice(0, 2)).toEqual(['effect_expired', 'game_state']);
    expect(black.messages[0]?.payload).toEqual({ square: 'd5', effect_kind: 'shield', reason: 'shield_absorbed' });
    expect(black.last('game_state')).toMatchObject({
      board: { fen: '4k3/8/8/3p4/4P3/8/8/4K3 b - - 1 1', moves: [], turn: 'black' },
      active_effects: [],
    });
  });

  it('effetti scaduti al rollover del proprietario, con piece_id', () => {
    const { room, white, black, send } = setup();
    room.tracker.freeze('e7', 'white', 1, 'frostbolt');
    send(white, 'move', { move: 'e2e4' });
    black.clear();
    send(black, 'move', { move: 'd7d5' });
    expect(black.last('effect_expired')).toEqual({ square: 'e7', effect_kind: 'freeze', piece_id: expect.any(Number) });
  });
});

describe('magie (room.go:480-673)', () => {
  it('ordine dei broadcast, cast senza cambio di fase, Channel e Insight', () => {
    const { white, black, send } = setup({ overrides: { hand: { white: ['channel', 'insight', 'spark', 'nova'] } } });
    black.clear();
    white.clear();
    send(white, 'cast_spell', { spell_id: 'channel', targets: [] });
    expect(black.types()).toEqual(['spell_cast', 'mana_changed', 'hand_size_changed']);
    expect(black.messages[0]?.payload).toEqual({
      player: 'white',
      spell_id: 'channel',
      targets: [],
      effects_applied: [{ kind: 'gain_mana', amount: 2, mana: 3 }],
    });
    expect(black.last('mana_changed')).toEqual({ player: 'white', current: 3, max: 1 });
    send(white, 'cast_spell', { spell_id: 'insight', targets: [] });
    expect(white.types().slice(-4)).toEqual(['spell_cast', 'mana_changed', 'hand_size_changed', 'card_drawn']);
    expect(black.types()).not.toContain('card_drawn');
    expect(white.all('spell_cast')[1]?.['effects_applied']).toEqual([{ kind: 'draw_card', count: 1 }]);
  });

  it('dopo l’ultimo cast possibile la fase avanza da sola', () => {
    const { white, send } = setup({ overrides: { hand: { white: ['spark', 'nova', 'nova', 'nova'] } } });
    white.clear();
    send(white, 'cast_spell', { spell_id: 'spark', targets: [] });
    expect(white.all('phase_changed').map((p) => p['phase'])).toEqual(['move']);
  });

  it('rifiuti degli effetti a costo zero e testi esatti', () => {
    const { white, send, lastError, room } = setup({
      overrides: { hand: { white: ['disintegrate', 'frostbolt', 'aegis', 'teleport'] }, manaFloor: { white: 10 } },
    });
    send(white, 'cast_spell', { spell_id: 'disintegrate', targets: ['e8'] });
    expect(lastError(white)).toBe('il re non può essere distrutto');
    send(white, 'cast_spell', { spell_id: 'frostbolt', targets: ['e2'] });
    expect(lastError(white)).toBe('non puoi congelare un tuo pezzo (e2)');
    send(white, 'cast_spell', { spell_id: 'aegis', targets: ['e4'] });
    expect(lastError(white)).toBe('nessun pezzo da proteggere in e4');
    send(white, 'cast_spell', { spell_id: 'teleport', targets: ['b1', 'd2'] });
    expect(lastError(white)).toBe('la casella d2 non è vuota');
    send(white, 'cast_spell', { spell_id: 'teleport', targets: 'b1' });
    expect(lastError(white)).toBe('Formato cast_spell non valido');
    expect(room.match.white.mana).toBe(10);
  });

  it('Disintegrate cambia la FEN (game_state); Teleport che scopre il proprio re è rifiutato', () => {
    const { white, send, lastError } = setup({
      fen: '4k3/8/8/8/8/8/4R3/4K2q w - - 0 1',
      overrides: { hand: { white: ['teleport', 'disintegrate', 'nova', 'nova'] }, manaFloor: { white: 10 } },
    });
    // Il re bianco in e1 è sotto scacco dalla donna in h1 (f1 e g1 vuote). Spostare la torre in e3 non para
    // lo scacco: il server rifiuta perché il re di chi lancia resterebbe sotto scacco (room.go:652-655).
    send(white, 'cast_spell', { spell_id: 'teleport', targets: ['e2', 'e3'] });
    expect(lastError(white)).toBe('mossa illegale: lascerebbe il re sotto scacco');
    send(white, 'cast_spell', { spell_id: 'disintegrate', targets: ['h1'] });
    expect(white.last('spell_cast')?.['effects_applied']).toEqual([{ kind: 'destroy_piece', target: 'h1', piece_destroyed: 'queen' }]);
    expect(white.last('game_state')).toMatchObject({ board: { fen: '4k3/8/8/8/8/8/4R3/4K3 w - - 0 1' } });
  });

  it('matto da magia rilevato al rollover (room.go:695-722)', () => {
    const { white, black, send, ended } = setup({
      fen: 'R5rk/6pp/8/8/8/8/8/6K1 w - - 0 1',
      overrides: { hand: { white: ['disintegrate', 'nova', 'nova', 'nova'] }, manaFloor: { white: 4 } },
    });
    send(white, 'pass_phase');
    send(white, 'move', { move: 'g1f1' });
    send(white, 'cast_spell', { spell_id: 'disintegrate', targets: ['g8'] });
    expect(black.last('game_over')).toEqual({ result: '1-0', reason: 'checkmate', winner: 'mario' });
    vi.runAllTicks();
    expect(ended).toEqual([]); // onEnded è asincrono (setImmediate)
  });
});

describe('patta (room.go:1143-1210)', () => {
  it('offerta, doppia offerta, risposta propria, rifiuto, accettazione', () => {
    const { white, black, send, lastError } = setup();
    send(black, 'draw_offer'); // nessun controllo di turno
    expect(black.last('draw_offer_sent')).toEqual({ message: 'Offerta di patta inviata' });
    expect(white.last('draw_offer')).toEqual({ from: 'luigi' });
    send(white, 'draw_offer');
    expect(lastError(white)).toBe("C'è già un'offerta di patta in corso");
    send(black, 'draw_accepted');
    expect(lastError(black)).toBe('Non puoi rispondere alla tua stessa offerta');
    send(white, 'draw_declined');
    expect(black.last('draw_declined')).toEqual({ message: 'mario ha rifiutato la patta' });
    send(white, 'draw_accepted');
    expect(lastError(white)).toBe('Nessuna offerta di patta in corso');
    send(white, 'draw_offer');
    send(black, 'draw_accepted');
    expect(white.last('game_over')).toEqual({ result: '1/2-1/2', reason: 'agreement' });
  });
});

describe('connessioni, orologio e bug replicati', () => {
  it('Leave → opponent_disconnected; Reconnect → game_state{reconnected} + hand + opponent_reconnected', () => {
    const { room, white, black } = setup();
    room.leave(black);
    expect(white.last('opponent_disconnected')).toBeDefined();
    const back = new FakeClient(2, 'luigi');
    room.reconnect(back);
    expect(back.types()).toEqual(['game_state', 'hand']);
    expect(back.messages[0]?.payload).toMatchObject({ reconnected: true });
    expect(white.last('opponent_reconnected')).toEqual({ message: 'luigi si è riconnesso!' });
    vi.advanceTimersByTime(31_000);
    expect(white.all('game_over')).toEqual([]);
  });

  it('abbandono dopo il timeout di riconnessione', () => {
    const { room, white, black } = setup();
    room.leave(black);
    vi.advanceTimersByTime(30_000);
    expect(white.last('game_over')).toEqual({ result: '1-0', reason: 'abandonment', winner: 'mario' });
  });

  it('orologio del giocatore attivo, timer_update ogni secondo, timeout', () => {
    const { white } = setup({ baseTimeMs: 2_000 });
    vi.advanceTimersByTime(1_000);
    // Come in Go, l'ordine tra il ticker da 100 ms e quello da 1 s nello stesso istante non è garantito.
    const update = white.last('timer_update');
    expect(update).toMatchObject({ black_time: 2_000, turn: 'white' });
    expect([1_000, 1_100]).toContain(update?.['white_time']);
    vi.advanceTimersByTime(1_000);
    expect(white.last('game_over')).toEqual({ result: '0-1', reason: 'timeout', winner: 'luigi' });
  });

  it('B1: dopo la resa una disconnessione produce un secondo game_over', () => {
    const { room, white, black, send } = setup();
    send(white, 'resign');
    expect(black.all('game_over')).toEqual([{ result: '0-1', reason: 'resign', winner: 'luigi' }]);
    room.leave(white);
    vi.advanceTimersByTime(30_000);
    expect(black.all('game_over')).toHaveLength(2);
  });

  it('B2: il socket vecchio che si chiude dopo il rientro fa perdere per abbandono', () => {
    const { room, white, black } = setup();
    const newBlack = new FakeClient(2, 'luigi');
    room.reconnect(newBlack);
    room.leave(black); // chiusura tardiva della connessione precedente
    vi.advanceTimersByTime(30_000);
    expect(newBlack.last('game_over')).toEqual({ result: '1-0', reason: 'abandonment', winner: 'mario' });
    expect(white.last('game_over')).toBeDefined();
  });

  it('B4: i messaggi vengono ancora gestiti dopo la fine della partita', () => {
    const { white, black, send } = setup();
    send(white, 'resign');
    send(white, 'move', { move: 'e2e4' });
    expect(black.last('game_state')).toMatchObject({ board: { moves: ['e2e4'] } });
  });

  it('PGN numerato in UCI', () => {
    const { room, white, black, send } = setup();
    send(white, 'move', { move: 'e2e4' });
    send(black, 'move', { move: 'e7e5' });
    send(white, 'move', { move: 'g1f3' });
    expect(room.pgn()).toBe('1. e2e4 e7e5 2. g1f3');
  });
});
