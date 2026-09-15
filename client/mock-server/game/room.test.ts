import { Chess } from 'chess.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRng } from '../util';
import type { WireClientMessage, WireColor, WireServerMessage } from '../wire';
import { PieceRegistry } from './pieces';
import { Room, type PlayerConnection, type RoomOptions } from './room';

class FakeConn implements PlayerConnection {
  readonly messages: WireServerMessage[] = [];
  readonly raw: string[] = [];
  closed = false;
  send(message: WireServerMessage): void {
    this.messages.push(message);
  }
  sendRaw(text: string): void {
    this.raw.push(text);
  }
  close(): void {
    this.closed = true;
  }
  ofType<T extends WireServerMessage['type']>(type: T): Extract<WireServerMessage, { type: T }>[] {
    return this.messages.filter((m): m is Extract<WireServerMessage, { type: T }> => m.type === type);
  }
  last<T extends WireServerMessage['type']>(type: T): Extract<WireServerMessage, { type: T }> | undefined {
    return this.ofType(type).at(-1);
  }
  clear(): void {
    this.messages.length = 0;
  }
}

const rooms: Room[] = [];
afterEach(() => {
  rooms.forEach((room) => room.shutdown());
  rooms.length = 0;
  vi.useRealTimers();
});

function setup(overrides: Partial<RoomOptions> = {}) {
  const white = new FakeConn();
  const black = new FakeConn();
  const room = new Room({
    roomId: 'room-1-2',
    white: { userId: 1, username: 'mario' },
    black: { userId: 2, username: 'luigi' },
    rng: createRng(7),
    clockMs: 600_000,
    reconnectTimeoutMs: 30_000,
    tickMs: 3_600_000,
    ...overrides,
  });
  rooms.push(room);
  room.attach('white', white);
  room.attach('black', black);
  room.start();
  const conns: Record<WireColor, FakeConn> = { white, black };
  const send = (color: WireColor, type: WireClientMessage['type'], payload: Record<string, unknown> = {}) =>
    room.handle(color, { type, payload });
  const lastError = (color: WireColor) => conns[color].last('error')?.payload.code;
  /** Porta il giocatore attivo da `draw` a `main1`. */
  const toMain1 = (color: WireColor) => send(color, 'pass_phase');
  /** Turno completo senza magie: draw → main1 → move → main2 → fine turno. */
  const playTurn = (color: WireColor, move: string) => {
    send(color, 'pass_phase');
    send(color, 'pass_phase');
    send(color, 'move', { move });
    send(color, 'pass_phase');
  };
  return { room, conns, send, lastError, toMain1, playTurn };
}

describe('avvio partita', () => {
  it('snapshot completo con mano privata e mazzo da 40 carte', () => {
    const { conns } = setup();
    const w = conns.white.last('game_start')?.payload;
    const b = conns.black.last('game_start')?.payload;
    expect(w).toMatchObject({ room_id: 'room-1-2', white: 'mario', black: 'luigi', phase: 'draw', active_player: 'mario', turn_number: 1 });
    expect(w?.hand).toHaveLength(5); // 4 iniziali + pesca del primo turno (M6)
    expect(b?.hand).toHaveLength(4);
    expect(w?.hand_sizes).toEqual({ mario: 5, luigi: 4 });
    expect(w?.deck_sizes).toEqual({ mario: 35, luigi: 36 });
    expect(w?.mana).toEqual({ mario: { current: 1, max: 1 }, luigi: { current: 0, max: 0 } });
    expect(w?.pieces).toHaveLength(32);
    // La mano avversaria non viaggia mai.
    const whiteIds = new Set(w?.hand?.map((c) => c.card_id));
    expect(b?.hand?.some((c) => whiteIds.has(c.card_id))).toBe(false);
  });
});

