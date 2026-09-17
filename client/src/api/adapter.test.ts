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
  normalizeGameHistory,
  normalizeLeaderboard,
  normalizeLogin,
  normalizePublicProfile,
  normalizeRegistration,
  normalizeSpellCatalog,
  normalizeStatus,
  normalizeTokenPair,
  type AdapterWarningCode,
} from './adapter';

/**
 * Payload costruiti come li serializza chess-server (`internal/`, commit 7f817e5).
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

/** `game/room.go:1101-1119`, così come lo produce `publicState()`. */
function publicState(overrides: Record<string, unknown> = {}) {
  return {
    board: { fen: START_FEN, moves: [], turn: 'white', status: 'active' },
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
  it('stato pubblico completo, senza identità dei giocatori (contratto current)', () => {
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
    expect(codes).toEqual(['players_missing']);
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
        reconnected: false,
        players: null,
      },
    });
  });

  it('P0-5 (contratto proposed): identità dei giocatori; riconnessione', () => {
    const { event, codes } = decodeOk(
      frame(
        'game_state',
        publicState({
          reconnected: true,
          white_player: { id: 42, username: 'mario' },
          black_player: { id: 7, username: 'luigi' },
        }),
      ),
    );
    expect(codes).toEqual([]);
    expect(event.type === 'game_state' && event.state.players).toEqual({
      white: { id: '42', username: 'mario' },
      black: { id: '7', username: 'luigi' },
    });
    expect(event.type === 'game_state' && event.state.reconnected).toBe(true);
  });

  it('status terminali, moves null, effetti malformati scartati uno per uno', () => {
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
    expect(event.state.status).toBe('checkmate');
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
    for (const type of ['draw_offer_sent', 'draw_declined', 'opponent_disconnected', 'opponent_reconnected'] as const) {
      const { event } = decodeOk(frame(type, { message: 'mario si è riconnesso!' }));
      expect(event).toEqual({ type });
    }
    expect(decodeOk(frame('draw_offer', { from: 'mario' })).event).toEqual({ type: 'draw_offer', from: 'mario' });
  });
});

describe('error: testi del server → codici (§3b)', () => {
  const samples: [string, string][] = [
    ['Non è il tuo turno', 'not_your_turn'],
    ['non è il tuo turno', 'not_your_turn'],
    ['Non puoi muovere nella fase main1', 'wrong_phase'],
    ['Non puoi passare nella fase move', 'wrong_phase'],
    ['non puoi castare magie nella fase move', 'wrong_phase'],
    ['Frost Bolt non è giocabile nella fase move', 'wrong_phase'],
    ['Mossa illegale: e2e5', 'illegal_move'],
    ['mossa illegale: lascerebbe il re sotto scacco', 'exposes_own_king'],
    ['Il pezzo in e2 è congelato', 'piece_frozen'],
    ['Formato mossa non valido', 'malformed_message'],
    ['Formato cast_spell non valido', 'malformed_message'],
    ['Formato messaggio non valido', 'malformed_message'],
    ['Tipo messaggio sconosciuto: chat', 'unknown_message_type'],
    ['Stai inviando messaggi troppo velocemente', 'rate_limited'],
    ["C'è già un'offerta di patta in corso", 'draw_offer_pending'],
    ['Nessuna offerta di patta in corso', 'no_draw_offer'],
    ['Non puoi rispondere alla tua stessa offerta', 'own_draw_offer'],
    ['Sei già in coda', 'already_queued'],
    ['magia sconosciuta: fireball', 'unknown_spell'],
    ['carta non in mano', 'card_not_in_hand'],
    ['mana insufficiente: servono 4, hai 1', 'insufficient_mana'],
    ['la magia Teleport richiede 2 bersagli, ricevuti 1', 'wrong_target_count'],
    ['la magia Aegis richiede un bersaglio', 'wrong_target_count'],
    ['la magia Teleport richiede casella di partenza e arrivo', 'wrong_target_count'],
    ['nessun pezzo da distruggere in e5', 'no_piece_on_target'],
    ['nessun pezzo da congelare in e5', 'no_piece_on_target'],
    ['nessun pezzo da proteggere in e5', 'no_piece_on_target'],
    ['nessun pezzo da spostare in e5', 'no_piece_on_target'],
    ['nessun pezzo in e5', 'no_piece_on_target'],
    ['non puoi distruggere un tuo pezzo (e2)', 'target_must_be_enemy'],
    ['non puoi congelare un tuo pezzo (e2)', 'target_must_be_enemy'],
    ['puoi proteggere solo i tuoi pezzi (e7)', 'target_must_be_own'],
    ['puoi spostare solo i tuoi pezzi (e7)', 'target_must_be_own'],
    ['il re non può essere distrutto', 'king_not_targetable'],
    ['la casella e4 non è vuota', 'destination_occupied'],
    ['casella non valida: "e"', 'invalid_square'],
    ['casella fuori scacchiera: "z9"', 'invalid_square'],
    ['effetto non supportato: summon', 'unsupported_effect'],
  ];

  it.each(samples)('%s → %s', (message, code) => {
    const { event, codes } = decodeOk(frame('error', { message }));
    expect(event).toMatchObject({ type: 'error', error: { code } });
    expect(codes).toEqual([]);
    expect(JSON.stringify(event)).not.toContain(message);
  });

  it('estrae dettagli numerici e casella', () => {
    expect(decodeOk(frame('error', { message: 'mana insufficiente: servono 4, hai 1' })).event).toEqual({
      type: 'error',
      error: { code: 'insufficient_mana', square: null, needed: 4, available: 1 },
    });
    expect(decodeOk(frame('error', { message: 'Il pezzo in g7 è congelato' })).event).toMatchObject({
      error: { code: 'piece_frozen', square: 'g7' },
    });
  });

  it('testo sconosciuto o payload inatteso → code null + warning, mai un fallimento', () => {
    for (const payload of [{ message: 'Qualcosa di nuovo' }, 'stringa nuda', null, 42]) {
      const { event, codes } = decodeOk(frame('error', payload));
      expect(event).toEqual({ type: 'error', error: { code: null, square: null, needed: null, available: null } });
      expect(codes).toEqual(['error_text_unknown']);
    }
  });

  it('P1-3 (contratto proposed): un code esplicito prevale sul testo', () => {
    expect(decodeOk(frame('error', { message: 'x', code: 'card_not_in_hand' })).event).toMatchObject({
      error: { code: 'card_not_in_hand' },
    });
  });
});

