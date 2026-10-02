import type { Phase, TimeControl } from './model';

/**
 * Orologi della partita: tempo per fase (`game/clock.go`). Il valore arriva dal server (`timer_update`) e viene
 * interpolato fra un aggiornamento e l'altro (`clockRemaining` nel matchStore): qui si trasforma solo in testo e si
 * sceglie il tempo pieno di una fase.
 */

/** Tempi per fase quando il server non li manda (ASSUMPTIONS T2): Magie 90 s, Mossa 120 s. */
export const DEFAULT_TIME_CONTROL: TimeControl = { mainMs: 90_000, moveMs: 120_000 };

/** Fasi Magie scadute di fila che fanno perdere (`MaxStrikes`, `game/clock.go`). */
export const MAX_STRIKES = 3;

/** Sotto questa soglia il tempo della fase sta finendo: la UI lo evidenzia. */
export const LOW_TIME_MS = 15_000;

/** Tempo pieno di una fase: la Mossa ha il suo, ogni altra fase quello delle Magie. */
export function phaseLimit(timeControl: TimeControl | null, phase: Phase | 'unknown'): number {
  const tc = timeControl ?? DEFAULT_TIME_CONTROL;
  return phase === 'move' ? tc.moveMs : tc.mainMs;
}
/** Sotto i dieci secondi si mostrano i decimi, come sui portali di scacchi. */
export const TENTHS_UNDER_MS = 10_000;

export function formatClock(ms: number): string {
  const safe = Math.max(0, ms);
  if (safe < TENTHS_UNDER_MS) {
    const seconds = Math.floor(safe / 1000);
    const tenths = Math.floor((safe % 1000) / 100);
    return `${seconds}.${tenths}`;
  }
  const totalSeconds = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** `true` quando il tempo della fase sta finendo. */
export function isLowTime(ms: number): boolean {
  return ms < LOW_TIME_MS;
}
