import { describe, expect, it } from 'vitest';

import type { Square } from '../game/model';
import { targetSpec, testSpell } from '../testing/catalog';
import type { TargetSpec } from './schema';
import { spellTargets, targetsSupported } from './targets.registry';

/**
 * Bersagli validi per ogni passo: le regole di `effects/targets.go` sulla forma del bersaglio. Quello che dipende
 * dalla posizione risultante (uno scacco) resta al server.
 */

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const ctx = { fen: START, myColor: 'white', effects: [] } as const;
const oneTarget = (spec: TargetSpec) => testSpell({ targets: [spec] });

describe('registry dei bersagli', () => {
  it('own_piece e enemy_piece guardano il colore di chi lancia, e il re non è mai un bersaglio', () => {
    const own = spellTargets(oneTarget(targetSpec('own_piece')), ctx, []);
    const enemy = spellTargets(oneTarget(targetSpec('enemy_piece')), ctx, []);
    expect(own).toHaveLength(15);
    expect(own).not.toContain('e1' satisfies Square);
    expect(enemy).toHaveLength(15);
    expect(enemy).toContain('d8' satisfies Square);
    expect(enemy).not.toContain('e8' satisfies Square);
    // Il proprio re solo se lo spec lo elenca.
    expect(spellTargets(oneTarget(targetSpec('own_piece', { pieces: ['king'] })), ctx, [])).toEqual(['e1']);
  });

  it('pezzi ammessi', () => {
    expect(spellTargets(oneTarget(targetSpec('own_piece', { pieces: ['queen'] })), ctx, [])).toEqual(['d1']);
    expect(spellTargets(oneTarget(targetSpec('enemy_piece', { pieces: ['knight', 'bishop'] })), ctx, [])).toEqual(['b8', 'c8', 'f8', 'g8']);
  });

  it('stato richiesto: solo i pezzi che l’hanno in active_effects', () => {
    const frozen = { ...ctx, effects: [{ square: 'e7', effects: [{ kind: 'freeze', remainingTurns: 1, sourceSpellId: 'frost' }] }] } as const;
    expect(spellTargets(oneTarget(targetSpec('enemy_piece', { requireEffect: 'freeze' })), frozen, [])).toEqual(['e7']);
    expect(spellTargets(oneTarget(targetSpec('enemy_piece', { requireEffect: 'freeze' })), ctx, [])).toEqual([]);
  });

  it('casa vuota e traverse relative a chi lancia', () => {
    const empty = spellTargets(oneTarget(targetSpec('square', { emptySquare: true })), ctx, []);
    expect(empty).toHaveLength(32);
    const kings = '4k3/8/8/8/8/8/8/4K3 w - - 0 1';
    const secondRank = oneTarget(targetSpec('square', { emptySquare: true, ownRanks: [2] }));
    expect(spellTargets(secondRank, { ...ctx, fen: kings }, [])).toHaveLength(8);
    expect(spellTargets(secondRank, { ...ctx, fen: kings }, []).every((s) => s[1] === '2')).toBe(true);
    expect(spellTargets(secondRank, { ...ctx, fen: kings, myColor: 'black' }, []).every((s) => s[1] === '7')).toBe(true);
    const fromSixth = oneTarget(targetSpec('own_piece', { pieces: ['pawn'], minRank: 6 }));
    expect(spellTargets(fromSixth, { ...ctx, fen: '4k3/8/P7/8/8/8/1P6/4K3 w - - 0 1' }, [])).toEqual(['a6']);
  });

  it('distanza dal bersaglio precedente e caselle già scelte', () => {
    const blink = testSpell({ targets: [targetSpec('own_piece'), targetSpec('square', { maxDistance: 2 })] });
    const second = spellTargets(blink, ctx, ['b1']);
    expect(second).not.toContain('b1' satisfies Square);
    expect(second).toContain('d3' satisfies Square);
    expect(second).not.toContain('b4' satisfies Square);
    // Oltre l'ultimo passo non c'è nulla da evidenziare.
    expect(spellTargets(blink, ctx, ['b1', 'c3'])).toEqual([]);
  });

  it('un tipo sconosciuto non è supportato e non produce bersagli', () => {
    const odd = oneTarget(targetSpec('constellation'));
    expect(targetsSupported(odd)).toBe(false);
    expect(targetsSupported(testSpell({ targets: [] }))).toBe(true);
    expect(spellTargets(odd, ctx, [])).toEqual([]);
  });

  it('una FEN illeggibile non produce bersagli e non esplode', () => {
    expect(spellTargets(oneTarget(targetSpec('own_piece')), { ...ctx, fen: 'x' }, [])).toEqual([]);
  });
});
