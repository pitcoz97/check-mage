import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../design/components/Button';
import { RECONNECT_WINDOW_MS } from '../../store/matchSession';
import { useMatchSession, useSessionStatus } from '../../store/MatchProvider';

/** Ora corrente aggiornata ogni secondo, solo mentre serve (countdown). */
function useTicker(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/**
 * Stato della connessione durante la partita (briefing §8): riconnessione con il tempo residuo della finestra di
 * rientro (ASSUMPTIONS C12), partita aperta altrove (chiusura 4001) con "Riprendi qui", sessione scaduta.
 */
export function ConnectionBanner() {
  const { t } = useTranslation();
  const session = useMatchSession();
  const connection = useSessionStatus((s) => s.connection);
  const since =
    connection.kind === 'reconnecting' || (connection.kind === 'connecting' && connection.since !== null) ? connection.since : null;
  const now = useTicker(since !== null);

  if (since !== null) {
    const seconds = Math.ceil((RECONNECT_WINDOW_MS - Math.max(0, now - since)) / 1_000);
    return (
      <div role="status" aria-live="polite" className="bg-elevated px-4 py-2 text-center text-14 font-semibold text-accent">
        {seconds > 0 ? t('match.connection.reconnecting', { seconds }) : t('match.connection.reconnectingLate')}
      </div>
    );
  }
  if (connection.kind === 'replaced') {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-center gap-3 bg-elevated px-4 py-2 text-14">
        <span>{t('match.connection.replaced')}</span>
        <Button variant="secondary" onClick={() => session.resume()}>
          {t('match.connection.resumeHere')}
        </Button>
      </div>
    );
  }
  if (connection.kind === 'unauthorized') {
    return (
      <div role="alert" className="bg-elevated px-4 py-2 text-center text-14 text-danger">
        {t('match.connection.unauthorized')}
      </div>
    );
  }
  return null;
}
