import { describe, expect, it } from 'vitest';

import { returnPiece } from './fen';
import { aroundSquares, runeEntry, runeStrike } from './runes';
import { Tracker } from './tracker';

/** Porting di `effects/runes_test.go`. */

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const stasis = { on_enter: 'freeze_piece', duration: 2 };

describe('rune (effects/runes.go)', () => {
  it('una runa per proprietario per casa: la seconda propria sostituisce la prima', () => {
    const tracker = new Tracker(START);
    tracker.addRune('e5', 'white', stasis, 'stasis_rune');
    tracker.addRune('e5', 'white', { on_enter: 'return_to_origin' }, 'repel_rune');
    tracker.addRune('e5', 'black', stasis, 'stasis_rune');
    expect(tracker.squareEffects()[0]?.effects).toHaveLength(2);
    expect(tracker.runeAt('e5', 'white')).toEqual({
      kind: 'rune',
      remaining_turns: -1,
      source_spell_id: 'repel_rune',
      caster: 'white',
      hidden: true,
      rune: { on_enter: 'return_to_origin' },
    });
    tracker.removeRune('e5', 'white');
    expect(tracker.runesOf('white')).toEqual([]);
    expect(tracker.runesOf('black')).toEqual(['e5']);
  });

  it("l'avversario non vede le rune nascoste; rivelate lo restano, le nuove no; non scadono", () => {
    const tracker = new Tracker(START);
    tracker.addSquareEffect('d4', 'wall', 2, 'ice_wall', 'black');
    tracker.addRune('d4', 'white', stasis, 'stasis_rune');
    tracker.addRune('e5', 'white', stasis, 'stasis_rune');
    expect(tracker.squareEffectsFor('black')).toEqual([
      { square: 'd4', effects: [{ kind: 'wall', remaining_turns: 2, source_spell_id: 'ice_wall', caster: 'black' }] },
    ]);
    expect(tracker.squareEffectsFor('white')).toHaveLength(2);
    expect(tracker.revealRunes('white')).toBe(2);
    expect(tracker.runeAt('e5', 'white')).not.toHaveProperty('hidden');
    tracker.addRune('c6', 'white', stasis, 'stasis_rune');
    expect(tracker.squareEffectsFor('black').map((s) => s.square)).toEqual(['d4', 'e5']);
    for (let i = 0; i < 5; i++) {
      tracker.tickSquares('black');
      tracker.tickSquares('white');
    }
    expect(tracker.runesOf('white')).toHaveLength(3);
  });

  it('la rivelazione sulla copia non tocca l’originale', () => {
    const tracker = new Tracker(START);
    tracker.addRune('e5', 'white', stasis, 'stasis_rune');
    tracker.clone().revealRunes('white');
    expect(tracker.runeAt('e5', 'white')?.hidden).toBe(true);
  });

  it('runeEntry: arrivo, en passant, torre dell’arrocco; il re no', () => {
    const fen = 'r3k2r/pppp1ppp/8/3Pp3/8/8/8/R3K2R w KQkq e6 0 1';
    expect(runeEntry(fen, 'a1a4')).toEqual({ square: 'a4', origin: 'a1', piece: 'R' });
    expect(runeEntry(fen, 'd5e6')).toEqual({ square: 'e6', origin: 'd5', piece: 'P' });
    expect(runeEntry(fen, 'e1g1')).toEqual({ square: 'f1', origin: 'h1', piece: 'R' });
    expect(runeEntry(fen, 'e1c1')).toEqual({ square: 'd1', origin: 'a1', piece: 'R' });
    expect(runeEntry(fen, 'e1e2')).toBeNull();
  });

  it('returnPiece: il pedone promosso torna pedone; la spinta annullata toglie l’en passant', () => {
    expect(returnPiece('4Q2k/8/8/8/8/8/8/4K3 b - - 0 1', 'e8', 'e7', 'P')).toBe('7k/4P3/8/8/8/8/8/4K3 b - - 0 1');
    expect(returnPiece('4k3/8/8/8/4P3/8/8/4K3 b - e3 0 1', 'e4', 'e2', 'P')).toBe('4k3/8/8/8/8/8/4P3/4K3 b - - 0 1');
  });

  it('runeStrike e aroundSquares', () => {
    const explosive = { on_enter: 'destroy_piece', only: ['pawn', 'knight', 'bishop'], fallback: 'freeze_piece', fallback_duration: 1 };
    expect(runeStrike(explosive, 'n')).toEqual({ kind: 'destroy_piece', duration: 0 });
    expect(runeStrike(explosive, 'Q')).toEqual({ kind: 'freeze_piece', duration: 1 });
    expect(runeStrike(stasis, 'R')).toEqual({ kind: 'freeze_piece', duration: 2 });
    expect(aroundSquares('a1', 1)).toEqual(['a2', 'b1', 'b2']);
    expect(aroundSquares('e4', 1)).toHaveLength(8);
  });
});
