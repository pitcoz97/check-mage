import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../design/components/Button';
import { RECONNECT_WINDOW_MS } from '../../store/matchSession';
import { useMatchSession, useSessionStatus } from '../../store/MatchProvider';

/** Pillola galleggiante in alto al centro: sta sopra la partita e non la sposta (D20). */
const PILL = 'mt-2 flex max-w-[min(560px,calc(100vw-24px))] items-center justify-center gap-3 rounded-12 px-4 py-2.5 text-center text-14 font-semibold tabular-nums';

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
      <div role="status" aria-live="polite" data-banner="reconnecting" className={`${PILL} bg-panel shadow-card shadow-ring-gold`}>
        <span aria-hidden="true" className="size-4 shrink-0 animate-spin rounded-full border-2 border-subtle border-t-gold" />
        <span>{seconds > 0 ? t('match.connection.reconnecting', { seconds }) : t('match.connection.reconnectingLate')}</span>
      </div>
    );
  }
  if (connection.kind === 'replaced') {
    return (
      <div role="alert" data-banner="replaced" className={`${PILL} flex-wrap bg-panel shadow-card shadow-ring-gold`}>
        <span>{t('match.connection.replaced')}</span>
        <Button variant="gold" size="sm" onClick={() => session.resume()}>
          {t('match.connection.resumeHere')}
        </Button>
      </div>
    );
  }
  if (connection.kind === 'unauthorized') {
    return (
      <div role="alert" data-banner="unauthorized" className={`${PILL} bg-danger-surface text-on-danger shadow-card`}>
        {t('match.connection.unauthorized')}
      </div>
    );
  }
  return null;
}
