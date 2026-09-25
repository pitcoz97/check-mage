import { describe, expect, it } from 'vitest';

import type { HandCard, PublicGameState } from '../game/model';
import type { ServerEvent } from '../ws/protocol';
import { applyServerEvent, clockRemaining, createMatchStore, initialMatchState, reconcileHand, type MatchState } from './matchStore';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

function publicState(overrides: Partial<PublicGameState> = {}): PublicGameState {
  return {
    fen: START_FEN,
    moves: [],
    turn: 'white',
    status: 'active',
    clocks: { white: 600_000, black: 600_000 },
    phase: 'draw',
    activePlayer: 'white',
    turnNumber: 1,
    mana: { white: { current: 1, max: 1 }, black: { current: 1, max: 1 } },
    handSizes: { white: 4, black: 4 },
    deckSizes: { white: 36, black: 36 },
    activeEffects: [],
    graveyards: { white: [], black: [] },
    reconnected: false,
    players: { white: { id: '1', username: 'mario' }, black: { id: '2', username: 'luigi' } },
    timeControl: { baseMs: 600_000, incrementMs: 5_000 },
    ...overrides,
  };
}

const card = (spellId: string, instanceId = `new-${spellId}`): HandCard => ({ instanceId, spellId });

/** Applica una sequenza di eventi a partire dallo stato di un utente, con un orologio che avanza di 10 ms a evento. */
function run(events: ServerEvent[], selfId = '1', from: MatchState = initialMatchState(selfId)): MatchState {
  return events.reduce((state, event, i) => applyServerEvent(state, event, 1_000 + i * 10), from);
}

const START: ServerEvent[] = [
  { type: 'game_state', state: publicState() },
  {
    type: 'hand',
    hand: { cards: [card('spark', 'a'), card('frostbolt', 'b'), card('aegis', 'c'), card('nova', 'd')], mana: { current: 1, max: 1 }, deckSize: 36 },
  },
  { type: 'phase_changed', phase: 'main1', activePlayer: 'white', turnNumber: 1 },
];

describe('applyServerEvent: avvio e colore', () => {
  it('game_state → playing, colore dagli id dei giocatori, orologi agganciati', () => {
    const white = run(START, '1');
    expect(white).toMatchObject({ lifecycle: 'playing', myColor: 'white', myDeckSize: 36, seq: 3 });
    expect(white.hand.map((c) => c.instanceId)).toEqual(['a', 'b', 'c', 'd']);
    expect(white.game?.phase).toBe('main1');
    expect(run(START, '2').myColor).toBe('black');
    expect(run(START, '99').myColor).toBeNull();
  });

  it('senza identità dei giocatori il colore non si deduce (C1)', () => {
    expect(run([{ type: 'game_state', state: publicState({ players: null }) }]).myColor).toBeNull();
  });
});

