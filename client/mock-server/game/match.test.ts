import { describe, expect, it } from 'vitest';

import { createRng } from '../util';
import { buildDeck, CATALOG, DECK_SIZE } from './catalog';
import { clearStaleEnPassant, destroyPiece, EffectError, forwardSquare, movePieceFen, passTurn, placePiece, relativeRank } from './fen';
import { CastError, MatchState } from './match';
import { validateTargets } from './targets';
import { PERMANENT, Tracker } from './tracker';

/** Porting dei casi di `match/match_test.go`, `effects/effects_test.go`, `effects/tracker_test.go`. */

describe('MatchState (match/match.go)', () => {
  it('New: bianco, turno 1, draw, mani da 4, mazzi da 36, mana 1', () => {
    const m = new MatchState(createRng(1));
    expect([m.activePlayer, m.turnNumber, m.currentPhase]).toEqual(['white', 1, 'draw']);
    expect(buildDeck()).toHaveLength(DECK_SIZE);
    for (const ps of [m.white, m.black]) {
      expect(ps.hand).toHaveLength(4);
      expect(ps.deck).toHaveLength(36);
      expect([ps.mana, ps.max_mana]).toEqual([1, 1]);
    }
  });

  it('Advance: sequenza completa, rollover alla draw avversaria senza fermarsi in end_turn', () => {
    const m = new MatchState(createRng(1));
    expect([m.advance(), m.advance(), m.advance()].map((r) => r.phase)).toEqual(['main1', 'move', 'main2']);
    const rollover = m.advance();
    expect(rollover).toMatchObject({ phase: 'draw', activePlayer: 'black', turnNumber: 2, newTurn: true });
    expect(rollover.mana).toEqual({ player: 'black', current: 1, max: 1 });
    expect(rollover.draw).toMatchObject({ player: 'black', handSize: 5, deckSize: 35 });
  });

  it('mana: +1 per turno proprio, cap 10 (turni del bianco 1/3/5 → 1/2/3)', () => {
    const m = new MatchState(createRng(1));
    const whiteMax: number[] = [m.white.max_mana];
    for (let i = 0; i < 100; i++) {
      const r = m.advance();
      if (r.newTurn && r.activePlayer === 'white') whiteMax.push(m.white.max_mana);
    }
    expect(whiteMax.slice(0, 4)).toEqual([1, 2, 3, 4]);
    expect(Math.max(...whiteMax)).toBe(10);
  });

  it('AutoAdvance: salta draw e le main senza nulla di castabile, si ferma a move', () => {
    const m = new MatchState(createRng(1), { hand: { white: ['shatter', 'shatter', 'shatter', 'shatter'] } });
    expect(m.autoAdvance().map((r) => r.phase)).toEqual(['main1', 'move']);
    expect(m.autoAdvance()).toEqual([]);
  });

  it('AutoAdvance: si ferma in main1 se c’è una carta castabile', () => {
    const m = new MatchState(createRng(1), { hand: { white: ['frost', 'shatter', 'shatter', 'shatter'] } });
    expect(m.autoAdvance().map((r) => r.phase)).toEqual(['main1']);
    expect(m.canCastAny()).toBe(true);
  });

  it('CastSpell: rifiuti nell’ordine del server, a costo zero', () => {
    const m = new MatchState(createRng(1), { hand: { white: ['frost', 'shatter', 'blink', 'blood_pact'] } });
    const cast = (id: string, targets: string[] | null = ['e7']) => {
      try {
        m.castSpell('white', id, targets, () => []);
        return 'ok';
      } catch (e) {
        return e instanceof CastError ? e.error.message : String(e);
      }
    };
    expect(cast('frost')).toBe('non puoi castare magie nella fase draw');
    m.advance();
    expect(m.castSpell.bind(m, 'black', 'frost', ['e2'], () => [])).toThrow('non è il tuo turno');
    expect(cast('fireball')).toBe('magia sconosciuta: fireball');
    expect(cast('shield', ['d2'])).toBe('carta non in mano');
    expect(cast('shatter')).toBe('mana insufficiente: servono 4, hai 1');
    const rejection = (() => {
      try {
        m.castSpell('white', 'shatter', ['e7'], () => []);
        return null;
      } catch (e) {
        return e instanceof CastError ? e.error : e;
      }
    })();
    expect(rejection).toEqual({ code: 'insufficient_mana', message: 'mana insufficiente: servono 4, hai 1', details: { needed: 4, available: 1 } });
    m.gainMana('white', 3, false);
    expect(cast('blink', ['b1'])).toBe('la magia Blink richiede 2 bersagli, ricevuti 1');
    expect(m.white.mana).toBe(4);
    expect(cast('frost')).toBe('ok');
    expect([m.white.mana, m.white.hand.length, m.white.discard]).toEqual([3, 3, ['frost']]);
  });

  it('limite per turno: il secondo Patto di sangue è rifiutato, al turno dopo torna disponibile', () => {
    const m = new MatchState(createRng(1), { hand: { white: ['blood_pact', 'blood_pact', 'shatter', 'shatter'] } });
    m.advance();
    const cast = () => m.castSpell('white', 'blood_pact', ['a2'], () => []);
    cast();
    expect(cast).toThrow('Patto di sangue si può lanciare al massimo 1 volte per turno');
    m.white.mana = 0;
    expect(m.canCastAny()).toBe(false); // al limite la carta non tiene aperta la fase main
    for (let i = 0; i < 8 && !(m.activePlayer === 'white' && m.turnNumber === 3); i++) m.advance();
    m.advance(); // draw → main1 del bianco
    expect(m.white.casts_this_turn).toBeUndefined();
    expect(cast).not.toThrow();
  });

  it('GainMana e DrawFor', () => {
    const m = new MatchState(createRng(1));
    expect(m.gainMana('white', 20, false)).toEqual({ player: 'white', current: 10, max: 1 });
    expect(m.gainMana('white', 5, true)).toEqual({ player: 'white', current: 15, max: 1 });
    expect(m.drawFor('black')).toMatchObject({ player: 'black', handSize: 5, deckSize: 35 });
  });

  it('il catalogo ha le 20 magie degli step 1–3 (spells/catalog.go)', () => {
    expect(CATALOG.size).toBe(20);
    expect(CATALOG.has('ice_wall') && CATALOG.has('sanctuary')).toBe(true);
  });
});

