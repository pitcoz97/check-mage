import { describe, expect, it } from 'vitest';

import fallbackCatalog from '../spells/fallback.json';
import type { DecodeResult, ServerEvent } from '../ws/protocol';
import {
  decodeServerMessage,
  encodeClientIntent,
  normalizeHttpError,
  normalizeLoginResponse,
  normalizeSpellCatalog,
  normalizeUserProfile,
  normalizeWsTicket,
  type AdapterWarningCode,
} from './adapter';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function frame(type: unknown, payload?: unknown): string {
  return JSON.stringify(payload === undefined ? { type } : { type, payload });
}

function decodeOk(raw: string): { event: ServerEvent; codes: AdapterWarningCode[] } {
  const result = decodeServerMessage(raw, { newLocalId: () => 'local-1' });
  if (!result.ok) throw new Error(`decodifica fallita: ${JSON.stringify(result.failure)}`);
  return { event: result.event, codes: result.warnings.map((w) => w.code) };
}

function failureKind(result: DecodeResult): string | null {
  return result.ok ? null : result.failure.kind;
}

describe('decodeServerMessage — busta', () => {
  it('JSON invalido', () => {
    expect(failureKind(decodeServerMessage('{not json'))).toBe('invalid_json');
  });

  it.each([['null'], ['[]'], ['42'], ['"game_start"'], [frame(123, {})], ['{"payload":{}}']])(
    'busta non valida: %s',
    (raw) => {
      expect(failureKind(decodeServerMessage(raw))).toBe('not_an_envelope');
    },
  );

  it('type sconosciuto', () => {
    const result = decodeServerMessage(frame('future_feature', { x: 1 }));
    expect(result).toEqual({ ok: false, failure: { kind: 'unknown_type', type: 'future_feature' } });
  });

  it('payload malformato per un type noto', () => {
    const result = decodeServerMessage(frame('draw_offer', null));
    expect(failureKind(result)).toBe('malformed_payload');
  });

  it('non lancia mai eccezioni', () => {
    const corpus = ['', ' ', '{}', frame('game_start', 'x'), frame('game_state', { board: 7 }), frame('spell_cast', [])];
    for (const raw of corpus) expect(() => decodeServerMessage(raw)).not.toThrow();
  });
});

