/**
 * Formattazione degli orologi. Il valore arriva dal server (`timer_update`) e viene interpolato fra un
 * aggiornamento e l'altro (`clockRemaining` nel matchStore): qui si trasforma solo in testo.
 */

const MINUTE = 60_000;
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

/** `true` quando il tempo sta finendo: la UI lo evidenzia. */
export function isLowTime(ms: number): boolean {
  return ms < MINUTE;
}
