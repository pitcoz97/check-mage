import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { Challenge } from '../api/types';
import { Button } from '../design/components/Button';
import { InfoBox } from '../design/components/InfoBox';
import { Spinner } from '../design/components/Spinner';
import { useApi } from '../store/AuthProvider';
import { useMatch, useMatchSession, useSessionStatus } from '../store/MatchProvider';
import { usePresence, usePresenceState } from '../store/PresenceProvider';

/** Istante corrente, aggiornato ogni secondo: serve solo al tempo residuo delle sfide in arrivo. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/**
 * Sfide dirette in tutte le schermate della shell (F5–F7), sopra il contenuto: la sfida inviata o accettata con il suo
 * stato (in attesa, rifiutata, scaduta…) e quelle ricevute, con Accetta e Rifiuta. In partita non si mostra: la
 * shell non c'è, e chi gioca non riceve sfide.
 */
export function ChallengeBanner() {
  const { t } = useTranslation();
  const api = useApi();
  const session = useMatchSession();
  const presence = usePresence();
  const incoming = usePresenceState((s) => s.incoming);
  const receivedAt = usePresenceState((s) => s.receivedAt);
  const pending = useSessionStatus((s) => s.pending);
  const connection = useSessionStatus((s) => s.connection);
  const lifecycle = useMatch((s) => s.lifecycle);
  const now = useNow(incoming.length > 0);

  const own = pending?.kind === 'challenge' ? pending : null;
  const others = incoming.filter((c) => c.id !== own?.id);
  if (own === null && others.length === 0) return null;

  const accept = (challenge: Challenge) => {
    presence.dismiss(challenge.id);
    session.joinChallenge(challenge.id, challenge.from.username, 'accepted');
  };
  const decline = (challenge: Challenge) => {
    presence.dismiss(challenge.id);
    void api.deleteChallenge(challenge.id);
  };
  const cancelOwn = () => {
    // Chi sfida annulla anche chiudendo il socket; lo sfidato che ha accettato rifiuta, così la sfida non torna.
    if (own !== null && own.role === 'accepted') void api.deleteChallenge(own.id);
    session.cancel();
  };
  const left = (challenge: Challenge) => Math.max(0, challenge.expiresInSeconds - Math.floor((now - (receivedAt ?? now)) / 1000));

  return (
    <section aria-label={t('challenge.region')} data-challenge-banner className="mb-4 flex flex-col gap-2 lg:mb-6">
      {own !== null && <OwnChallenge name={own.opponent} role={own.role} connection={connection.kind} reason={connection.kind === 'challenge_closed' ? connection.reason : null} onCancel={cancelOwn} />}
      {others.map((challenge) => {
        const seconds = left(challenge);
        if (seconds === 0) return null;
        return (
          <InfoBox key={challenge.id} tone="arcane" role="status" data-incoming-challenge={challenge.id} className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="flex min-w-0 grow flex-col gap-0.5">
              <span className="font-bold text-primary">
                {t('challenge.incoming', { name: challenge.from.username })} <span className="font-mono text-13 text-muted">{challenge.from.elo}</span>
              </span>
              <span className="text-13 text-muted">
                {t('challenge.friendly')} · {t('challenge.expiresIn', { seconds })}
              </span>
            </span>
            <span className="flex gap-2">
              <Button size="sm" data-action="accept-challenge" disabled={lifecycle === 'playing'} onClick={() => accept(challenge)}>
                {t('challenge.accept')}
              </Button>
              <Button variant="secondary" size="sm" data-action="decline-challenge" onClick={() => decline(challenge)}>
                {t('challenge.decline')}
              </Button>
            </span>
          </InfoBox>
        );
      })}
    </section>
  );
}

/** La propria sfida: in attesa (con Annulla) oppure chiusa, col motivo e Chiudi. */
function OwnChallenge({
  name,
  role,
  connection,
  reason,
  onCancel,
}: {
  name: string;
  role: 'sent' | 'accepted';
  connection: string;
  reason: 'declined' | 'expired' | 'unavailable' | null;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const waiting = connection === 'connecting' || connection === 'open' || connection === 'reconnecting';
  if (waiting) {
    return (
      <InfoBox tone="gold" role="status" aria-live="polite" data-own-challenge="waiting" className="flex items-center gap-3">
        <span className="grow font-semibold">
          <Spinner label={role === 'sent' ? t('challenge.waiting', { name }) : t('challenge.joining', { name })} />
        </span>
        <Button variant="secondary" size="sm" onClick={onCancel}>
          {t('challenge.cancel')}
        </Button>
      </InfoBox>
    );
  }
  return (
    <InfoBox tone="danger" role="alert" data-own-challenge={reason ?? connection} className="flex flex-wrap items-center gap-3">
      <span className="grow">
        {reason !== null && t(`challenge.closed.${reason}`, { name })}
        {connection === 'replaced' && t('challenge.replaced')}
        {connection === 'deck_invalid' && (
          <>
            {t('decks.invalidDeck')}{' '}
            <Link to="/decks" className="font-bold text-gold">
              {t('decks.fixDeck')}
            </Link>
          </>
        )}
        {(connection === 'closed' || connection === 'idle' || connection === 'unauthorized') && t('challenge.closed.unavailable', { name })}
      </span>
      <Button variant="secondary" size="sm" onClick={onCancel}>
        {t('challenge.close')}
      </Button>
    </InfoBox>
  );
}