describe('applyServerEvent: aggiornamenti puntuali', () => {
  it('mossa con rollover: game_state, fasi, mana e pesca privata dell’avversario', () => {
    const black = run(
      [
        ...START,
        { type: 'game_state', state: publicState({ fen: AFTER_E4, turn: 'black', moves: [{ kind: 'move', uci: 'e2e4' }], phase: 'main2' }) },
        { type: 'phase_changed', phase: 'draw', activePlayer: 'black', turnNumber: 2 },
        { type: 'mana_changed', player: 'black', mana: { current: 1, max: 1 } },
        { type: 'card_drawn', card: card('channel', 'e'), deckSize: 35 },
        { type: 'hand_size_changed', player: 'black', size: 5 },
        { type: 'phase_changed', phase: 'main1', activePlayer: 'black', turnNumber: 2 },
      ],
      '2',
    );
    expect(black.game).toMatchObject({ phase: 'main1', activePlayer: 'black', turnNumber: 2, handSizes: { black: 5 }, deckSizes: { black: 35 } });
    expect(black.hand.at(-1)).toEqual(card('channel', 'e'));
    expect(black.myDeckSize).toBe(35);
    expect(black.clockSync?.turn).toBe('black');
  });

  it('cast proprio: la carta esce dalla mano; freeze e shield entrano negli effetti attivi', () => {
    const state = run([
      ...START,
      {
        type: 'spell_cast',
        player: 'white',
        spellId: 'frostbolt',
        targets: ['e7'],
        effects: [{ kind: 'freeze_piece', target: 'e7', remainingTurns: 2 }],
      },
      { type: 'mana_changed', player: 'white', mana: { current: 0, max: 1 } },
      { type: 'hand_size_changed', player: 'white', size: 3 },
      { type: 'spell_cast', player: 'black', spellId: 'aegis', targets: ['d7'], effects: [{ kind: 'shield_piece', target: 'd7', remainingTurns: 2 }] },
    ]);
    expect(state.hand.map((c) => c.spellId)).toEqual(['spark', 'aegis', 'nova']);
    expect(state.game?.activeEffects).toEqual([
      { square: 'e7', effects: [{ kind: 'freeze', remainingTurns: 2, sourceSpellId: 'frostbolt' }] },
      { square: 'd7', effects: [{ kind: 'shield', remainingTurns: 2, sourceSpellId: 'aegis' }] },
    ]);
    expect(state.game?.mana.white).toEqual({ current: 0, max: 1 });
  });

  it('effetti di massa: lo stato va su ogni casa di targets; graveyard_changed aggiorna il cimitero', () => {
    const state = run([
      ...START,
      {
        type: 'spell_cast',
        player: 'black',
        spellId: 'eternal_winter',
        targets: [],
        effects: [{ kind: 'freeze_all', targets: ['a2', 'b2'], remainingTurns: 1 }],
      },
      { type: 'graveyard_changed', player: 'white', graveyard: ['pawn'] },
    ]);
    expect(state.game?.activeEffects).toEqual([
      { square: 'a2', effects: [{ kind: 'freeze', remainingTurns: 1, sourceSpellId: 'eternal_winter' }] },
      { square: 'b2', effects: [{ kind: 'freeze', remainingTurns: 1, sourceSpellId: 'eternal_winter' }] },
    ]);
    expect(state.game?.graveyards).toEqual({ white: ['pawn'], black: [] });
  });

  it('le magie della sessione finiscono nel registro, con il punto dello storico in cui sono arrivate (D11)', () => {
    const state = run([
      ...START,
      { type: 'spell_cast', player: 'white', spellId: 'aegis', targets: ['e2'], effects: [{ kind: 'shield_piece', target: 'e2', remainingTurns: 2 }] },
      { type: 'game_state', state: publicState({ fen: AFTER_E4, turn: 'black', moves: [{ kind: 'move', uci: 'e2e4' }], phase: 'main2' }) },
      { type: 'spell_cast', player: 'black', spellId: 'frostbolt', targets: ['e4'], effects: [{ kind: 'noop' }] },
    ]);
    expect(state.spellLog.map(({ player, spellId, targets, moveIndex }) => ({ player, spellId, targets, moveIndex }))).toEqual([
      { player: 'white', spellId: 'aegis', targets: ['e2'], moveIndex: 0 },
      { player: 'black', spellId: 'frostbolt', targets: ['e4'], moveIndex: 1 },
    ]);
    // Una partita nuova (reset della sessione) riparte da un registro vuoto.
    expect(initialMatchState('1').spellLog).toEqual([]);
  });

  it('cast in volo: parte con beginCast, si chiude col proprio spell_cast, e un error lo libera', () => {
    const store = createMatchStore('1');
    for (const event of START) store.getState().dispatch(event);
    store.getState().beginCast('frostbolt');
    expect(store.getState().pendingCast?.spellId).toBe('frostbolt');

    // Il cast dell'avversario non sblocca il mio.
    store.getState().dispatch({ type: 'spell_cast', player: 'black', spellId: 'spark', targets: [], effects: [{ kind: 'noop' }] });
    expect(store.getState().pendingCast).not.toBeNull();

    store.getState().dispatch({
      type: 'spell_cast',
      player: 'white',
      spellId: 'frostbolt',
      targets: ['e7'],
      effects: [{ kind: 'freeze_piece', target: 'e7', remainingTurns: 2 }],
    });
    expect(store.getState().pendingCast).toBeNull();
    // L'ultima magia risolta resta a disposizione dell'animazione, con i bersagli e gli effetti del server.
    expect(store.getState().lastCast).toMatchObject({ player: 'white', spellId: 'frostbolt', targets: ['e7'] });

    store.getState().beginCast('nova');
    store.getState().dispatch({
      type: 'error',
      error: { code: 'insufficient_mana', square: null, phase: null, needed: 5, available: 1, expected: null, received: null, king: null, index: null, reason: null, perTurn: null },
    });
    expect(store.getState().pendingCast).toBeNull();
  });

  it('un freeze rinnovato sostituisce quello esistente; effect_expired lo toglie (anche lo scudo assorbito)', () => {
    const freeze = (turns: number): ServerEvent => ({
      type: 'spell_cast',
      player: 'white',
      spellId: 'frostbolt',
      targets: ['e7'],
      effects: [{ kind: 'freeze_piece', target: 'e7', remainingTurns: turns }],
    });
    const renewed = run([...START, freeze(2), freeze(3)]);
    expect(renewed.game?.activeEffects).toEqual([{ square: 'e7', effects: [{ kind: 'freeze', remainingTurns: 3, sourceSpellId: 'frostbolt' }] }]);
    const expired = run([...START, freeze(2), { type: 'effect_expired', expired: { square: 'e7', kind: 'freeze', pieceId: '5', reason: 'expired' } }]);
    expect(expired.game?.activeEffects).toEqual([]);
  });

  it('timer_update: orologi del server; interpolazione solo per il giocatore attivo', () => {
    const state = applyServerEvent(run(START), { type: 'timer_update', clocks: { white: 590_000, black: 600_000 }, turn: 'white' }, 5_000);
    expect(clockRemaining(state.clockSync, 'white', 5_750)).toBe(589_250);
    expect(clockRemaining(state.clockSync, 'black', 5_750)).toBe(600_000);
    expect(clockRemaining(state.clockSync, 'white', 5_000 + 900_000)).toBe(0);
    expect(clockRemaining(null, 'white', 0)).toBeNull();
    // Cambio del giocatore attivo: il tempo del bianco si ferma al valore interpolato.
    const switched = applyServerEvent(state, { type: 'phase_changed', phase: 'draw', activePlayer: 'black', turnNumber: 2 }, 6_000);
    expect(clockRemaining(switched.clockSync, 'white', 9_000)).toBe(589_000);
    expect(clockRemaining(switched.clockSync, 'black', 9_000)).toBe(597_000);
  });

  it('eventi prima del primo game_state non rompono nulla', () => {
    const state = run([
      { type: 'mana_changed', player: 'white', mana: { current: 2, max: 2 } },
      { type: 'effect_expired', expired: { square: 'e7', kind: 'freeze', pieceId: null, reason: 'expired' } },
      { type: 'card_drawn', card: card('spark'), deckSize: null },
    ]);
    expect(state.game).toBeNull();
    expect(state.hand).toHaveLength(1);
  });
});

