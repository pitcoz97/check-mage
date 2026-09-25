import { describe, expect, it } from 'vitest';

import { createRng } from '../util';
import { buildDeck, CATALOG, DECK_SIZE } from './catalog';
import { destroyPiece, movePieceFen, passTurn } from './fen';
import { CastError, MatchState } from './match';
import { Tracker } from './tracker';

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
    const m = new MatchState(createRng(1), { hand: { white: ['nova', 'nova', 'nova', 'nova'] } });
    expect(m.autoAdvance().map((r) => r.phase)).toEqual(['main1', 'move']);
    expect(m.autoAdvance()).toEqual([]);
  });

  it('AutoAdvance: si ferma in main1 se c’è una carta castabile', () => {
    const m = new MatchState(createRng(1), { hand: { white: ['spark', 'nova', 'nova', 'nova'] } });
    expect(m.autoAdvance().map((r) => r.phase)).toEqual(['main1']);
    expect(m.canCastAny()).toBe(true);
  });

  it('CastSpell: rifiuti nell’ordine del server, a costo zero', () => {
    const m = new MatchState(createRng(1), { hand: { white: ['spark', 'nova', 'teleport', 'channel'] } });
    const cast = (id: string, targets: string[] | null = []) => {
      try {
        m.castSpell('white', id, targets, () => []);
        return 'ok';
      } catch (e) {
        return e instanceof CastError ? e.error.message : String(e);
      }
    };
    expect(cast('spark')).toBe('non puoi castare magie nella fase draw');
    m.advance();
    expect(m.castSpell.bind(m, 'black', 'spark', [], () => [])).toThrow('non è il tuo turno');
    expect(cast('fireball')).toBe('magia sconosciuta: fireball');
    expect(cast('frostbolt', ['e7'])).toBe('carta non in mano');
    expect(cast('nova')).toBe('mana insufficiente: servono 5, hai 1');
    const rejection = (() => {
      try {
        m.castSpell('white', 'nova', [], () => []);
        return null;
      } catch (e) {
        return e instanceof CastError ? e.error : e;
      }
    })();
    expect(rejection).toEqual({ code: 'insufficient_mana', message: 'mana insufficiente: servono 5, hai 1', details: { needed: 5, available: 1 } });
    m.gainMana('white', 2);
    expect(cast('teleport', ['b1'])).toBe('la magia Teleport richiede 2 bersagli, ricevuti 1');
    expect(m.white.mana).toBe(3);
    expect(cast('spark')).toBe('ok');
    expect([m.white.mana, m.white.hand.length, m.white.discard]).toEqual([2, 3, ['spark']]);
  });

  it('GainMana e DrawFor', () => {
    const m = new MatchState(createRng(1));
    expect(m.gainMana('white', 20)).toEqual({ player: 'white', current: 10, max: 1 });
    expect(m.drawFor('black')).toMatchObject({ player: 'black', handSize: 5, deckSize: 35 });
  });

  it('il catalogo ha le 11 magie di spells/spells.go', () => {
    expect([...CATALOG.keys()].sort()).toEqual(
      ['aegis', 'channel', 'disintegrate', 'frostbolt', 'insight', 'jolt', 'nova', 'pulse', 'spark', 'surge', 'teleport'].sort(),
    );
  });
});

describe('FEN (effects/effects.go)', () => {
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  it('DestroyPiece: rimuove, rifiuta casella vuota, pezzo proprio, re; revoca l’arrocco della torre', () => {
    expect(destroyPiece(START, 'g8', 'white')).toEqual({ fen: 'rnbqkb1r/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', destroyed: 'knight' });
    expect(() => destroyPiece(START, 'e4', 'white')).toThrow('nessun pezzo da distruggere in e4');
    expect(() => destroyPiece(START, 'e2', 'white')).toThrow('non puoi distruggere un tuo pezzo (e2)');
    expect(() => destroyPiece(START, 'e8', 'white')).toThrow('il re non può essere distrutto');
    expect(destroyPiece(START, 'h8', 'white').fen.split(' ')[2]).toBe('KQq');
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

  it('freeze su nemico, shield su proprio, durata sui turni del proprietario', () => {
    const t = new Tracker('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    expect(() => t.freeze('e2', 'white', 2, 'frostbolt')).toThrow('non puoi congelare un tuo pezzo (e2)');
    expect(() => t.shield('e7', 'white', 2, 'aegis')).toThrow('puoi proteggere solo i tuoi pezzi (e7)');
    expect(() => t.freeze('e4', 'white', 2, 'frostbolt')).toThrow('nessun pezzo da congelare in e4');
    t.freeze('e7', 'white', 2, 'frostbolt');
    t.shield('d2', 'white', 2, 'aegis');
    expect(t.tickColor('white')).toEqual([]); // lo shield del bianco scende a 1
    expect(t.tickColor('black')).toEqual([]); // il freeze del nero scende a 1
    expect(t.tickColor('black')).toEqual([{ pieceId: t.idAt('e7'), square: 'e7', kind: 'freeze' }]);
    expect(t.activeEffects()).toEqual([{ square: 'd2', effects: [{ kind: 'shield', remaining_turns: 1, source_spell_id: 'aegis' }] }]);
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
