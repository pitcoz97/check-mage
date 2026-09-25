import { describe, expect, it } from 'vitest';

import { crystalStates, MANA_CAP } from './manaCap';

/** Rombi del mana: acceso, speso, bloccato (tavole della partita). */
describe('crystalStates', () => {
  it('4 su 8: quattro accesi, quattro spesi, due bloccati', () => {
    expect(crystalStates(4, 8)).toEqual(['on', 'on', 'on', 'on', 'spent', 'spent', 'spent', 'spent', 'locked', 'locked']);
  });

  it('sempre dieci rombi, anche col mana sopra il massimo del turno', () => {
    expect(crystalStates(3, 2)).toEqual(['on', 'on', 'on', ...Array<string>(7).fill('locked')]);
    expect(crystalStates(0, 0)).toHaveLength(MANA_CAP);
    expect(crystalStates(12, 10).every((state) => state === 'on')).toBe(true);
  });
});