describe('FEN (effects/effects.go)', () => {
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  it('DestroyPiece: rimuove pezzi di entrambi i colori, rifiuta casella vuota e re; revoca l’arrocco della torre', () => {
    expect(destroyPiece(START, 'g8')).toEqual({ fen: 'rnbqkb1r/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', destroyed: 'knight' });
    expect(destroyPiece(START, 'e2').destroyed).toBe('pawn');
    expect(() => destroyPiece(START, 'e4')).toThrow('nessun pezzo da distruggere in e4');
    expect(() => destroyPiece(START, 'e8')).toThrow('il re non può essere distrutto');
    expect(() => destroyPiece(START, 'e1')).toThrow('il re non può essere distrutto');
    expect(destroyPiece(START, 'h8').fen.split(' ')[2]).toBe('KQq');
  });

  it('traverse relative, avanzamento, pedone evocato, en passant scaduto', () => {
    expect([relativeRank('b2', 'white'), relativeRank('b7', 'black'), relativeRank('h8', 'black')]).toEqual([2, 2, 1]);
    expect([forwardSquare('e2', 'white', 1), forwardSquare('e7', 'black', 1)]).toEqual(['e3', 'e6']);
    expect(() => forwardSquare('e8', 'white', 1)).toThrow('e8 non può avanzare di 1');
    expect(placePiece('4k3/8/8/8/8/8/8/4K3 w - - 0 1', 'b2', 'P')).toBe('4k3/8/8/8/8/8/1P6/4K3 w - - 0 1');
    const pushed = '4k3/8/8/8/4P3/8/8/4K3 b - e3 0 1';
    expect(clearStaleEnPassant(pushed)).toBe(pushed);
    expect(clearStaleEnPassant(destroyPiece(pushed, 'e4').fen)).toBe('4k3/8/8/8/8/8/8/4K3 b - - 0 1');
  });

  it('MovePieceFEN: casella vuota, solo pezzi propri; il re revoca entrambi gli arrocchi', () => {
    expect(movePieceFen(START, 'b1', 'c3', 'white')).toBe('rnbqkbnr/pppppppp/8/8/8/2N5/PPPPPPPP/R1BQKBNR w KQkq - 0 1');
    expect(() => movePieceFen(START, 'b1', 'd2', 'white')).toThrow('la casella d2 non è vuota');
    expect(() => movePieceFen(START, 'b8', 'c6', 'white')).toThrow('puoi spostare solo i tuoi pezzi (b8)');
    const kingOut = movePieceFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1', 'e3', 'white');
    expect(kingOut.split(' ')[2]).toBe('kq');
  });

  it('PassTurn: cambia il tratto, azzera en passant, aggiorna i contatori', () => {
    expect(passTurn('8/8/8/8/4P3/8/8/k6K b - e3 3 10')).toBe('8/8/8/8/4P3/8/8/k6K w - - 4 11');
    expect(passTurn('8/8/8/8/8/8/8/k6K w - - 0 5')).toBe('8/8/8/8/8/8/8/k6K b - - 1 5');
  });
});