describe('fasi e turni', () => {
  it('rifiuta azioni fuori turno e fuori fase', () => {
    const { send, lastError } = setup();
    send('black', 'pass_phase');
    expect(lastError('black')).toBe('not_your_turn');
    send('white', 'move', { move: 'e2e4' });
    expect(lastError('white')).toBe('wrong_phase');
    send('white', 'pass_phase');
    send('white', 'pass_phase');
    send('white', 'pass_phase'); // in `move` la mossa è obbligatoria
    expect(lastError('white')).toBe('wrong_phase');
  });

  it('dopo la mossa avanza da solo a main2; fine turno passa al nero con pesca privata', () => {
    const { send, conns } = setup();
    send('white', 'pass_phase');
    send('white', 'pass_phase');
    conns.white.clear();
    conns.black.clear();
    send('white', 'move', { move: 'e2e4' });
    expect(conns.black.last('game_state')?.payload.board).toMatchObject({ moves: ['e2e4'], turn: 'black' });
    expect(conns.black.last('phase_changed')?.payload).toEqual({ phase: 'main2', active_player: 'mario', turn_number: 1 });

    send('white', 'pass_phase');
    expect(conns.black.ofType('phase_changed').map((m) => m.payload.phase)).toEqual(['main2', 'end_turn', 'draw']);
    expect(conns.black.last('phase_changed')?.payload).toMatchObject({ active_player: 'luigi', turn_number: 2 });
    expect(conns.black.ofType('card_drawn')).toHaveLength(1);
    expect(conns.white.ofType('card_drawn')).toHaveLength(0);
    expect(conns.white.last('hand_size_changed')?.payload).toEqual({ player: 'luigi', size: 5, deck_size: 35 });
  });

  it('mossa illegale e mossa di pezzo altrui', () => {
    const { send, lastError } = setup();
    send('white', 'pass_phase');
    send('white', 'pass_phase');
    send('white', 'move', { move: 'e2e5' });
    expect(lastError('white')).toBe('illegal_move');
    send('white', 'move', { move: 'e7e5' });
    expect(lastError('white')).toBe('illegal_move');
    send('white', 'move', { move: 42 });
    expect(lastError('white')).toBe('illegal_move');
  });

  it('M6: mana +1 ogni 2 turni propri, ricarica al massimo', () => {
    const { playTurn, conns } = setup();
    const moves = [['g1f3', 'g8f6'], ['f3g1', 'f6g8'], ['g1f3', 'g8f6'], ['f3g1', 'f6g8']] as const;
    for (const [w, b] of moves) {
      playTurn('white', w);
      playTurn('black', b);
    }
    const whiteMana = conns.white
      .ofType('mana_changed')
      .filter((m) => m.payload.player === 'mario')
      .map((m) => [m.payload.current, m.payload.max]);
    // Turni propri 2, 3, 4, 5 (il turno 1 è nello snapshot, 1/1).
    expect(whiteMana).toEqual([[1, 1], [2, 2], [2, 2], [3, 3]]);
  });
});

