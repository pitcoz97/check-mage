import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRng } from '../util';
import type { WireServerMessage, WireServerType } from '../wire';
import type { MatchOverrides } from './match';
import { CLOSE_REPLACED, Room, type GameClient } from './room';

/**
 * Porting dei casi di `game/room_test.go`, `game/lifecycle_test.go` e `game/reconnect_test.go`
 * (branch `fix/backend-requests`), più i flussi del mock.
 */

class FakeClient implements GameClient {
  readonly messages: WireServerMessage[] = [];
  readonly closes: { code: number; reason: string }[] = [];
  constructor(
    readonly userId: number,
    readonly username: string,
  ) {}
  send(message: WireServerMessage): void {
    this.messages.push(message);
  }
  close(code: number, reason: string): void {
    this.closes.push({ code, reason });
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

/** Mani e pesche da 4 mana: nei primi turni ogni fase main si salta da sola. */
const EXPENSIVE = ['shatter', 'shatter', 'shatter', 'shatter'];
const NOTHING_CASTABLE: MatchOverrides = { hand: { white: EXPENSIVE, black: EXPENSIVE }, deckTop: { white: EXPENSIVE, black: EXPENSIVE } };

function setup(opts: { overrides?: MatchOverrides; fen?: string; baseTimeMs?: number } = {}) {
  const white = new FakeClient(1, 'mario');
  const black = new FakeClient(2, 'luigi');
  const ended: string[] = [];
  const room = new Room({
    id: 'room-1-2',
    white,
    black,
    rng: createRng(7),
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
  const lastCode = (c: FakeClient) => c.last('error')?.['code'];
  return { room, white, black, send, lastError, lastCode, ended };
}

/** Tipi ricevuti a partire dall'ultimo `game_state`: serve a verificare che lo stato preceda `game_over`. */
function tailFromLastState(c: FakeClient): WireServerType[] {
  const types = c.types();
  return types.slice(types.lastIndexOf('game_state'));
}

describe('avvio (room.go:76-121)', () => {
  it('game_state (draw) con giocatori e time control → hand privata → phase_changed dell’auto-avanzamento', () => {
    const { white, black } = setup();
    expect(white.types()).toEqual(['game_state', 'hand', 'phase_changed', 'phase_changed']);
    expect(white.messages[0]?.payload).toMatchObject({
      phase: 'draw',
      active_player: 'white',
      turn_number: 1,
      white_hand_size: 4,
      white_player: { id: 1, username: 'mario' },
      black_player: { id: 2, username: 'luigi' },
      time_control: { base_ms: 600_000, increment_ms: 5_000 },
    });
    expect(white.all('phase_changed').map((p) => p['phase'])).toEqual(['main1', 'move']);
    expect(white.last('hand')).toEqual({ hand: ['shatter', 'shatter', 'shatter', 'shatter'], mana: 1, max_mana: 1, deck_size: 36 });
    expect(black.types()).toEqual(['game_state', 'hand', 'phase_changed', 'phase_changed']);
  });

  it('con una carta castabile si ferma in main1', () => {
    const { white } = setup({ overrides: { hand: { white: ['frost'] } } });
    expect(white.all('phase_changed').map((p) => p['phase'])).toEqual(['main1']);
  });
});

describe('mosse (room.go:423-570)', () => {
  it('rifiuti con codice e dettagli: turno, legalità, payload, pezzo congelato, fase', () => {
    const { room, white, black, send } = setup();
    send(black, 'move', { move: 'e7e5' });
    expect(black.last('error')).toEqual({ message: 'Non è il tuo turno', code: 'not_your_turn' });
    send(white, 'move', { move: 'e2e5' });
    expect(white.last('error')).toEqual({ message: 'Mossa illegale: e2e5', code: 'illegal_move', details: { move: 'e2e5' } });
    send(white, 'move');
    expect(white.last('error')).toEqual({ message: 'Formato mossa non valido', code: 'invalid_payload' });
    room.tracker.freeze('e2', 'black', 2, 'frost');
    send(white, 'move', { move: 'e2e4' });
    expect(white.last('error')).toEqual({ message: 'Il pezzo in e2 è congelato', code: 'piece_frozen', details: { square: 'e2' } });
    send(white, 'pass_phase');
    expect(white.last('error')).toEqual({ message: 'Non puoi passare nella fase move', code: 'wrong_phase', details: { phase: 'move' } });
    send(white, 'chat');
    expect(white.last('error')).toEqual({ message: 'Tipo messaggio sconosciuto: chat', code: 'unknown_message_type', details: { type: 'chat' } });
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

  it('scudo che assorbe la cattura: nessun pezzo si muove, mossa registrata come 0000, il turno passa', () => {
    const fen = '4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1';
    const { room, white, black, send } = setup({ fen });
    room.tracker.shield('d5', 'black', 2, 'shield');
    black.clear();
    send(white, 'move', { move: 'e4d5' });
    expect(black.types().slice(0, 2)).toEqual(['effect_expired', 'game_state']);
    expect(black.messages[0]?.payload).toEqual({ square: 'd5', effect_kind: 'shield', reason: 'shield_absorbed' });
    expect(black.last('game_state')).toMatchObject({
      board: { fen: '4k3/8/8/3p4/4P3/8/8/4K3 b - - 1 1', moves: ['0000'], turn: 'black' },
      active_effects: [],
    });
    expect(room.pgn()).toBe('1. --');
  });

  it('scudo ed en passant (B11): assorbe la cattura, effect_expired sulla casella del pedone', () => {
    const fen = '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1';
    const { room, white, black, send } = setup({ fen });
    room.tracker.shield('d5', 'black', 2, 'shield');
    black.clear();
    send(white, 'move', { move: 'e5d6' });
    expect(black.messages[0]?.payload).toEqual({ square: 'd5', effect_kind: 'shield', reason: 'shield_absorbed' });
    expect(black.last('game_state')).toMatchObject({ board: { fen: '4k3/8/8/3pP3/8/8/8/4K3 b - - 1 1', moves: ['0000'] } });
  });

  it('scudo rotto: se la cattura è l’unico modo di uscire dallo scacco avviene, senza effect_expired', () => {
    // Il re bianco in a1 è sotto scacco dalla torre in a8; l'unica difesa è Th8xa8.
    const fen = 'r6R/8/6k1/8/8/8/1P6/KR6 w - - 0 1';
    const { room, white, black, send } = setup({ fen });
    room.tracker.shield('a8', 'black', 2, 'shield');
    black.clear();
    send(white, 'move', { move: 'h8a8' });
    expect(black.types()).not.toContain('effect_expired');
    expect(black.last('game_state')).toMatchObject({ board: { moves: ['h8a8'] }, active_effects: [] });
    expect(room.tracker.hasShield('a8')).toBe(false);
  });

  it('effetti scaduti alla fine del turno dell’avversario di chi lancia, con piece_id', () => {
    const { room, white, black, send } = setup();
    room.tracker.freeze('e7', 'white', 1, 'frost');
    send(white, 'move', { move: 'e2e4' });
    black.clear();
    send(black, 'move', { move: 'd7d5' });
    expect(black.last('effect_expired')).toEqual({ square: 'e7', effect_kind: 'freeze', piece_id: expect.any(Number) });
  });

  it('matto: game_state con status finale prima di game_over', () => {
    const { white, black, send, ended } = setup();
    send(white, 'move', { move: 'f2f3' });
    send(black, 'move', { move: 'e7e5' });
    send(white, 'move', { move: 'g2g4' });
    send(black, 'move', { move: 'd8h4' });
    expect(tailFromLastState(white)).toEqual(['game_state', 'game_over']);
    expect(white.last('game_state')).toMatchObject({ board: { status: 'checkmate', moves: ['f2f3', 'e7e5', 'g2g4', 'd8h4'] } });
    expect(white.last('game_over')).toEqual({ result: '0-1', reason: 'checkmate', winner: 'luigi' });
    vi.runOnlyPendingTimers();
    expect(ended).toEqual(['0-1 checkmate']);
  });
});

describe('magie (room.go: handleCastSpell, applySpellEffects)', () => {
  const FILLER = ['shatter', 'shatter'];

  it('ordine dei broadcast: spell_cast, mana, mano, poi lo stato se la scacchiera cambia; Patto di sangue', () => {
    const { white, black, send } = setup({ overrides: { hand: { white: ['blood_pact', 'frost', ...FILLER] } } });
    black.clear();
    white.clear();
    send(white, 'cast_spell', { spell_id: 'blood_pact', targets: ['a2'] });
    expect(black.types()).toEqual(['spell_cast', 'mana_changed', 'hand_size_changed', 'game_state']);
    expect(black.messages[0]?.payload).toEqual({
      player: 'white',
      spell_id: 'blood_pact',
      targets: ['a2'],
      effects_applied: [
        { kind: 'destroy_piece', target: 'a2', piece_destroyed: 'pawn' },
        { kind: 'gain_mana', amount: 2, mana: 3 },
      ],
    });
    expect(black.last('mana_changed')).toEqual({ player: 'white', current: 3, max: 1 });
    expect(black.last('game_state')).toMatchObject({ board: { fen: 'rnbqkbnr/pppppppp/8/8/8/8/1PPPPPPP/RNBQKBNR w KQkq - 0 1' } });
  });

  it('dopo l’ultimo cast possibile la fase avanza da sola', () => {
    const { white, send } = setup({ overrides: { hand: { white: ['frost', 'shatter', ...FILLER] } } });
    white.clear();
    send(white, 'cast_spell', { spell_id: 'frost', targets: ['e7'] });
    expect(white.all('phase_changed').map((p) => p['phase'])).toEqual(['move']);
  });

  it('rifiuti dei bersagli a costo zero, con indice, motivo e casella', () => {
    const { white, send, lastCode, room } = setup({
      overrides: { hand: { white: ['shatter', 'frost', 'shield', 'blink'] }, manaFloor: { white: 10 } },
    });
    send(white, 'cast_spell', { spell_id: 'shatter', targets: ['e7'] });
    expect(white.last('error')).toEqual({
      message: "il pezzo in e7 non ha l'effetto freeze",
      code: 'invalid_target',
      details: { index: 0, reason: 'missing_effect', square: 'e7' },
    });
    send(white, 'cast_spell', { spell_id: 'frost', targets: ['e2'] });
    expect(white.last('error')).toMatchObject({ code: 'invalid_target', details: { reason: 'wrong_owner' } });
    send(white, 'cast_spell', { spell_id: 'shield', targets: ['e4'] });
    expect(white.last('error')).toMatchObject({ code: 'invalid_target', details: { reason: 'no_piece' } });
    send(white, 'cast_spell', { spell_id: 'shield', targets: ['e8'] });
    expect(white.last('error')).toMatchObject({ code: 'invalid_target', details: { reason: 'wrong_owner' } });
    send(white, 'cast_spell', { spell_id: 'blink', targets: ['b1', 'd2'] });
    expect(white.last('error')).toMatchObject({ code: 'invalid_target', details: { index: 1, reason: 'not_empty', square: 'd2' } });
    send(white, 'cast_spell', { spell_id: 'blink', targets: ['b1', 'b4'] });
    expect(white.last('error')).toMatchObject({ code: 'invalid_target', details: { index: 1, reason: 'too_far' } });
    send(white, 'cast_spell', { spell_id: 'blink', targets: ['b1'] });
    expect(white.last('error')).toMatchObject({ code: 'invalid_target_count', details: { expected: 2, received: 1 } });
    send(white, 'cast_spell', { spell_id: 'blink', targets: 'b1' });
    expect(lastCode(white)).toBe('invalid_payload');
    send(white, 'cast_spell', { spell_id: 'royal_shield', targets: ['d1'] });
    expect(white.last('error')).toMatchObject({ code: 'card_not_in_hand', details: { spell_id: 'royal_shield' } });
    expect(room.match.white.mana).toBe(10);
  });

  it('Patto di sangue una volta per turno (limit_reached)', () => {
    const { white, send, room } = setup({ overrides: { hand: { white: ['blood_pact', 'blood_pact', ...FILLER] }, manaFloor: { white: 10 } } });
    send(white, 'cast_spell', { spell_id: 'blood_pact', targets: ['a2'] });
    send(white, 'cast_spell', { spell_id: 'blood_pact', targets: ['b2'] });
    expect(white.last('error')).toEqual({
      message: 'Patto di sangue si può lanciare al massimo 1 volte per turno',
      code: 'limit_reached',
      details: { spell_id: 'blood_pact', per_turn: 1 },
    });
    expect(room.match.white.mana).toBe(10);
  });

  it('Brina → Frantumare cambia la FEN; il proprio re sotto scacco resta un vincolo', () => {
    const { white, send } = setup({
      fen: '4k3/4p3/8/8/8/8/P7/4K3 w - - 0 1',
      overrides: { hand: { white: ['frost', 'shatter', ...FILLER] }, manaFloor: { white: 10 } },
    });
    send(white, 'cast_spell', { spell_id: 'frost', targets: ['e7'] });
    send(white, 'cast_spell', { spell_id: 'shatter', targets: ['e7'] });
    expect(white.last('spell_cast')?.['effects_applied']).toEqual([{ kind: 'destroy_piece', target: 'e7', piece_destroyed: 'pawn' }]);
    expect(white.last('game_state')).toMatchObject({ board: { fen: '4k3/8/8/8/8/8/P7/4K3 w - - 0 1' } });

    const inCheck = setup({
      fen: '4k3/8/8/8/8/8/4B3/4K2q w - - 0 1',
      overrides: { hand: { white: ['blink', ...FILLER, 'shatter'] }, manaFloor: { white: 10 } },
    });
    // Il re bianco è sotto scacco dalla donna in h1: spostare l'alfiere in c4 non para lo scacco.
    inCheck.send(inCheck.white, 'cast_spell', { spell_id: 'blink', targets: ['e2', 'c4'] });
    expect(inCheck.white.last('error')).toEqual({
      message: 'il re white resterebbe sotto scacco',
      code: 'illegal_position',
      details: { king: 'white' },
    });
  });

  it('niente scacco da magia, in main1 come in main2', () => {
    const { room, white, send } = setup({
      fen: 'k7/8/8/8/2N5/8/P7/4K3 w - - 0 1',
      overrides: { hand: { white: ['blink', 'blink', ...FILLER] }, manaFloor: { white: 10 } },
    });
    const givesCheck = { message: 'una magia non può dare scacco al re black', code: 'illegal_position', details: { king: 'black' } };
    send(white, 'cast_spell', { spell_id: 'blink', targets: ['c4', 'b6'] }); // il cavallo in b6 attaccherebbe a8
    expect(white.last('error')).toEqual(givesCheck);
    send(white, 'cast_spell', { spell_id: 'blink', targets: ['c4', 'd6'] }); // nessuno scacco: accettata
    expect(white.last('spell_cast')).toMatchObject({ spell_id: 'blink' });
    send(white, 'pass_phase');
    send(white, 'move', { move: 'e1e2' });
    expect(room.match.currentPhase).toBe('main2');
    white.clear();
    send(white, 'cast_spell', { spell_id: 'blink', targets: ['d6', 'b6'] });
    expect(white.last('error')).toEqual(givesCheck);
    expect(room.board.fen).toBe('k7/8/3N4/8/8/8/P3K3/8 b - - 1 1');
  });

  it('Marcia forzata e Leva militare: movimento relativo, tetto dei pedoni, pedone evocato con id nuovo', () => {
    const { room, white, send } = setup({
      overrides: { hand: { white: ['forced_march', 'conscription', ...FILLER] }, manaFloor: { white: 10 } },
    });
    send(white, 'cast_spell', { spell_id: 'forced_march', targets: ['e2'] });
    expect(white.last('spell_cast')?.['effects_applied']).toEqual([{ kind: 'move_piece', from: 'e2', to: 'e3' }]);
    send(white, 'cast_spell', { spell_id: 'conscription', targets: ['e2'] });
    expect(white.last('error')).toMatchObject({ code: 'invalid_target', details: { reason: 'max_pawns', square: 'e2' } });

    const empty = setup({
      fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
      overrides: { hand: { white: ['conscription', ...FILLER, 'shatter'] }, manaFloor: { white: 10 } },
    });
    empty.send(empty.white, 'cast_spell', { spell_id: 'conscription', targets: ['b2'] });
    expect(empty.white.last('spell_cast')?.['effects_applied']).toEqual([{ kind: 'summon_pawn', target: 'b2', piece: 'pawn' }]);
    expect(empty.room.board.fen).toBe('4k3/8/8/8/8/8/1P6/4K3 w - - 0 1');
    expect(empty.room.tracker.idAt('b2')).toBe(3);
    expect(room.board.fen).toBe('rnbqkbnr/pppppppp/8/8/8/4P3/PPPP1PPP/RNBQKBNR w KQkq - 0 1');
  });

  it('senza mosse giocabili per il gelo è stallo (M6)', () => {
    const { white, send } = setup({
      fen: 'k7/7p/1Q6/8/8/8/8/4K3 w - - 0 1',
      overrides: { hand: { white: ['frost', ...FILLER, 'shatter'] } },
    });
    send(white, 'cast_spell', { spell_id: 'frost', targets: ['h7'] }); // l'unico pezzo nero che può muovere
    send(white, 'move', { move: 'e1e2' });
    expect(white.last('game_over')).toMatchObject({ result: '1/2-1/2', reason: 'stalemate' });
    expect(white.last('game_state')).toMatchObject({ board: { status: 'stalemate' } });
  });
});

describe('patta (room.go:1413-1501)', () => {
  it('offerta, doppia offerta, risposta propria, rifiuto con reason, accettazione', () => {
    const { white, black, send, lastError } = setup();
    send(black, 'draw_offer'); // nessun controllo di turno
    expect(black.last('draw_offer_sent')).toEqual({ message: 'Offerta di patta inviata' });
    expect(white.last('draw_offer')).toEqual({ from: 'luigi' });
    send(white, 'draw_offer');
    expect(lastError(white)).toBe("C'è già un'offerta di patta in corso");
    send(black, 'draw_accepted');
    expect(lastError(black)).toBe('Non puoi rispondere alla tua stessa offerta');
    send(white, 'draw_declined');
    expect(black.last('draw_declined')).toEqual({ message: 'mario ha rifiutato la patta', reason: 'declined' });
    send(white, 'draw_accepted');
    expect(lastError(white)).toBe('Nessuna offerta di patta in corso');
    send(white, 'draw_offer');
    send(black, 'draw_accepted');
    expect(tailFromLastState(white)).toEqual(['game_state', 'game_over']);
    expect(white.last('game_state')).toMatchObject({ board: { status: 'draw' } });
    expect(white.last('game_over')).toEqual({ result: '1/2-1/2', reason: 'agreement' });
  });

  it('l’offerta decade quando chi l’ha ricevuta muove (draw_declined move_played prima del game_state)', () => {
    const { white, black, send } = setup();
    send(black, 'draw_offer');
    black.clear();
    send(white, 'move', { move: 'e2e4' });
    expect(black.types().slice(0, 2)).toEqual(['draw_declined', 'game_state']);
    expect(black.last('draw_declined')).toEqual({ message: 'mario ha giocato una mossa: offerta di patta decaduta', reason: 'move_played' });
    expect(white.all('draw_declined')).toEqual([]);
    send(white, 'draw_offer'); // l'offerta precedente non è più pendente
    expect(white.last('draw_offer_sent')).toBeDefined();
  });

  it('la propria mossa non fa decadere la propria offerta', () => {
    const { white, black, send } = setup();
    send(white, 'draw_offer');
    send(white, 'move', { move: 'e2e4' });
    expect(white.all('draw_declined')).toEqual([]);
    send(black, 'draw_accepted');
    expect(white.last('game_over')).toMatchObject({ reason: 'agreement' });
  });
});

describe('connessioni e fine partita', () => {
  it('Leave → opponent_disconnected; Reconnect → game_state{reconnected} + hand + opponent_reconnected', () => {
    const { room, white, black } = setup();
    room.leave(black);
    expect(white.last('opponent_disconnected')).toBeDefined();
    const back = new FakeClient(2, 'luigi');
    room.reconnect(back);
    expect(back.types()).toEqual(['game_state', 'hand']);
    expect(back.messages[0]?.payload).toMatchObject({ reconnected: true, black_player: { id: 2, username: 'luigi' } });
    expect(white.last('opponent_reconnected')).toEqual({ message: 'luigi si è riconnesso!' });
    vi.advanceTimersByTime(31_000);
    expect(white.all('game_over')).toEqual([]);
  });

  it('abbandono dopo il timeout di riconnessione, con status abandoned', () => {
    const { room, white, black } = setup();
    room.leave(black);
    vi.advanceTimersByTime(30_000);
    expect(tailFromLastState(white)).toEqual(['game_state', 'game_over']);
    expect(white.last('game_state')).toMatchObject({ board: { status: 'abandoned' } });
    expect(white.last('game_over')).toEqual({ result: '1-0', reason: 'abandonment', winner: 'mario' });
    expect(room.isActive()).toBe(false);
  });

  it('orologio del giocatore attivo, timer_update ogni secondo, timeout con status timeout', () => {
    const { white } = setup({ baseTimeMs: 2_000 });
    vi.advanceTimersByTime(1_000);
    // Come in Go, l'ordine tra il ticker da 100 ms e quello da 1 s nello stesso istante non è garantito.
    const update = white.last('timer_update');
    expect(update).toMatchObject({ black_time: 2_000, turn: 'white' });
    expect([1_000, 1_100]).toContain(update?.['white_time']);
    vi.advanceTimersByTime(1_000);
    expect(white.types().slice(-3)).toEqual(['timer_update', 'game_state', 'game_over']);
    expect(white.last('game_state')).toMatchObject({ white_time: 0, board: { status: 'timeout' } });
    expect(white.last('game_over')).toEqual({ result: '0-1', reason: 'timeout', winner: 'luigi' });
  });

  it('B1: la partita si chiude una volta sola (resa, poi disconnessione)', () => {
    const { room, white, black, send, ended } = setup();
    send(white, 'resign');
    expect(tailFromLastState(black)).toEqual(['game_state', 'game_over']);
    expect(black.last('game_state')).toMatchObject({ board: { status: 'resigned' } });
    room.leave(white);
    vi.advanceTimersByTime(30_000);
    expect(black.all('game_over')).toEqual([{ result: '0-1', reason: 'resign', winner: 'luigi' }]);
    expect(ended).toEqual(['0-1 resign']);
  });

  it('B2: una connessione sostituita viene chiusa con 4001 e la sua chiusura non conta come abbandono', () => {
    const { room, white, black } = setup();
    const newBlack = new FakeClient(2, 'luigi');
    room.reconnect(newBlack);
    expect(black.last('error')).toEqual({
      message: "La partita è stata ripresa da un'altra connessione",
      code: 'replaced_by_new_connection',
    });
    expect(black.closes).toEqual([{ code: CLOSE_REPLACED, reason: 'replaced_by_new_connection' }]);
    room.leave(black); // chiusura tardiva della connessione precedente
    expect(white.all('opponent_disconnected')).toEqual([]);
    vi.advanceTimersByTime(30_000);
    expect(newBlack.all('game_over')).toEqual([]);
    expect(room.isActive()).toBe(true);
  });

  it('B4: dopo la fine ogni azione riceve error game_over', () => {
    const { white, black, send } = setup();
    send(white, 'resign');
    for (const [type, payload] of [
      ['move', { move: 'e2e4' }],
      ['pass_phase', undefined],
      ['cast_spell', { spell_id: 'frost', targets: ['e7'] }],
      ['resign', undefined],
      ['draw_offer', undefined],
      ['draw_accepted', undefined],
    ] as const) {
      white.clear();
      send(white, type, payload);
      expect(white.messages).toEqual([{ type: 'error', payload: { message: 'La partita è terminata', code: 'game_over' } }]);
    }
    expect(black.last('game_state')).toMatchObject({ board: { moves: [] } });
  });

  it('PGN numerato in UCI e time control "minuti+secondi"', () => {
    const { room, white, black, send } = setup();
    send(white, 'move', { move: 'e2e4' });
    send(black, 'move', { move: 'e7e5' });
    send(white, 'move', { move: 'g1f3' });
    expect(room.pgn()).toBe('1. e2e4 e7e5 2. g1f3');
    expect(room.timeControl()).toBe('10+5');
  });
});
