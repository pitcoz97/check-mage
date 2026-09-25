import { describe, expect, it } from 'vitest';

import fallbackCatalog from '../spells/fallback.json';
import { buildSocketUrl } from '../ws/connection';
import type { DecodeResult, ServerEvent } from '../ws/protocol';
import {
  decodeServerMessage,
  encodeClientIntent,
  encodeLogin,
  encodeRefresh,
  encodeRegister,
  interpretHttpResponse,
  normalizeAccount,
  FALLBACK_CREDENTIAL_POLICY,
  normalizeGameHistory,
  normalizeLeaderboard,
  normalizeLogin,
  normalizePasswordPolicy,
  normalizePublicProfile,
  normalizeRegistration,
  normalizeSpellCatalog,
  normalizeStatus,
  normalizeTokenPair,
  normalizeWsTicket,
  type AdapterWarningCode,
} from './adapter';

/**
 * Payload costruiti come li serializza chess-server (`internal/`, branch `fix/backend-requests`).
 */

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function frame(type: unknown, payload?: unknown): string {
  return JSON.stringify(payload === undefined ? { type } : { type, payload });
}

function decodeOk(raw: string): { event: ServerEvent; codes: AdapterWarningCode[] } {
  let n = 0;
  const result = decodeServerMessage(raw, { newLocalId: () => `local-${++n}` });
  if (!result.ok) throw new Error(`decodifica fallita: ${JSON.stringify(result.failure)}`);
  return { event: result.event, codes: result.warnings.map((w) => w.code) };
}

function failureKind(result: DecodeResult): string | null {
  return result.ok ? null : result.failure.kind;
}

/** `game/room.go:1360-1386`, così come lo produce `publicState()`. */
function publicState(overrides: Record<string, unknown> = {}) {
  return {
    board: { fen: START_FEN, moves: [], turn: 'white', status: 'active' },
    white_player: { id: 42, username: 'mario' },
    black_player: { id: 7, username: 'luigi' },
    time_control: { base_ms: 600000, increment_ms: 5000 },
    white_time: 600000,
    black_time: 600000,
    phase: 'draw',
    active_player: 'white',
    turn_number: 1,
    white_mana: 1,
    white_max_mana: 1,
    black_mana: 1,
    black_max_mana: 1,
    white_hand_size: 4,
    black_hand_size: 4,
    white_deck_size: 36,
    black_deck_size: 36,
    active_effects: [],
    ...overrides,
  };
}

describe('busta WebSocket', () => {
  it('JSON invalido, busta invalida, type sconosciuto', () => {
    expect(failureKind(decodeServerMessage('{not json'))).toBe('invalid_json');
    for (const raw of ['null', '[]', '42', frame(123, {}), '{"payload":{}}']) {
      expect(failureKind(decodeServerMessage(raw))).toBe('not_an_envelope');
    }
    expect(decodeServerMessage(frame('game_start', {}))).toEqual({
      ok: false,
      failure: { kind: 'unknown_type', type: 'game_start' },
    });
  });

  it('non lancia mai eccezioni', () => {
    const corpus = ['', ' ', '{}', frame('game_state', 'x'), frame('hand', { hand: 7 }), frame('spell_cast', [])];
    for (const raw of corpus) expect(() => decodeServerMessage(raw)).not.toThrow();
  });
});