describe('applyServerEvent: patta, connessione, errori', () => {
  it('offerta ricevuta, poi la propria mossa la fa decadere (il server non avvisa chi l’ha ricevuta)', () => {
    const offered = run([...START, { type: 'phase_changed', phase: 'move', activePlayer: 'white', turnNumber: 1 }, { type: 'draw_offer', from: 'luigi' }]);
    expect(offered.drawOffer).toEqual({ incoming: true, outgoing: false });
    const moved = applyServerEvent(
      offered,
      { type: 'game_state', state: publicState({ fen: AFTER_E4, turn: 'black', moves: [{ kind: 'move', uci: 'e2e4' }], phase: 'main2' }) },
      2_000,
    );
    expect(moved.drawOffer.incoming).toBe(false);
  });

  it('una mossa assorbita dallo scudo conta come mossa giocata', () => {
    const offered = run([...START, { type: 'draw_offer', from: 'luigi' }]);
    const absorbed = applyServerEvent(
      offered,
      { type: 'game_state', state: publicState({ turn: 'black', moves: [{ kind: 'absorbed' }] }) },
      2_000,
    );
    expect(absorbed.drawOffer.incoming).toBe(false);
  });

  it('la mossa dell’avversario non fa decadere l’offerta ricevuta', () => {
    const black = run(
      [
        ...START,
        { type: 'draw_offer', from: 'mario' },
        { type: 'game_state', state: publicState({ fen: AFTER_E4, turn: 'black', moves: [{ kind: 'move', uci: 'e2e4' }] }) },
      ],
      '2',
    );
    expect(black.drawOffer.incoming).toBe(true);
  });

  it('offerta propria: inviata, poi rifiutata o decaduta con un avviso distinguibile', () => {
    const sent = run([...START, { type: 'draw_offer_sent' }]);
    expect(sent.drawOffer.outgoing).toBe(true);
    const declined = applyServerEvent(sent, { type: 'draw_declined', reason: 'move_played' }, 2_000);
    expect(declined.drawOffer.outgoing).toBe(false);
    expect(declined.drawNotice).toEqual({ reason: 'move_played', seq: declined.seq });
  });

  it('avversario disconnesso e rientrato; riconnessione propria con mano riconciliata', () => {
    const away = run([...START, { type: 'opponent_disconnected' }]);
    expect(away.opponentConnected).toBe(false);
    expect(applyServerEvent(away, { type: 'opponent_reconnected' }, 2_000).opponentConnected).toBe(true);

    const resumed = run(
      [
        { type: 'game_state', state: publicState({ reconnected: true }) },
        {
          type: 'hand',
          hand: { cards: [card('nova', 'x1'), card('spark', 'x2'), card('spark', 'x3')], mana: { current: 3, max: 3 }, deckSize: 30 },
        },
      ],
      '1',
      run(START),
    );
    expect(resumed.hand.map((c) => `${c.spellId}:${c.instanceId}`)).toEqual(['nova:d', 'spark:a', 'spark:x3']);
    expect(resumed.game?.mana.white).toEqual({ current: 3, max: 3 });
    expect(resumed.myDeckSize).toBe(30);
  });

  it('error: registrato con un seq nuovo anche se identico al precedente', () => {
    const info = { code: 'not_your_turn' as const, square: null, phase: null, needed: null, available: null, expected: null, received: null, king: null, index: null, reason: null, perTurn: null };
    const first = applyServerEvent(run(START), { type: 'error', error: info }, 2_000);
    const second = applyServerEvent(first, { type: 'error', error: info }, 2_010);
    expect(second.lastError?.info).toEqual(info);
    expect(second.lastError?.seq).toBeGreaterThan(first.lastError?.seq ?? 0);
  });

  it('game_over: esito, offerte chiuse, eventi di partita successivi ignorati ma errori visibili', () => {
    const over = run([
      ...START,
      { type: 'draw_offer', from: 'luigi' },
      { type: 'game_state', state: publicState({ status: 'resigned' }) },
      { type: 'game_over', result: '0-1', reason: 'resign', winner: 'luigi' },
    ]);
    expect(over).toMatchObject({ lifecycle: 'over', outcome: { result: '0-1', reason: 'resign', winner: 'luigi' }, drawOffer: { incoming: false } });
    expect(over.game?.status).toBe('resigned');
    const late = run(
      [
        { type: 'game_over', result: '1-0', reason: 'timeout', winner: 'mario' },
        { type: 'phase_changed', phase: 'move', activePlayer: 'white', turnNumber: 9 },
      ],
      '1',
      over,
    );
    expect(late).toBe(over);
    const info = { code: 'game_over' as const, square: null, phase: null, needed: null, available: null, expected: null, received: null, king: null, index: null, reason: null, perTurn: null };
    expect(applyServerEvent(over, { type: 'error', error: info }, 9_000).lastError?.info.code).toBe('game_over');
  });
});