describe('magie', () => {
  it('mana insufficiente, carta non in mano, fase sbagliata', () => {
    const { send, toMain1, lastError } = setup({ deckTop: { white: ['shield', 'shield', 'shield', 'shield', 'shield'] } });
    send('white', 'cast_spell', { spell_id: 'shield', targets: ['e2'] });
    expect(lastError('white')).toBe('wrong_phase'); // in `draw`
    toMain1('white');
    send('white', 'cast_spell', { spell_id: 'shield', targets: ['e2'] });
    expect(lastError('white')).toBe('insufficient_mana');
    send('white', 'cast_spell', { spell_id: 'fireball', targets: ['e7'] });
    expect(lastError('white')).toBe('card_not_in_hand');
    send('white', 'cast_spell', { spell_id: 'no_such_spell', targets: [] });
    expect(lastError('white')).toBe('unknown_spell');
  });

  it('Recover: il mana può superare il massimo (M6) e l’ordine dei messaggi segue M10', () => {
    const { send, toMain1, conns } = setup({ deckTop: { white: ['recover'] } });
    toMain1('white');
    conns.black.clear();
    send('white', 'cast_spell', { spell_id: 'recover', targets: [] });
    expect(conns.black.messages.map((m) => m.type)).toEqual(['spell_cast', 'mana_changed', 'hand_size_changed']);
    expect(conns.black.last('mana_changed')?.payload).toEqual({ player: 'mario', current: 3, max: 1 });
    expect(conns.black.last('spell_cast')?.payload.effects_applied).toEqual([{ kind: 'gain_mana', params: { amount: 3 } }]);
  });

  it('target none con bersagli, o bersaglio mancante → invalid_target', () => {
    const { send, toMain1, lastError } = setup({ startingMaxMana: 10, deckTop: { white: ['recover', 'ice_age'] } });
    toMain1('white');
    send('white', 'cast_spell', { spell_id: 'recover', targets: ['e4'] });
    expect(lastError('white')).toBe('invalid_target');
    send('white', 'cast_spell', { spell_id: 'ice_age', targets: [] });
    expect(lastError('white')).toBe('invalid_target');
    send('white', 'cast_spell', { spell_id: 'ice_age', targets: ['e2'] }); // pezzo proprio
    expect(lastError('white')).toBe('invalid_target');
  });

  it('M3: Fireball non può colpire il re', () => {
    const { send, toMain1, lastError, conns } = setup({ startingMaxMana: 10, deckTop: { white: ['fireball'] } });
    toMain1('white');
    send('white', 'cast_spell', { spell_id: 'fireball', targets: ['e8'] });
    expect(lastError('white')).toBe('invalid_target');
    send('white', 'cast_spell', { spell_id: 'fireball', targets: ['b8'] });
    const state = conns.black.last('game_state')?.payload;
    expect(state?.board.fen.startsWith('r1bqkbnr')).toBe(true);
    expect(state?.pieces?.some((p) => p.square === 'b8')).toBe(false);
  });

  it('Ice Age: il pezzo congelato non muove, e lo stato scade dopo 2 turni del proprietario (M5)', () => {
    const { send, toMain1, lastError, playTurn, conns } = setup({ startingMaxMana: 10, deckTop: { white: ['ice_age'] } });
    toMain1('white');
    send('white', 'cast_spell', { spell_id: 'ice_age', targets: ['e7'] });
    const applied = conns.black.last('effect_applied')?.payload;
    expect(applied).toMatchObject({ effect_kind: 'freeze', remaining_turns: 2 });
    send('white', 'pass_phase');
    send('white', 'move', { move: 'g1f3' });
    send('white', 'pass_phase');

    send('black', 'pass_phase');
    send('black', 'pass_phase');
    send('black', 'move', { move: 'e7e5' });
    expect(lastError('black')).toBe('piece_frozen');
    send('black', 'move', { move: 'g8f6' });
    send('black', 'pass_phase');
    expect(conns.white.ofType('effect_expired')).toHaveLength(0);

    playTurn('white', 'f3g1');
    playTurn('black', 'f6g8');
    expect(conns.white.last('effect_expired')?.payload).toEqual({ piece_id: applied?.piece_id, effect_kind: 'freeze' });
  });

  it('M7: se i congelamenti lasciano zero mosse e non c’è scacco → stallo', () => {
    // Nero: solo re in h8 e pedone in a7; il bianco congela il pedone e toglie le case al re.
    const { send, toMain1, conns } = setup({
      fen: '7k/p7/5Q2/8/8/8/8/K7 w - - 0 1',
      startingMaxMana: 10,
      deckTop: { white: ['ice_age'] },
    });
    toMain1('white');
    send('white', 'cast_spell', { spell_id: 'ice_age', targets: ['a7'] });
    send('white', 'pass_phase');
    send('white', 'move', { move: 'f6f7' }); // re nero in h8: g8 e g7 controllate, h7 controllata
    send('white', 'pass_phase');
    send('black', 'pass_phase');
    send('black', 'pass_phase');
    expect(conns.black.last('game_over')?.payload).toEqual({ result: '1/2-1/2', reason: 'stalemate', winner: null });
  });

  it('Shield: il pezzo non è catturabile né bersagliabile dalle magie avversarie (M1)', () => {
    const { send, toMain1, lastError } = setup({
      fen: '4k3/8/8/3p4/4P3/8/8/4K3 b - - 0 1',
      startingMaxMana: 10,
      deckTop: { black: ['shield'], white: ['fireball'] },
    });
    toMain1('black');
    send('black', 'cast_spell', { spell_id: 'shield', targets: ['d5'] });
    send('black', 'pass_phase');
    send('black', 'move', { move: 'e8e7' });
    send('black', 'pass_phase');

    toMain1('white');
    send('white', 'cast_spell', { spell_id: 'fireball', targets: ['d5'] });
    expect(lastError('white')).toBe('target_shielded');
    send('white', 'pass_phase');
    send('white', 'move', { move: 'e4d5' });
    expect(lastError('white')).toBe('target_shielded');
  });

  it('Teleport: sposta il pezzo con il suo id, non fa avanzare la fase, niente catture (M2)', () => {
    const { send, toMain1, lastError, conns } = setup({ startingMaxMana: 10, deckTop: { white: ['teleport'] } });
    toMain1('white');
    const before = conns.white.last('game_start')?.payload.pieces?.find((p) => p.square === 'g1');
    send('white', 'cast_spell', { spell_id: 'teleport', targets: ['g1', 'g2'] }); // occupata
    expect(lastError('white')).toBe('invalid_target');
    send('white', 'cast_spell', { spell_id: 'teleport', targets: ['g1', 'g5'] }); // non raggiungibile
    expect(lastError('white')).toBe('invalid_target');
    conns.white.clear();
    send('white', 'cast_spell', { spell_id: 'teleport', targets: ['g1', 'f3'] });
    const state = conns.white.last('game_state')?.payload;
    expect(state?.pieces?.find((p) => p.square === 'f3')?.piece_id).toBe(before?.piece_id);
    expect(conns.white.ofType('phase_changed')).toHaveLength(0);
    send('white', 'pass_phase');
    expect(conns.white.last('phase_changed')?.payload.phase).toBe('move');
  });

  it('M4: Teleport non può dare scacco al re avversario quando ha ancora il tratto chi lancia', () => {
    const { send, toMain1, lastError } = setup({
      fen: '4k3/8/8/8/8/8/8/R3K3 w - - 0 1',
      startingMaxMana: 10,
      deckTop: { white: ['teleport'] },
    });
    toMain1('white');
    send('white', 'cast_spell', { spell_id: 'teleport', targets: ['a1', 'a8'] });
    expect(lastError('white')).toBe('invalid_target');
  });

  it('Greed: due carte solo a chi lancia', () => {
    const { send, toMain1, conns } = setup({ startingMaxMana: 10, deckTop: { white: ['greed'] } });
    toMain1('white');
    conns.white.clear();
    conns.black.clear();
    send('white', 'cast_spell', { spell_id: 'greed', targets: [] });
    expect(conns.white.ofType('card_drawn')).toHaveLength(2);
    expect(conns.black.ofType('card_drawn')).toHaveLength(0);
    expect(conns.black.last('hand_size_changed')?.payload).toEqual({ player: 'mario', size: 6, deck_size: 33 });
  });
});