describe('game_state', () => {
  it('stato pubblico completo, con giocatori e time control', () => {
    const { event, codes } = decodeOk(
      frame(
        'game_state',
        publicState({
          phase: 'main1',
          active_effects: [
            { square: 'e7', effects: [{ kind: 'freeze', remaining_turns: 2, source_spell_id: 'frostbolt' }] },
          ],
        }),
      ),
    );
    expect(codes).toEqual([]);
    expect(event).toEqual({
      type: 'game_state',
      state: {
        fen: START_FEN,
        moves: [],
        turn: 'white',
        status: 'active',
        clocks: { white: 600000, black: 600000 },
        phase: 'main1',
        activePlayer: 'white',
        turnNumber: 1,
        mana: { white: { current: 1, max: 1 }, black: { current: 1, max: 1 } },
        handSizes: { white: 4, black: 4 },
        deckSizes: { white: 36, black: 36 },
        activeEffects: [{ square: 'e7', effects: [{ kind: 'freeze', remainingTurns: 2, sourceSpellId: 'frostbolt' }] }],
        graveyards: { white: [], black: [] },
        squareStates: [],
        reconnected: false,
        players: { white: { id: '42', username: 'mario' }, black: { id: '7', username: 'luigi' } },
        timeControl: { baseMs: 600000, incrementMs: 5000 },
      },
    });
  });

  it('riconnessione; giocatori o time control mancanti → null + warning, il colore non si deduce (C1)', () => {
    expect(decodeOk(frame('game_state', publicState({ reconnected: true }))).event).toMatchObject({ state: { reconnected: true } });
    const { white_player: _w, black_player: _b, time_control: _t, ...legacy } = publicState();
    const { event, codes } = decodeOk(frame('game_state', legacy));
    expect(event).toMatchObject({ state: { players: null, timeControl: null } });
    expect(codes).toEqual(['players_missing']);
    const bad = decodeOk(frame('game_state', publicState({ time_control: { base_ms: '10' } })));
    expect(bad.event).toMatchObject({ state: { timeControl: null } });
    expect(bad.codes).toEqual(['value_invalid']);
  });

  it('mosse: 0000 è la mossa assorbita da uno scudo (game/room.go:37,488)', () => {
    const { event } = decodeOk(
      frame('game_state', publicState({ board: { fen: START_FEN, moves: ['e2e4', '0000', 'e7e8q'], turn: 'white', status: 'active' } })),
    );
    expect(event).toMatchObject({
      state: { moves: [{ kind: 'move', uci: 'e2e4' }, { kind: 'absorbed' }, { kind: 'move', uci: 'e7e8q' }] },
    });
  });

  it.each(['checkmate', 'stalemate', 'draw', 'resigned', 'timeout', 'abandoned'])('status terminale %s', (status) => {
    const { event, codes } = decodeOk(frame('game_state', publicState({ board: { fen: START_FEN, moves: [], turn: 'white', status } })));
    expect(event).toMatchObject({ state: { status } });
    expect(codes).toEqual([]);
  });

  it('moves null, effetti malformati scartati uno per uno', () => {
    const { event, codes } = decodeOk(
      frame(
        'game_state',
        publicState({
          board: { fen: START_FEN, moves: null, turn: 'black', status: 'checkmate' },
          active_effects: [{ square: 'z9', effects: [] }, { square: 'd4', effects: [{ kind: 'shield', remaining_turns: 1 }] }],
        }),
      ),
    );
    if (event.type !== 'game_state') throw new Error('tipo inatteso');
    expect(event.state.moves).toEqual([]);
    expect(event.state.activeEffects).toEqual([
      { square: 'd4', effects: [{ kind: 'shield', remainingTurns: 1, sourceSpellId: null }] },
    ]);
    expect(codes).toContain('active_effect_malformed');
  });

  it('manca un campo del nucleo → malformed_payload', () => {
    const { white_mana: _omit, ...partial } = publicState();
    expect(failureKind(decodeServerMessage(frame('game_state', partial)))).toBe('malformed_payload');
  });
});