describe('messaggi base (§3.2)', () => {
  it('game_state documentato + pieces (G1)', () => {
    const { event, codes } = decodeOk(
      frame('game_state', {
        board: { fen: START_FEN, moves: ['e2e4'], turn: 'black', status: 'active' },
        white_time: 598000,
        black_time: 600000,
        pieces: [{ piece_id: 'pc_1', square: 'e4', type: 'P', color: 'white', effects: [{ kind: 'freeze', remaining_turns: 2 }] }],
      }),
    );
    expect(codes).toEqual([]);
    expect(event).toEqual({
      type: 'game_state',
      fen: START_FEN,
      moves: ['e2e4'],
      turn: 'black',
      status: 'active',
      clocks: { white: 598000, black: 600000 },
      pieces: [{ pieceId: 'pc_1', square: 'e4', kind: 'pawn', color: 'white', effects: [{ kind: 'freeze', remainingTurns: 2 }] }],
    });
  });

  it('G1: pieces assente → null + warning, nessuna ricostruzione', () => {
    const { event, codes } = decodeOk(
      frame('game_state', { board: { fen: START_FEN, moves: [], turn: 'white', status: 'active' }, white_time: 1, black_time: 1 }),
    );
    expect(event.type === 'game_state' && event.pieces).toBeNull();
    expect(codes).toContain('pieces_missing');
  });

  it('G1: una lista di pezzi parzialmente malformata viene scartata tutta', () => {
    const { event, codes } = decodeOk(
      frame('game_state', {
        board: { fen: START_FEN, moves: [], turn: 'white', status: 'active' },
        white_time: 1,
        black_time: 1,
        pieces: [{ piece_id: 'pc_1', square: 'e4', type: 'p', color: 'white' }, { piece_id: 'pc_2', square: 'z9', type: 'p', color: 'white' }],
      }),
    );
    expect(event.type === 'game_state' && event.pieces).toBeNull();
    expect(codes).toContain('pieces_malformed');
  });

  it('A15: enum sconosciuti e tempi negativi', () => {
    const { event, codes } = decodeOk(frame('timer_update', { white_time: -5, black_time: 1000, turn: 'purple' }));
    expect(event).toEqual({ type: 'timer_update', clocks: { white: 0, black: 1000 }, turn: 'unknown' });
    expect(codes).toEqual(expect.arrayContaining(['number_out_of_range', 'enum_unknown']));
  });

  it('game_over: reason sconosciuta e patta senza vincitore', () => {
    const { event } = decodeOk(frame('game_over', { result: '1/2-1/2', reason: 'cosmic_ray', winner: '' }));
    expect(event).toEqual({ type: 'game_over', result: '1/2-1/2', reason: 'unknown', winner: null });
  });

  it('opponent_disconnected scarta il testo del server', () => {
    const { event } = decodeOk(frame('opponent_disconnected', { message: "L'avversario si è disconnesso" }));
    expect(event).toEqual({ type: 'opponent_disconnected' });
  });

  it.each([[{ code: 'illegal_move', message: 'mossa illegale' }], ['stringa nuda'], [null], [42], [undefined]])(
    'G6: error non fallisce mai (%j)',
    (payload) => {
      const { event } = decodeOk(frame('error', payload));
      expect(event.type).toBe('error');
      expect(JSON.stringify(event)).not.toContain('mossa illegale');
    },
  );

  it('G6: codice estratto quando presente', () => {
    expect(decodeOk(frame('error', { code: 'illegal_move' })).event).toEqual({ type: 'error', error: { code: 'illegal_move' } });
    expect(decodeOk(frame('error', 'boom')).codes).toContain('error_unstructured');
  });
});

describe('game_start (G4, G5)', () => {
  const core = { room_id: 'room-1-2', white: 'mario', black: 'luigi', fen: START_FEN };

  it('snapshot completo', () => {
    const { event, codes } = decodeOk(
      frame('game_start', {
        ...core,
        moves: [],
        white_time: 600000,
        black_time: 600000,
        time_control: { initial_ms: 600000, increment_ms: 0 },
        pieces: [{ piece_id: 'pc_1', square: 'e1', type: 'k', color: 'white', effects: [] }],
        phase: 'draw',
        active_player: 'mario',
        turn_number: 1,
        hand: [{ card_id: 'c_1', spell_id: 'shield' }],
        hand_sizes: { mario: 4, luigi: 4 },
        deck_sizes: { mario: 36, luigi: 36 },
        mana: { mario: { current: 1, max: 1 }, luigi: { current: 1, max: 1 } },
      }),
    );
    expect(codes).toEqual([]);
    if (event.type !== 'game_start') throw new Error('tipo inatteso');
    expect(event.snapshot).toMatchObject({
      roomId: 'room-1-2',
      players: { white: 'mario', black: 'luigi' },
      clocks: { white: 600000, black: 600000 },
      timeControl: { initialMs: 600000, incrementMs: 0 },
      phase: 'draw',
      activePlayer: 'mario',
      turnNumber: 1,
      hand: [{ instanceId: 'c_1', spellId: 'shield', instanceIdIsLocal: false }],
      deckSizes: { mario: 36, luigi: 36 },
    });
  });

  it('solo il contratto documentato → campi magie null + snapshot_incomplete', () => {
    const { event, codes } = decodeOk(frame('game_start', core));
    if (event.type !== 'game_start') throw new Error('tipo inatteso');
    expect(event.snapshot).toMatchObject({ hand: null, mana: null, phase: null, pieces: null, clocks: null });
    expect(codes).toEqual(expect.arrayContaining(['snapshot_incomplete', 'pieces_missing']));
  });

  it('manca un campo identitario → malformed_payload', () => {
    const result = decodeServerMessage(frame('game_start', { ...core, fen: undefined }));
    expect(failureKind(result)).toBe('malformed_payload');
  });
});

