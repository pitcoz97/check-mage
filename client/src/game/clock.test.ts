import { describe, expect, it } from 'vitest';

import { formatClock, isLowTime, phaseLimit } from './clock';

describe('formatClock', () => {
  it('minuti e secondi sopra i 10 secondi', () => {
    expect(formatClock(600_000)).toBe('10:00');
    expect(formatClock(599_500)).toBe('9:59');
    expect(formatClock(61_000)).toBe('1:01');
    expect(formatClock(10_000)).toBe('0:10');
  });

  it('decimi sotto i 10 secondi, mai valori negativi', () => {
    expect(formatClock(9_900)).toBe('9.9');
    expect(formatClock(1_050)).toBe('1.0');
    expect(formatClock(0)).toBe('0.0');
    expect(formatClock(-500)).toBe('0.0');
  });

  it('tempo della fase agli sgoccioli sotto i 15 secondi', () => {
    expect(isLowTime(14_999)).toBe(true);
    expect(isLowTime(15_000)).toBe(false);
  });

  it('tempo pieno di una fase: la Mossa ha il suo; senza time control i valori di default', () => {
    expect(phaseLimit({ mainMs: 60_000, moveMs: 100_000 }, 'main2')).toBe(60_000);
    expect(phaseLimit({ mainMs: 60_000, moveMs: 100_000 }, 'move')).toBe(100_000);
    expect(phaseLimit(null, 'move')).toBe(120_000);
    expect(phaseLimit(null, 'main1')).toBe(90_000);
  });
});