describe('mano e risorse', () => {
  it('hand: spell id → carte con id locali distinti', () => {
    const { event } = decodeOk(frame('hand', { hand: ['spark', 'spark', 'aegis'], mana: 1, max_mana: 1, deck_size: 36 }));
    expect(event).toEqual({
      type: 'hand',
      hand: {
        cards: [
          { instanceId: 'local-1', spellId: 'spark' },
          { instanceId: 'local-2', spellId: 'spark' },
          { instanceId: 'local-3', spellId: 'aegis' },
        ],
        mana: { current: 1, max: 1 },
        deckSize: 36,
      },
    });
  });

  it('card_drawn, hand_size_changed, mana_changed con player come colore', () => {
    expect(decodeOk(frame('card_drawn', { card_id: 'jolt', deck_size: 35 })).event).toEqual({
      type: 'card_drawn',
      card: { instanceId: 'local-1', spellId: 'jolt' },
      deckSize: 35,
    });
    expect(decodeOk(frame('hand_size_changed', { player: 'black', size: 5 })).event).toEqual({
      type: 'hand_size_changed',
      player: 'black',
      size: 5,
    });
    expect(decodeOk(frame('mana_changed', { player: 'white', current: 3, max: 1 })).event).toEqual({
      type: 'mana_changed',
      player: 'white',
      mana: { current: 3, max: 1 },
    });
    expect(failureKind(decodeServerMessage(frame('mana_changed', { player: 'mario', current: 1, max: 1 })))).toBe(
      'malformed_payload',
    );
  });

  it('phase_changed può valere draw; fase sconosciuta → unknown', () => {
    expect(decodeOk(frame('phase_changed', { phase: 'draw', active_player: 'black', turn_number: 2 })).event).toEqual({
      type: 'phase_changed',
      phase: 'draw',
      activePlayer: 'black',
      turnNumber: 2,
    });
    const { event, codes } = decodeOk(frame('phase_changed', { phase: 'upkeep', active_player: 'white', turn_number: 3 }));
    expect(event).toMatchObject({ phase: 'unknown' });
    expect(codes).toEqual(['enum_unknown']);
  });
});