describe('encoder', () => {
  it('mossa, azioni senza payload, cast per spell_id', () => {
    expect(JSON.parse(encodeClientIntent({ type: 'move', move: 'e7e8q' }))).toEqual({ type: 'move', payload: { move: 'e7e8q' } });
    expect(JSON.parse(encodeClientIntent({ type: 'pass_phase' }))).toEqual({ type: 'pass_phase', payload: {} });
    expect(
      JSON.parse(
        encodeClientIntent({ type: 'cast_spell', card: { instanceId: 'local-9', spellId: 'teleport' }, targets: ['b1', 'c3'] }),
      ),
    ).toEqual({ type: 'cast_spell', payload: { spell_id: 'teleport', targets: ['b1', 'c3'] } });
  });

  it('connection.ts: token come query param', () => {
    expect(buildSocketUrl('ws://localhost:8080/ws', 'a.b.c')).toBe('ws://localhost:8080/ws?token=a.b.c');
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
    [429, 'Troppe richieste, rallenta!', 'rate_limited'],
    [500, 'Errore DB', 'internal_error'],
  ])('%i %s → %s', (status, text, code) => {
    expect(interpretHttpResponse(status, ko(text))).toEqual({ ok: false, error: { status, code }, warnings: [] });
  });

  it('404 in testo semplice, 503 senza testo, testo sconosciuto', () => {
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
  it('fallback.json: le 11 magie di spells/spells.go, tutte valide', () => {
    const { spells, warnings } = normalizeSpellCatalog(fallbackCatalog);
    expect(warnings).toEqual([]);
    expect(spells).toHaveLength(11);
    expect(spells.find((s) => s.id === 'teleport')).toEqual({
      id: 'teleport',
      name: 'Teleport',
      manaCost: 3,
      phases: ['main1', 'main2'],
      targetType: 'piece_move',
      effects: [{ kind: 'move_piece', params: {} }],
    });
  });

  it('voci invalide scartate una per una; forma inattesa', () => {
    const { spells, warnings } = normalizeSpellCatalog({
      spells: [{ id: 'x', name: 'X', mana_cost: 1, phases: ['main1'], target_type: 'hex', effects: [] }, { name: 'no id' }],
    });
    expect(spells.map((s) => s.id)).toEqual(['x']);
    expect(warnings.map((w) => w.code)).toEqual(['catalog_entry_invalid']);
    expect(normalizeSpellCatalog('nope').warnings.map((w) => w.code)).toEqual(['catalog_shape_unexpected']);
  });
});