describe('mossa ottimista', () => {
  it('mostrata subito, poi confermata dal game_state del server', () => {
    const store = createMatchStore('1', () => 100);
    for (const event of START) store.getState().dispatch(event);
    store.getState().previewMove('e2', 'e4');
    expect(store.getState().optimistic).toEqual({ from: 'e2', to: 'e4', at: 100 });
    store.getState().dispatch({ type: 'game_state', state: publicState({ fen: AFTER_E4, turn: 'black', moves: [{ kind: 'move', uci: 'e2e4' }] }) });
    expect(store.getState().optimistic).toBeNull();
  });

  it('un rifiuto del server la annulla', () => {
    const store = createMatchStore('1', () => 100);
    for (const event of START) store.getState().dispatch(event);
    store.getState().previewMove('e2', 'e4');
    const info = { code: 'illegal_move' as const, square: null, phase: null, needed: null, available: null, expected: null, received: null, king: null, index: null, reason: null, perTurn: null };
    store.getState().dispatch({ type: 'error', error: info });
    expect(store.getState().optimistic).toBeNull();
    expect(store.getState().lastError?.info.code).toBe('illegal_move');
  });

  it('anche un game_state che smentisce la mossa (scudo che assorbe) la toglie di mezzo', () => {
    const store = createMatchStore('1', () => 100);
    for (const event of START) store.getState().dispatch(event);
    store.getState().previewMove('e4', 'd5');
    store.getState().dispatch({ type: 'game_state', state: publicState({ turn: 'black', moves: [{ kind: 'absorbed' }] }) });
    expect(store.getState().optimistic).toBeNull();
    expect(store.getState().game?.fen).toBe(START_FEN);
  });
});

describe('reconcileHand', () => {
  it('riusa gli id noti per spell_id, uno per copia', () => {
    const previous = [card('spark', 'a'), card('spark', 'b'), card('aegis', 'c')];
    expect(reconcileHand(previous, [card('spark', 'n1'), card('nova', 'n2'), card('spark', 'n3'), card('spark', 'n4')])).toEqual([
      card('spark', 'a'),
      card('nova', 'n2'),
      card('spark', 'b'),
      card('spark', 'n4'),
    ]);
  });
});

describe('createMatchStore', () => {
  it('coda, eventi, reset', () => {
    const store = createMatchStore('1', () => 42);
    store.getState().enterQueue();
    expect(store.getState().lifecycle).toBe('queued');
    for (const event of START) store.getState().dispatch(event);
    expect(store.getState()).toMatchObject({ lifecycle: 'playing', myColor: 'white', clockSync: { at: 42 } });
    store.getState().reset('2');
    expect(store.getState()).toMatchObject({ lifecycle: 'idle', selfId: '2', game: null, hand: [] });
  });
});