describe('magie ed effetti', () => {
  it('spell_cast: campi per kind come in game/room.go:583-661', () => {
    const effects = [
      { kind: 'noop' },
      { kind: 'destroy_piece', target: 'e7', piece_destroyed: 'pawn' },
      { kind: 'freeze_piece', target: 'd7', remaining_turns: 2 },
      { kind: 'shield_piece', target: 'd2', remaining_turns: 2 },
      { kind: 'draw_card', count: 1 },
      { kind: 'gain_mana', amount: 2, mana: 3 },
      { kind: 'move_piece', from: 'b1', to: 'c3' },
    ];
    const { event, codes } = decodeOk(frame('spell_cast', { player: 'white', spell_id: 'x', targets: ['b1', 'c3'], effects_applied: effects }));
    expect(codes).toEqual([]);
    expect(event).toEqual({
      type: 'spell_cast',
      player: 'white',
      spellId: 'x',
      targets: ['b1', 'c3'],
      effects: [
        { kind: 'noop' },
        { kind: 'destroy_piece', target: 'e7', destroyedPiece: 'pawn' },
        { kind: 'freeze_piece', target: 'd7', remainingTurns: 2 },
        { kind: 'shield_piece', target: 'd2', remainingTurns: 2 },
        { kind: 'draw_card', count: 1 },
        { kind: 'gain_mana', amount: 2, manaAfter: 3 },
        { kind: 'move_piece', from: 'b1', to: 'c3' },
      ],
    });
  });

  it('effetti sconosciuti o malformati degradano a unknown senza bloccare il resto', () => {
    const { event, codes } = decodeOk(
      frame('spell_cast', {
        player: 'black',
        spell_id: 'nova',
        targets: null,
        effects_applied: [{ kind: 'summon_dragon' }, { kind: 'move_piece', from: 'b1' }, { kind: 'noop' }],
      }),
    );
    expect(event).toMatchObject({
      targets: [],
      effects: [{ kind: 'unknown', rawKind: 'summon_dragon' }, { kind: 'unknown', rawKind: 'move_piece' }, { kind: 'noop' }],
    });
    expect(codes.filter((c) => c === 'effect_unknown')).toHaveLength(2);
  });

  it('effetti dello Step 2: di massa con targets, scambio, trasformazioni e ritorni con il pezzo', () => {
    const { event, codes } = decodeOk(
      frame('spell_cast', {
        player: 'white',
        spell_id: 'x',
        targets: [],
        effects_applied: [
          { kind: 'freeze_all', targets: ['a7', 'b7'], remaining_turns: 1 },
          { kind: 'shield_area', targets: ['d2'], remaining_turns: 1 },
          { kind: 'swap_pieces', targets: ['b1', 'c1'] },
          { kind: 'transform_piece', target: 'c1', piece: 'bishop' },
          { kind: 'promote_piece', target: 'e7', piece: 'queen' },
          { kind: 'revive_piece', target: 'b1', piece: 'rook' },
          { kind: 'restore_castling_rights' },
        ],
      }),
    );
    expect(codes).toEqual([]);
    expect(event.type === 'spell_cast' && event.effects).toEqual([
      { kind: 'freeze_all', targets: ['a7', 'b7'], remainingTurns: 1 },
      { kind: 'shield_area', targets: ['d2'], remainingTurns: 1 },
      { kind: 'swap_pieces', targets: ['b1', 'c1'] },
      { kind: 'transform_piece', target: 'c1', piece: 'bishop' },
      { kind: 'promote_piece', target: 'e7', piece: 'queen' },
      { kind: 'revive_piece', target: 'b1', piece: 'rook' },
      { kind: 'restore_castling_rights' },
    ]);
  });

  it('cimitero: nel game_state (assente = vuoto) e in graveyard_changed; tipi sconosciuti scartati', () => {
    const withGraves = decodeOk(frame('game_state', publicState({ white_graveyard: ['pawn', 'knight'], black_graveyard: [] }))).event;
    expect(withGraves.type === 'game_state' && withGraves.state.graveyards).toEqual({ white: ['pawn', 'knight'], black: [] });
    const legacy = decodeOk(frame('game_state', publicState())).event;
    expect(legacy.type === 'game_state' && legacy.state.graveyards).toEqual({ white: [], black: [] });
    const changed = decodeOk(frame('graveyard_changed', { player: 'black', graveyard: ['rook', 'dragon'] }));
    expect(changed.event).toEqual({ type: 'graveyard_changed', player: 'black', graveyard: ['rook'] });
    expect(changed.codes.length).toBe(1);
  });

  it('stati delle case: nel game_state (assente = nessuno), in square_effects_changed e nei nuovi effetti', () => {
    const wall = { square: 'e5', effects: [{ kind: 'wall', remaining_turns: 2, source_spell_id: 'ice_wall', caster: 'white' }] };
    const withWall = decodeOk(frame('game_state', publicState({ square_effects: [wall] }))).event;
    expect(withWall.type === 'game_state' && withWall.state.squareStates).toEqual([
      { square: 'e5', effects: [{ kind: 'wall', remainingTurns: 2, sourceSpellId: 'ice_wall' }] },
    ]);
    const legacy = decodeOk(frame('game_state', publicState())).event;
    expect(legacy.type === 'game_state' && legacy.state.squareStates).toEqual([]);
    expect(decodeOk(frame('square_effects_changed', { square_effects: [] })).event).toEqual({ type: 'square_effects_changed', squareStates: [] });
    const { event, codes } = decodeOk(
      frame('spell_cast', {
        player: 'white',
        spell_id: 'x',
        targets: [],
        effects_applied: [
          { kind: 'create_wall', target: 'e5', remaining_turns: 2 },
          { kind: 'create_square_effect', target: 'd4', effect: 'no_capture', remaining_turns: 3 },
        ],
      }),
    );
    expect(codes).toEqual([]);
    expect(event.type === 'spell_cast' && event.effects).toEqual([
      { kind: 'create_wall', target: 'e5', state: 'wall', remainingTurns: 2 },
      { kind: 'create_square_effect', target: 'd4', state: 'no_capture', remainingTurns: 3 },
    ]);
  });

  it('effect_expired: scadenza con piece_id numerico e scudo assorbito', () => {
    expect(decodeOk(frame('effect_expired', { square: 'e7', effect_kind: 'freeze', piece_id: 12 })).event).toEqual({
      type: 'effect_expired',
      expired: { square: 'e7', kind: 'freeze', pieceId: '12', reason: 'expired' },
    });
    expect(
      decodeOk(frame('effect_expired', { square: 'd5', effect_kind: 'shield', reason: 'shield_absorbed' })).event,
    ).toEqual({ type: 'effect_expired', expired: { square: 'd5', kind: 'shield', pieceId: null, reason: 'shield_absorbed' } });
  });
});