describe('layer magie (§3.3)', () => {
  it('G2: card_drawn con spell_id', () => {
    const { event, codes } = decodeOk(frame('card_drawn', { card_id: 'c_9', spell_id: 'greed' }));
    expect(event).toEqual({ type: 'card_drawn', card: { instanceId: 'c_9', spellId: 'greed', instanceIdIsLocal: false } });
    expect(codes).toEqual([]);
  });

  it('G2: card_drawn senza spell_id → card_id come spell_id, id locale', () => {
    const { event, codes } = decodeOk(frame('card_drawn', { card_id: 'greed' }));
    expect(event).toEqual({ type: 'card_drawn', card: { instanceId: 'local-1', spellId: 'greed', instanceIdIsLocal: true } });
    expect(codes).toEqual(['card_spell_id_missing']);
  });

  it('A14: hand_size_changed con e senza deck_size', () => {
    expect(decodeOk(frame('hand_size_changed', { player: 'luigi', size: 5, deck_size: 30 })).event).toEqual({
      type: 'hand_size_changed',
      player: 'luigi',
      size: 5,
      deckSize: 30,
    });
    const without = decodeOk(frame('hand_size_changed', { player: 'luigi', size: 5 }));
    expect(without.event).toMatchObject({ deckSize: null });
    expect(without.codes).toEqual(['deck_size_missing']);
  });

  it('phase_changed con fase sconosciuta', () => {
    const { event, codes } = decodeOk(frame('phase_changed', { phase: 'upkeep', active_player: 'mario', turn_number: 7 }));
    expect(event).toEqual({ type: 'phase_changed', phase: 'unknown', activePlayer: 'mario', turnNumber: 7 });
    expect(codes).toEqual(['enum_unknown']);
  });

  it('mana_changed', () => {
    expect(decodeOk(frame('mana_changed', { player: 'mario', current: 4, max: 5 })).event).toEqual({
      type: 'mana_changed',
      player: 'mario',
      mana: { current: 4, max: 5 },
    });
  });

  it('G8: spell_cast scarta solo gli effetti malformati e conserva i kind sconosciuti', () => {
    const { event, codes } = decodeOk(
      frame('spell_cast', {
        player: 'mario',
        spell_id: 'ice_age',
        targets: ['d7', 'nope'],
        effects_applied: [
          { kind: 'freeze_piece', piece_id: 'pc_20', params: { turns: 2 } },
          { piece_id: 'pc_20' },
          { kind: 'summon_dragon', square: 'e5' },
        ],
      }),
    );
    expect(event).toEqual({
      type: 'spell_cast',
      player: 'mario',
      spellId: 'ice_age',
      targets: ['d7'],
      effects: [
        { kind: 'freeze_piece', pieceId: 'pc_20', square: null, params: { turns: 2 } },
        { kind: 'summon_dragon', pieceId: null, square: 'e5', params: {} },
      ],
    });
    expect(codes).toEqual(expect.arrayContaining(['value_invalid', 'effect_malformed']));
  });

  it('effect_applied / effect_expired', () => {
    expect(decodeOk(frame('effect_applied', { piece_id: 'pc_3', effect_kind: 'freeze', remaining_turns: 2 })).event).toEqual({
      type: 'effect_applied',
      pieceId: 'pc_3',
      effect: { kind: 'freeze', remainingTurns: 2 },
    });
    expect(decodeOk(frame('effect_expired', { piece_id: 'pc_3', effect_kind: 'freeze' })).event).toEqual({
      type: 'effect_expired',
      pieceId: 'pc_3',
      effectKind: 'freeze',
    });
  });
});