describe('patta, resa, riconnessione, tempo', () => {
  it('offerta di patta solo dal giocatore attivo; accettazione → agreement', () => {
    const { send, lastError, conns } = setup();
    send('black', 'draw_offer');
    expect(lastError('black')).toBe('not_your_turn');
    send('black', 'draw_accepted');
    expect(lastError('black')).toBe('no_draw_offer');
    send('white', 'draw_offer');
    expect(conns.black.last('draw_offer')?.payload).toEqual({ from: 'mario' });
    send('black', 'draw_accepted');
    expect(conns.white.last('game_over')?.payload).toEqual({ result: '1/2-1/2', reason: 'agreement', winner: null });
  });

  it('resa in qualunque momento', () => {
    const { send, conns, room } = setup();
    send('black', 'resign');
    expect(conns.white.last('game_over')?.payload).toEqual({ result: '1-0', reason: 'resign', winner: 'mario' });
    send('white', 'pass_phase');
    expect(conns.white.last('error')?.payload.code).toBe('no_active_game');
    expect(room.isOver).toBe(true);
  });

  it('matto scacchistico immediato', () => {
    const { playTurn, send, conns } = setup();
    playTurn('white', 'f2f3');
    playTurn('black', 'e7e5');
    playTurn('white', 'g2g4');
    send('black', 'pass_phase');
    send('black', 'pass_phase');
    send('black', 'move', { move: 'd8h4' });
    expect(conns.white.last('game_over')?.payload).toEqual({ result: '0-1', reason: 'checkmate', winner: 'luigi' });
  });

  it('G5: disconnessione, snapshot al rientro; abbandono se non torna', () => {
    vi.useFakeTimers();
    const { room, conns } = setup({ reconnectTimeoutMs: 1000 });
    room.disconnect('black', conns.black);
    expect(conns.white.last('opponent_disconnected')).toBeDefined();
    const back = new FakeConn();
    vi.advanceTimersByTime(500);
    room.reconnect('black', back);
    expect(back.last('game_start')?.payload.hand).toHaveLength(4);
    vi.advanceTimersByTime(2000);
    expect(room.isOver).toBe(false);

    room.disconnect('black', back);
    vi.advanceTimersByTime(1000);
    expect(conns.white.last('game_over')?.payload).toEqual({ result: '1-0', reason: 'abandonment', winner: 'mario' });
  });

  it('timeout: finisce il tempo del giocatore attivo', () => {
    vi.useFakeTimers();
    let now = 0;
    const { conns } = setup({ clockMs: 3000, tickMs: 1000, now: () => now });
    for (let i = 0; i < 4; i++) {
      now += 1000;
      vi.advanceTimersByTime(1000);
    }
    expect(conns.black.ofType('timer_update')[0]?.payload).toEqual({ white_time: 2000, black_time: 3000, turn: 'white' });
    expect(conns.black.last('game_over')?.payload).toEqual({ result: '0-1', reason: 'timeout', winner: 'luigi' });
  });
});

