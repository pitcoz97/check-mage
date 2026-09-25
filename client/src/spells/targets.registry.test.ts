import { describe, expect, it } from 'vitest';

import type { Square } from '../game/model';
import type { Spell } from './schema';
import { spellTargets, targetResolver } from './targets.registry';

/**
 * Bersagli validi per tipo: sono quelli che il server accetta sulla forma del bersaglio. Le regole che dipendono
 * dalla posizione risultante restano al server.
 */

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const ctx = { fen: START, myColor: 'white' } as const;

const spell = (targetType: string, kind: string): Spell => ({
  id: 'x',
  name: 'X',
  manaCost: 1,
  phases: ['main1'],
  targetType,
  effects: [{ kind, params: {} }],
});

describe('registry dei bersagli', () => {
  it('quanti bersagli servono per tipo', () => {
    expect(targetResolver('none')?.count).toBe(0);
    expect(targetResolver('enemy_piece')?.count).toBe(1);
    expect(targetResolver('piece_move')?.count).toBe(2);
    // Tipo sconosciuto: nessun resolver, la carta resterà non lanciabile.
    expect(targetResolver('constellation')).toBeNull();
  });

  it('own_piece e enemy_piece guardano il colore di chi lancia', () => {
    const own = spellTargets(spell('own_piece', 'shield_piece'), ctx, 0);
    const enemy = spellTargets(spell('enemy_piece', 'freeze_piece'), ctx, 0);
    expect(own).toHaveLength(16);
    expect(own).toContain('e1' satisfies Square);
    expect(enemy).toHaveLength(16);
    expect(enemy).toContain('e8' satisfies Square);
    expect(enemy).not.toContain('e1' satisfies Square);
  });

  it('la distruzione esclude il re, il congelamento no', () => {
    expect(spellTargets(spell('enemy_piece', 'destroy_piece'), ctx, 0)).not.toContain('e8' satisfies Square);
    expect(spellTargets(spell('enemy_piece', 'freeze_piece'), ctx, 0)).toContain('e8' satisfies Square);
  });

  it('piece_move: prima un proprio pezzo, poi una casella vuota qualsiasi', () => {
    const teleport = spell('piece_move', 'move_piece');
    expect(spellTargets(teleport, ctx, 0)).toContain('b1' satisfies Square);
    const destinations = spellTargets(teleport, ctx, 1);
    expect(destinations).toHaveLength(32);
    expect(destinations).toContain('e5' satisfies Square);
    expect(destinations).not.toContain('e2' satisfies Square);
  });

  it('nessun bersaglio per `none`, e nessuno per un tipo sconosciuto', () => {
    expect(spellTargets(spell('none', 'gain_mana'), ctx, 0)).toEqual([]);
    expect(spellTargets(spell('constellation', 'noop'), ctx, 0)).toEqual([]);
  });

  it('una FEN illeggibile non produce bersagli e non esplode', () => {
    expect(spellTargets(spell('own_piece', 'shield_piece'), { fen: 'x', myColor: 'white' }, 0)).toEqual([]);
  });
});