describe('encodeClientIntent (G2, G3)', () => {
  it('mossa e azioni senza payload', () => {
    expect(JSON.parse(encodeClientIntent({ type: 'move', move: 'e7e8q' }))).toEqual({ type: 'move', payload: { move: 'e7e8q' } });
    expect(JSON.parse(encodeClientIntent({ type: 'pass_phase' }))).toEqual({ type: 'pass_phase', payload: {} });
  });

  it('cast_spell invia spell_id e caselle in ordine, non card_id', () => {
    const wire = JSON.parse(
      encodeClientIntent({
        type: 'cast_spell',
        card: { instanceId: 'c_7', spellId: 'teleport', instanceIdIsLocal: false },
        targets: ['e2', 'e5'],
      }),
    );
    expect(wire).toEqual({ type: 'cast_spell', payload: { spell_id: 'teleport', targets: ['e2', 'e5'] } });
  });
});

describe('REST (A11, A12)', () => {
  it('login', () => {
    expect(normalizeLoginResponse({ token: 't', user: { id: 1, username: 'mario', elo: 1200 } })).toEqual({
      ok: true,
      value: { token: 't', user: { id: '1', username: 'mario', elo: 1200 } },
      warnings: [],
    });
    expect(normalizeLoginResponse({ jwt: 't' }).ok).toBe(false);
  });

  it('profilo con e senza statistiche', () => {
    const full = normalizeUserProfile({ id: 'u1', username: 'mario', elo: 1250, wins: 3, losses: 1, draws: 0 });
    expect(full.ok && full.value.stats).toEqual({ wins: 3, losses: 1, draws: 0 });
    const bare = normalizeUserProfile({ id: 'u1', username: 'mario', elo: 1250 });
    expect(bare.ok && bare.value.stats).toBeNull();
    expect(bare.ok && bare.warnings.map((w) => w.code)).toEqual(['user_stats_missing']);
  });

  it('errori HTTP: solo il codice sopravvive', () => {
    expect(normalizeHttpError(409, { error: 'username_taken' })).toEqual({ status: 409, code: 'username_taken' });
    expect(normalizeHttpError(500, 'Internal Server Error')).toEqual({ status: 500, code: null });
  });

  it('ticket', () => {
    expect(normalizeWsTicket({ ticket: 'abc', expires_in: 45 })).toEqual({
      ok: true,
      value: { ticket: 'abc', expiresInMs: 45000 },
      warnings: [],
    });
  });
});

describe('catalogo (G10)', () => {
  it('fallback.json è valido per intero', () => {
    const { spells, warnings } = normalizeSpellCatalog(fallbackCatalog);
    expect(warnings).toEqual([]);
    expect(spells.map((s) => s.id)).toEqual(['fireball', 'teleport', 'ice_age', 'greed', 'shield', 'recover']);
  });

  it('accetta { spells: [...] } e scarta solo le voci invalide', () => {
    const { spells, warnings } = normalizeSpellCatalog({
      spells: [
        { id: 'x', name: 'X', mana_cost: 1, phases: ['main1'], target_type: 'hex', effects: [{ kind: 'unknown_kind' }] },
        { id: 'bad', name: 'Bad', mana_cost: -3, phases: [], target_type: 'none', effects: [] },
        { name: 'no id' },
      ],
    });
    expect(spells).toEqual([{ id: 'x', name: 'X', manaCost: 1, phases: ['main1'], targetType: 'hex', effects: [{ kind: 'unknown_kind', params: {} }] }]);
    expect(warnings.filter((w) => w.code === 'catalog_entry_invalid')).toHaveLength(2);
  });

  it('forma inattesa → catalogo vuoto con warning', () => {
    expect(normalizeSpellCatalog('nope').warnings.map((w) => w.code)).toEqual(['catalog_shape_unexpected']);
  });
});
