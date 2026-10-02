import { describe, expect, it } from 'vitest';

import { CATALOG } from '../game/catalog';
import { validateTargets } from '../game/targets';
import { Tracker } from '../game/tracker';
import { createRng } from '../util';
import { chooseMove, chooseSpell, type BotView } from './botPolicy';

/** Le stesse regole di `internal/bot` (bot_test.go) per le magie; le mosse del mock al posto di Stockfish. */

// Bianco: torre in a1 minacciata dall'alfiere in h8, pedone in e2 tranquillo. Nero: cavallo in d5, pedone in h7.
const FEN = '4k2b/7p/8/3n4/8/8/4P3/R3K3 w - - 0 1';

const view = (hand: string[], mana: number, fen = FEN): BotView => ({
  fen,
  color: 'white',
  phase: 'main1',
  hand,
  mana,
  casts: {},
  graveyard: [],
  tracker: new Tracker(fen),
});

describe('magie del bot', () => {
  it('intermedio e avanzato proteggono il pezzo minacciato, non quelli tranquilli', () => {
    for (const level of ['intermediate', 'advanced'] as const) {
      expect(chooseSpell(level, view(['shield'], 5), new Set(), createRng(1))).toEqual({ spell_id: 'shield', targets: ['a1'] });
      expect(chooseSpell(level, view(['shield'], 5, '4k3/7p/8/3n4/8/8/4P3/R3K3 w - - 0 1'), new Set(), createRng(1))).toBeNull();
    }
  });

  it('l’avanzato pesa il costo: frantuma il cavallo congelato, non il pedone', () => {
    const knight = view(['shatter'], 4);
    knight.tracker.freeze('d5', 'white', 1, 'frost');
    expect(chooseSpell('advanced', knight, new Set(), createRng(1))?.targets).toEqual(['d5']);
    const pawn = view(['shatter'], 4);
    pawn.tracker.freeze('h7', 'white', 1, 'frost');
    expect(chooseSpell('advanced', pawn, new Set(), createRng(1))).toBeNull();
    expect(chooseSpell('intermediate', pawn, new Set(), createRng(1))).not.toBeNull();
  });

  it('regole: mana, fase, carte rifiutate, cimitero per la resurrezione', () => {
    expect(chooseSpell('advanced', view(['shield'], 1), new Set(), createRng(1))).toBeNull();
    expect(chooseSpell('advanced', view(['shield'], 5), new Set(['shield']), createRng(1))).toBeNull();
    expect(chooseSpell('advanced', view(['resurrection'], 10), new Set(), createRng(1))).toBeNull();
    const grave = { ...view(['resurrection'], 10), graveyard: ['knight', 'rook'] };
    expect(chooseSpell('advanced', grave, new Set(), createRng(1))?.choice).toEqual({ piece: 'rook' });
  });

  it('il base lancia circa metà delle volte, sempre con bersagli validi', () => {
    const rng = createRng(7);
    let casts = 0;
    for (let i = 0; i < 400; i++) {
      const v = view(['frost', 'shield', 'ice_wall', 'forced_march', 'revelation'], 3);
      const cast = chooseSpell('base', v, new Set(), rng);
      if (cast === null) continue;
      casts++;
      const spell = CATALOG.get(cast.spell_id);
      expect(spell).toBeDefined();
      if (spell !== undefined) expect(() => validateTargets(v.fen, v.tracker, spell.targets, cast.targets, 'white')).not.toThrow();
    }
    expect(casts / 400).toBeGreaterThan(0.4);
    expect(casts / 400).toBeLessThan(0.6);
  });
});

describe('mosse del bot (mock)', () => {
  // Il bianco può prendere la donna in d8 con la torre, o il pedone in a7 con la donna (che verrebbe ripresa).
  const fen = '3q2k1/r7/8/8/8/8/8/Q2R2K1 w - - 0 1';

  it('l’intermedio prende il pezzo di valore più alto', () => {
    expect(chooseMove('intermediate', fen, ['d1d8', 'a1a7', 'g1h1'], [], createRng(1))).toBe('d1d8');
  });

  it('l’avanzato guarda la risposta: non regala la donna per una torre', () => {
    // Qa1xa7 prende una torre ma non è ripresa; Rd1xd8+ prende la donna: vince comunque la cattura migliore.
    expect(chooseMove('advanced', fen, ['d1d8', 'a1a7'], [], createRng(1))).toBe('d1d8');
    // Qui la donna bianca in d4 può prendere il pedone in d5, difeso dal pedone in e6: l'avanzato non lo fa.
    const guarded = '6k1/8/4p3/3p4/3Q4/8/8/6K1 w - - 0 1';
    expect(chooseMove('advanced', guarded, ['d4d5', 'g1h1'], [], createRng(1))).toBe('g1h1');
    expect(chooseMove('intermediate', guarded, ['d4d5', 'g1h1'], [], createRng(1))).toBe('d4d5');
  });

  it('senza mosse giocabili gioca una speciale; senza mosse nessuna', () => {
    expect(chooseMove('advanced', fen, [], ['c1e3'], createRng(1))).toBe('c1e3');
    expect(chooseMove('advanced', fen, [], [], createRng(1))).toBe('');
  });
});