describe('ValidateTargets (effects/targets.go)', () => {
  // Bianco: re e1, regina d1, cavallo c3, pedoni a2 e h6; nero: re e8, pedone d7 congelato, alfiere f5.
  const FEN = '4k3/3p4/7P/5b2/8/2N5/P7/3QK3 w - - 0 1';
  const reason = (specs: Parameters<typeof validateTargets>[2], targets: string[], caster: 'white' | 'black' = 'white') => {
    const tracker = new Tracker(FEN);
    tracker.freeze('d7', 'white', 1, 'frost');
    try {
      validateTargets(FEN, tracker, specs, targets, caster);
      return '';
    } catch (e) {
      return e instanceof EffectError ? String(e.error.details?.['reason']) : String(e);
    }
  };

  it.each([
    ['pedone nemico', [{ type: 'enemy_piece', pieces: ['pawn'] }], ['d7'], ''],
    ['alfiere non è un pedone', [{ type: 'enemy_piece', pieces: ['pawn'] }], ['f5'], 'piece_kind'],
    ['pezzo proprio come nemico', [{ type: 'enemy_piece' }], ['c3'], 'wrong_owner'],
    ['casa vuota come pezzo', [{ type: 'enemy_piece' }], ['e4'], 'no_piece'],
    ['re nemico mai', [{ type: 'enemy_piece' }], ['e8'], 'king'],
    ['proprio re senza elencarlo', [{ type: 'own_piece' }], ['e1'], 'king'],
    ['proprio re se elencato', [{ type: 'own_piece', pieces: ['king'] }], ['e1'], ''],
    ['pezzo congelato richiesto', [{ type: 'enemy_piece', require_effect: 'freeze' }], ['d7'], ''],
    ['pezzo non congelato', [{ type: 'enemy_piece', require_effect: 'freeze' }], ['f5'], 'missing_effect'],
    ['casa occupata', [{ type: 'square', empty_square: true }], ['c3'], 'not_empty'],
    ['casella fuori scacchiera', [{ type: 'square' }], ['i9'], 'off_board'],
    ['entro 2', [{ type: 'own_piece' }, { type: 'square', empty_square: true, max_distance: 2 }], ['c3', 'e4'], ''],
    ['oltre 2', [{ type: 'own_piece' }, { type: 'square', empty_square: true, max_distance: 2 }], ['c3', 'f6'], 'too_far'],
    ['seconda traversa', [{ type: 'square', own_ranks: [2] }], ['b2'], ''],
    ['terza traversa', [{ type: 'square', own_ranks: [2] }], ['b3'], 'rank'],
    ['pedone in sesta', [{ type: 'own_piece', min_rank: 6 }], ['h6'], ''],
    ['pedone in seconda', [{ type: 'own_piece', min_rank: 6 }], ['a2'], 'rank'],
    ['stessa casella due volte', [{ type: 'square' }, { type: 'square' }], ['e4', 'e4'], 'duplicate'],
  ] as const)('%s', (_name, specs, targets, expected) => {
    expect(reason(specs as unknown as Parameters<typeof validateTargets>[2], [...targets])).toBe(expected);
  });

  it('le traverse sono relative a chi lancia', () => {
    expect(reason([{ type: 'square', own_ranks: [2] }], ['b7'], 'black')).toBe('');
  });
});