describe('orologio, fine partita, patta, connessione', () => {
  it('timer_update: turn è il giocatore attivo', () => {
    expect(decodeOk(frame('timer_update', { white_time: 598000, black_time: -1, turn: 'white' })).event).toEqual({
      type: 'timer_update',
      clocks: { white: 598000, black: 0 },
      turn: 'white',
    });
  });

  it('game_over: winner assente in caso di patta', () => {
    expect(decodeOk(frame('game_over', { result: '1/2-1/2', reason: 'agreement' })).event).toEqual({
      type: 'game_over',
      result: '1/2-1/2',
      reason: 'agreement',
      winner: null,
    });
    expect(decodeOk(frame('game_over', { result: '0-1', reason: 'checkmate', winner: 'luigi' })).event).toMatchObject({
      winner: 'luigi',
    });
  });

  it('i messaggi solo testuali scartano il testo del server', () => {
    for (const type of ['draw_offer_sent', 'opponent_disconnected', 'opponent_reconnected'] as const) {
      const { event } = decodeOk(frame(type, { message: 'mario si è riconnesso!' }));
      expect(event).toEqual({ type });
    }
    expect(decodeOk(frame('draw_offer', { from: 'mario' })).event).toEqual({ type: 'draw_offer', from: 'mario' });
  });

  it('draw_declined: rifiutata o decaduta per mossa; il testo resta fuori', () => {
    expect(decodeOk(frame('draw_declined', { message: 'luigi ha rifiutato la patta', reason: 'declined' })).event).toEqual({
      type: 'draw_declined',
      reason: 'declined',
    });
    expect(decodeOk(frame('draw_declined', { message: 'x', reason: 'move_played' })).event).toEqual({
      type: 'draw_declined',
      reason: 'move_played',
    });
    expect(decodeOk(frame('draw_declined', { message: 'x' })).event).toEqual({ type: 'draw_declined', reason: 'declined' });
    const unknown = decodeOk(frame('draw_declined', { reason: 'timeout' }));
    expect(unknown.event).toEqual({ type: 'draw_declined', reason: 'unknown' });
    expect(unknown.codes).toEqual(['enum_unknown']);
  });
});

