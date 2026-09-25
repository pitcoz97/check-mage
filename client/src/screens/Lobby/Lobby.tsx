import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { Button } from '../../design/components/Button';
import { Panel } from '../../design/components/Panel';
import { Spinner } from '../../design/components/Spinner';
import { useAuth } from '../../store/AuthProvider';
import { useMatch, useMatchSession, useSessionStatus } from '../../store/MatchProvider';

/** Partita salvata da una sessione precedente (ASSUMPTIONS C11): la lobby propone di riprenderla. */
function useSavedMatch(): boolean {
  const session = useMatchSession();
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let active = true;
    void session.hasSavedMatch().then((value) => {
      if (active) setSaved(value);
    });
    return () => {
      active = false;
    };
  }, [session]);
  return saved;
}

/** Lobby: profilo compatto, CTA "Gioca" dominante, stato della coda con Annulla (briefing §7.2). */
export function Lobby() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const account = useAuth((s) => s.account);
  const session = useMatchSession();
  const lifecycle = useMatch((s) => s.lifecycle);
  const connection = useSessionStatus((s) => s.connection);
  const savedMatch = useSavedMatch();

  // La partita inizia con il primo `game_state`: da lì si gioca nella schermata dedicata.
  useEffect(() => {
    if (lifecycle === 'playing') void navigate('/match');
  }, [lifecycle, navigate]);

  const searching = lifecycle === 'queued' && connection.kind !== 'replaced' && connection.kind !== 'closed';
  const moved = lifecycle === 'queued' && connection.kind === 'replaced';

  return (
    <div className="flex flex-col items-center gap-8 py-6">
      {account !== null && (
        <Panel className="flex w-full max-w-md items-center gap-3 p-3">
          <span aria-hidden="true" className="flex size-11 items-center justify-center rounded-full bg-elevated text-20 font-bold">
            {account.username.slice(0, 1).toUpperCase()}
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-semibold">{account.username}</span>
            <span className="text-14 text-muted">{t('lobby.elo', { elo: account.elo })}</span>
          </div>
        </Panel>
      )}
      <div className="flex flex-col items-center gap-6 text-center">
        <div className="flex flex-col gap-2">
          <h1 className="text-28 font-bold">{t('lobby.title')}</h1>
          <p className="text-muted">{t('lobby.lead')}</p>
        </div>

        {savedMatch && lifecycle === 'idle' && (
          <Panel className="flex flex-col items-center gap-3 p-4">
            <p>{t('lobby.savedMatch')}</p>
            <Button onClick={() => void navigate('/match')}>{t('lobby.resumeMatch')}</Button>
          </Panel>
        )}

        {searching ? (
          <div className="flex flex-col items-center gap-4" aria-live="polite">
            <Spinner label={connection.kind === 'reconnecting' ? t('lobby.searchingReconnect') : t('lobby.searching')} />
            <Button variant="secondary" onClick={() => session.cancel()}>
              {t('lobby.cancel')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            {moved && (
              <p role="status" className="text-14 text-muted">
                {t('lobby.searchMoved')}
              </p>
            )}
            <Button size="lg" className="min-w-56" onClick={() => session.findMatch()}>
              {moved ? t('lobby.retry') : t('lobby.play')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