describe('contratto minimale', () => {
  it('niente estensioni assunte sul filo', () => {
    const { conns, send } = setup({ variant: 'minimal' });
    expect(Object.keys(conns.white.last('game_start')?.payload ?? {}).sort()).toEqual(['black', 'fen', 'room_id', 'white']);
    expect(conns.white.last('game_state')?.payload.pieces).toBeUndefined();
    const drawn = conns.white.ofType('card_drawn');
    expect(drawn).toHaveLength(5);
    expect(drawn.every((m) => m.payload.spell_id === undefined)).toBe(true);
    send('black', 'pass_phase');
    expect(conns.black.last('error')?.payload).toEqual({ message: 'Non è il tuo turno' });
  });
});

describe('PieceRegistry', () => {
  function play(fen: string, moves: string[]) {
    const chess = new Chess(fen);
    const registry = PieceRegistry.fromChess(chess, createRng(1));
    const ids = new Map(registry.toWire().map((p) => [p.square, p.piece_id]));
    for (const m of moves) registry.applyMove(chess.move(m));
    return { registry, ids };
  }

  it('arrocco sposta anche la torre', () => {
    const { registry, ids } = play('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', ['e1g1', 'e8c8']);
    expect(registry.at('g1')?.id).toBe(ids.get('e1'));
    expect(registry.at('f1')?.id).toBe(ids.get('h1'));
    expect(registry.at('c8')?.id).toBe(ids.get('e8'));
    expect(registry.at('d8')?.id).toBe(ids.get('a8'));
  });

  it('en passant rimuove il pedone catturato', () => {
    const ep = play('4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1', ['d7d5', 'e5d6']);
    expect(ep.registry.at('d5')).toBeUndefined();
    expect(ep.registry.at('d6')?.id).toBe(ep.ids.get('e5'));
  });

  it('la promozione conserva l’id e cambia il tipo', () => {
    const { registry, ids } = play('4k3/P7/8/8/8/8/8/4K3 w - - 0 1', ['a7a8q']);
    expect(registry.at('a8')).toMatchObject({ id: ids.get('a7'), type: 'q' });
  });
});