describe('error: codici e dettagli (§3b, gameerr/gameerr.go)', () => {
  const none = { square: null, phase: null, needed: null, available: null, expected: null, received: null, king: null, index: null, reason: null, perTurn: null };

  it('il codice arriva così com’è, il testo resta fuori', () => {
    const { event, codes } = decodeOk(frame('error', { message: 'Non è il tuo turno', code: 'not_your_turn' }));
    expect(event).toEqual({ type: 'error', error: { ...none, code: 'not_your_turn' } });
    expect(codes).toEqual([]);
    expect(JSON.stringify(event)).not.toContain('turno');
  });

  it('dettagli usati dalla UI', () => {
    const decode = (code: string, details: Record<string, unknown>) =>
      decodeOk(frame('error', { message: 'x', code, details })).event;
    expect(decode('insufficient_mana', { needed: 4, available: 1 })).toEqual({
      type: 'error',
      error: { ...none, code: 'insufficient_mana', needed: 4, available: 1 },
    });
    expect(decode('piece_frozen', { square: 'g7' })).toMatchObject({ error: { code: 'piece_frozen', square: 'g7' } });
    expect(decode('wrong_phase', { phase: 'move' })).toMatchObject({ error: { phase: 'move' } });
    expect(decode('invalid_target_count', { expected: 2, received: 1 })).toMatchObject({ error: { expected: 2, received: 1 } });
    expect(decode('illegal_position', { king: 'black' })).toMatchObject({ error: { code: 'illegal_position', king: 'black' } });
    expect(decode('move_blocked', { square: 'e3', reason: 'wall' })).toMatchObject({ error: { code: 'move_blocked', square: 'e3', reason: 'wall' } });
    // Dettagli di forma inattesa vengono ignorati, non fanno fallire l'evento.
    expect(decode('wrong_phase', { phase: 'lunch', square: 'z9', needed: '4' })).toEqual({
      type: 'error',
      error: { ...none, code: 'wrong_phase' },
    });
  });

  it('codice sconosciuto o mancante → code null + warning, mai un fallimento', () => {
    const unknown = decodeOk(frame('error', { message: 'x', code: 'dragon_asleep' }));
    expect(unknown.event).toEqual({ type: 'error', error: { ...none, code: null } });
    expect(unknown.codes).toEqual(['error_code_unknown']);
    for (const payload of [{ message: 'Un errore mai visto prima' }, 'stringa nuda', null, 42]) {
      const { event, codes } = decodeOk(frame('error', payload));
      expect(event).toEqual({ type: 'error', error: { ...none, code: null } });
      expect(codes).toEqual(['error_code_missing']);
    }
  });
});

describe('encoder', () => {
  it('mossa, azioni senza payload, cast per spell_id', () => {
    expect(JSON.parse(encodeClientIntent({ type: 'move', move: 'e7e8q' }))).toEqual({ type: 'move', payload: { move: 'e7e8q' } });
    expect(JSON.parse(encodeClientIntent({ type: 'pass_phase' }))).toEqual({ type: 'pass_phase', payload: {} });
    expect(
      JSON.parse(
        encodeClientIntent({ type: 'cast_spell', card: { instanceId: 'local-9', spellId: 'blink' }, targets: ['b1', 'c3'], choice: null }),
      ),
    ).toEqual({ type: 'cast_spell', payload: { spell_id: 'blink', targets: ['b1', 'c3'] } });
    // La scelta del pezzo viaggia solo quando c'è.
    expect(
      JSON.parse(
        encodeClientIntent({ type: 'cast_spell', card: { instanceId: 'local-3', spellId: 'resurrection' }, targets: ['b1'], choice: 'rook' }),
      ),
    ).toEqual({ type: 'cast_spell', payload: { spell_id: 'resurrection', targets: ['b1'], choice: { piece: 'rook' } } });
  });

  it('connection.ts: ticket monouso come query param', () => {
    expect(buildSocketUrl('ws://localhost:8080/ws', 'ab12')).toBe('ws://localhost:8080/ws?ticket=ab12');
  });
});