describe('Tracker (effects/tracker.go)', () => {
  it('segue il pezzo: mossa, cattura, arrocco, en passant, promozione', () => {
    const t = new Tracker('r3k2r/1P6/8/3pP3/8/8/8/R3K2R w KQkq d6 0 1');
    const king = t.idAt('e1');
    const rook = t.idAt('h1');
    t.movePiece('e1', 'g1', null);
    expect([t.idAt('g1'), t.idAt('f1')]).toEqual([king, rook]);
    const pawn = t.idAt('e5');
    t.movePiece('e5', 'd6', null);
    expect([t.idAt('d6'), t.idAt('d5')]).toEqual([pawn, undefined]);
    const promo = t.idAt('b7');
    t.movePiece('b7', 'a8', 'q');
    expect(t.idAt('a8')).toBe(promo);
  });

  it('freeze su nemico, shield su proprio; la durata conta i turni dell’avversario di chi lancia', () => {
    const t = new Tracker('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    expect(() => t.freeze('e2', 'white', 2, 'frost')).toThrow('non puoi congelare un tuo pezzo (e2)');
    expect(() => t.shield('e7', 'white', 2, 'shield')).toThrow('puoi proteggere solo i tuoi pezzi (e7)');
    expect(() => t.freeze('e4', 'white', 2, 'frost')).toThrow('nessun pezzo da congelare in e4');
    t.freeze('e7', 'white', 1, 'frost');
    t.shield('d2', 'white', 2, 'shield');
    t.shield('c2', 'white', 0, 'test');
    t.shield('b2', 'white', PERMANENT, 'test');
    // Fine del turno del bianco (chi lancia): scade solo la durata 0.
    expect(t.tickTurnEnd('white')).toEqual([{ pieceId: t.idAt('c2'), square: 'c2', kind: 'shield' }]);
    // Fine del turno del nero: il gelo 1 scade, lo scudo 2 scende a 1.
    expect(t.tickTurnEnd('black')).toEqual([{ pieceId: t.idAt('e7'), square: 'e7', kind: 'freeze' }]);
    expect(t.activeEffects()).toEqual([
      { square: 'b2', effects: [{ kind: 'shield', remaining_turns: PERMANENT, source_spell_id: 'test', caster: 'white' }] },
      { square: 'd2', effects: [{ kind: 'shield', remaining_turns: 1, source_spell_id: 'shield', caster: 'white' }] },
    ]);
  });

  it('clone indipendente e pezzo aggiunto con id nuovo', () => {
    const t = new Tracker('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
    const copy = t.clone();
    copy.add('b2', 'P');
    copy.shield('b2', 'white', 1, 'shield');
    expect([t.idAt('b2'), copy.idAt('b2')]).toEqual([undefined, 3]);
    expect(t.activeEffects()).toEqual([]);
  });

  it('movePiece segue arrocco ed en passant; relocate no (B13, B14: effects/tracker.go:69-116)', () => {
    const t = new Tracker('4k3/8/8/8/8/8/3P4/4K2R w K - 0 1');
    const rook = t.idAt('h1');
    t.movePiece('e1', 'g1', null); // arrocco vero: la torre segue il re
    expect(t.idAt('f1')).toBe(rook);
    const t2 = new Tracker('4k3/8/8/8/8/8/3P4/4K2R w K - 0 1');
    const rook2 = t2.idAt('h1');
    t2.relocate('e1', 'g1'); // Teleport: nessuna semantica d'arrocco
    expect([t2.idAt('h1'), t2.idAt('f1')]).toEqual([rook2, undefined]);
    const t3 = new Tracker('4k3/8/8/8/8/8/2PP4/4K3 w - - 0 1');
    const pawn = t3.idAt('c2');
    t3.relocate('d2', 'c4'); // pedone spostato in diagonale: non è un en passant
    expect(t3.idAt('c2')).toBe(pawn);
  });
});
