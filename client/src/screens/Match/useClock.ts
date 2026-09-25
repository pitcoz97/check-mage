import { useEffect, useState } from 'react';

import type { Color } from '../../game/model';
import { clockRemaining } from '../../store/matchStore';
import { useMatch } from '../../store/MatchProvider';

/** Ogni quanto si ridisegna l'orologio: abbastanza per i decimi sotto i 10s, senza far lavorare troppo la UI. */
const TICK_MS = 100;

/**
 * Tempo residuo di un giocatore, interpolato fra un `timer_update` e l'altro e sempre risincronizzato sul valore
 * del server (briefing §8). Il client non decide mai la fine della partita: aspetta `game_over`.
 */
export function useClock(color: Color): number | null {
  const sync = useMatch((s) => s.clockSync);
  const running = useMatch((s) => s.lifecycle === 'playing' && s.clockSync?.turn === color);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [running, sync]);

  return clockRemaining(sync, color, running ? now : (sync?.at ?? now));
}