describe('REST', () => {
  const ok = (data: unknown) => JSON.stringify({ success: true, data });
  const ko = (error: string) => JSON.stringify({ success: false, error });

  it('inviluppo di successo', () => {
    expect(interpretHttpResponse(200, ok({ user_id: 42 }))).toEqual({ ok: true, data: { user_id: 42 }, warnings: [] });
  });

  it.each([
    [400, 'password deve contenere almeno una lettera maiuscola', 'password_needs_uppercase'],
    [400, 'username può contenere solo lettere, numeri e underscore', 'username_invalid_chars'],
    [400, 'email non valida', 'email_invalid'],
    [409, 'Username o email già in uso', 'username_or_email_taken'],
    [401, 'Credenziali non valide', 'invalid_credentials'],
    [401, 'Token non valido o scaduto', 'token_invalid_or_expired'],
    [401, 'Token non valido', 'token_invalid'],
    [401, 'Token mancante', 'token_missing'],
    [401, 'Refresh token non valido o scaduto', 'refresh_token_invalid'],
    [401, 'Ticket non valido o scaduto', 'ticket_invalid'],
    [404, 'Risorsa non trovata', 'not_found'],
    [405, 'Metodo non consentito', 'method_not_allowed'],
    [500, 'Errore generazione ticket', 'internal_error'],
    [429, 'Troppe richieste, rallenta!', 'rate_limited'],
    [500, 'Errore DB', 'internal_error'],
  ])('%i %s → %s', (status, text, code) => {
    expect(interpretHttpResponse(status, ko(text))).toEqual({ ok: false, error: { status, code }, warnings: [] });
  });

  it('404 in testo semplice (tollerato), 503 senza testo, testo sconosciuto', () => {
    expect(interpretHttpResponse(404, '404 page not found\n')).toMatchObject({ ok: false, error: { status: 404, code: 'not_found' } });
    expect(
      interpretHttpResponse(503, JSON.stringify({ success: false, data: { status: 'unavailable', version: '0.1.0' } })),
    ).toMatchObject({ ok: false, error: { status: 503, code: 'service_unavailable' } });
    const unknown = interpretHttpResponse(400, ko('Nuovo errore'));
    expect(unknown).toMatchObject({ ok: false, error: { status: 400, code: null } });
    expect(unknown.warnings.map((w) => w.code)).toEqual(['http_error_text_unknown']);
  });

  it('normalizzatori sui payload del server', () => {
    expect(normalizeRegistration({ user_id: 42 })).toEqual({ ok: true, value: { userId: '42' }, warnings: [] });
    expect(
      normalizeLogin({
        tokens: { access_token: 'a', refresh_token: 'r' },
        user: { id: 42, username: 'mario', email: 'mario@test.it', elo: 1200 },
      }),
    ).toEqual({
      ok: true,
      value: {
        tokens: { accessToken: 'a', refreshToken: 'r' },
        user: { id: '42', username: 'mario', email: 'mario@test.it', elo: 1200, createdAt: null },
      },
      warnings: [],
    });
    expect(normalizeTokenPair({ access_token: 'a2', refresh_token: 'r2' })).toMatchObject({
      value: { accessToken: 'a2', refreshToken: 'r2' },
    });
    expect(
      normalizeAccount({ id: 42, username: 'mario', email: 'mario@test.it', elo: 1210, created_at: '2026-06-30T10:00:00Z' }),
    ).toMatchObject({ value: { createdAt: '2026-06-30T10:00:00Z', elo: 1210 } });
    expect(
      normalizePublicProfile({
        user: { id: 42, username: 'mario', elo: 1200, created_at: 'x' },
        stats: { wins: 10, losses: 5, draws: 2, total: 17 },
      }),
    ).toMatchObject({ ok: true, value: { stats: { total: 17 } } });
    expect(normalizeLeaderboard(null)).toEqual({ ok: true, value: [], warnings: [] });
    expect(normalizeLeaderboard([{ rank: 1, id: 3, username: 'alice', elo: 1640 }])).toMatchObject({
      value: [{ rank: 1, id: '3', username: 'alice', elo: 1640 }],
    });
    expect(normalizeGameHistory(null)).toEqual({ ok: true, value: [], warnings: [] });
    expect(
      normalizeGameHistory([
        { id: 101, white: 'mario', black: 'alice', result: '1-0', time_control: '10+0', pgn: '1. e2e4', played_at: 't' },
      ]),
    ).toMatchObject({ value: [{ id: '101', result: '1-0', timeControl: '10+0' }] });
    expect(normalizeStatus(200, ok({ status: 'ok', version: '0.1.0' }))).toEqual({ healthy: true, version: '0.1.0' });
    expect(normalizeStatus(503, JSON.stringify({ success: false, data: { status: 'unavailable', version: '0.1.0' } }))).toEqual({
      healthy: false,
      version: '0.1.0',
    });
  });

  it('ticket WebSocket', () => {
    expect(normalizeWsTicket({ ticket: 'ab12', expires_in: 30 })).toEqual({
      ok: true,
      value: { ticket: 'ab12', expiresInSeconds: 30 },
      warnings: [],
    });
    expect(normalizeWsTicket({ ticket: '' })).toMatchObject({ ok: false });
  });

  it('password policy (C9): valori del server, regex RE2 non compilabile → riserva + warning', () => {
    const wire = {
      username: { min_length: 4, max_length: 16, pattern: '^[a-z]+$' },
      password: { min_length: 10, max_length: 64, require_uppercase: false, require_lowercase: true, require_digit: true },
    };
    const result = normalizePasswordPolicy(wire);
    if (!result.ok) throw new Error('policy rifiutata');
    expect(result.warnings).toEqual([]);
    expect(result.value.username).toMatchObject({ minLength: 4, maxLength: 16 });
    expect(result.value.username.pattern.test('mario')).toBe(true);
    expect(result.value.username.pattern.test('Mario')).toBe(false);
    expect(result.value.password).toEqual({ minBytes: 10, maxBytes: 64, requireUppercase: false, requireLowercase: true, requireDigit: true });
    expect(result.value.email).toBe(FALLBACK_CREDENTIAL_POLICY.email);

    const re2 = normalizePasswordPolicy({ ...wire, username: { ...wire.username, pattern: '(?P<nome>[a-z]+)' } });
    expect(re2.ok && re2.value.username.pattern).toBe(FALLBACK_CREDENTIAL_POLICY.username.pattern);
    expect(re2.ok && re2.warnings.map((w) => w.code)).toEqual(['password_policy_invalid']);
    expect(normalizePasswordPolicy({ username: {} })).toMatchObject({ ok: false });
  });

  it('encoder dei body', () => {
    expect(JSON.parse(encodeRegister('mario', 'mario@test.it', 'Password1'))).toEqual({
      username: 'mario',
      email: 'mario@test.it',
      password: 'Password1',
    });
    expect(JSON.parse(encodeLogin('mario@test.it', 'Password1'))).toEqual({ email: 'mario@test.it', password: 'Password1' });
    expect(JSON.parse(encodeRefresh('r'))).toEqual({ refresh_token: 'r' });
  });
});

