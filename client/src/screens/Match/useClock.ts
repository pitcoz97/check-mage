import { useEffect, useState } from 'react';

import { phaseLimit } from '../../game/clock';
import type { Color } from '../../game/model';
import { clockRemaining } from '../../store/matchStore';
import { useMatch } from '../../store/MatchProvider';

/** Ogni quanto si ridisegna l'orologio: abbastanza per i decimi sotto i 10s, senza far lavorare troppo la UI. */
const TICK_MS = 100;

/**
 * Orologio di un giocatore col tempo per fase (`game/clock.go`): se è la sua fase, il tempo rimasto, interpolato fra
 * un `timer_update` e l'altro e sempre risincronizzato sul valore del server (briefing §8); altrimenti il tempo pieno
 * di una fase Magie, fermo (`idle`). Il client non decide mai lo scadere: aspetta `phase_timeout` e `game_over`.
 */
export function useClock(color: Color): { readonly remaining: number | null; readonly idle: boolean } {
  const sync = useMatch((s) => s.clockSync);
  const timeControl = useMatch((s) => s.game?.timeControl ?? null);
  const hasGame = useMatch((s) => s.game !== null);
  const running = useMatch((s) => s.lifecycle === 'playing' && s.clockSync?.running === true && s.clockSync.player === color);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [running, sync]);

  const remaining = clockRemaining(sync, color, running ? now : (sync?.at ?? now));
  if (remaining !== null) return { remaining, idle: false };
  return { remaining: hasGame ? phaseLimit(timeControl, 'main1') : null, idle: true };
}