describe('catalogo', () => {
  it('fallback.json: le 20 magie degli step 1–3 (spells/catalog.go), tutte valide', () => {
    const { spells, warnings } = normalizeSpellCatalog(fallbackCatalog);
    expect(warnings).toEqual([]);
    expect(spells).toHaveLength(20);
    expect(spells.find((s) => s.id === 'blink')).toEqual({
      id: 'blink',
      name: 'Blink',
      manaCost: 4,
      phases: ['main1', 'main2'],
      targets: [
        { type: 'own_piece', pieces: ['knight', 'bishop'], requireEffect: null, emptySquare: false, maxDistance: 0, ownRanks: [], minRank: 0 },
        { type: 'square', pieces: [], requireEffect: null, emptySquare: true, maxDistance: 2, ownRanks: [], minRank: 0 },
      ],
      effects: [{ kind: 'move_piece', params: { no_check: true } }],
      tags: ['arcano'],
      rarity: 'common',
      perTurn: null,
    });
    expect(spells.find((s) => s.id === 'blood_pact')?.perTurn).toBe(1);
  });

  it('voci invalide scartate una per una; forma inattesa', () => {
    const { spells, warnings } = normalizeSpellCatalog({
      spells: [{ id: 'x', name: 'X', mana_cost: 1, phases: ['main1'], targets: [{ type: 'hex' }], effects: [], tags: null, rarity: 'mythic' }, { name: 'no id' }],
    });
    expect(spells.map((s) => s.id)).toEqual(['x']);
    expect(warnings.map((w) => w.code)).toEqual(['catalog_entry_invalid']);
    expect(normalizeSpellCatalog('nope').warnings.map((w) => w.code)).toEqual(['catalog_shape_unexpected']);
  });
});
