import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../design/components/Button';
import { Panel } from '../../design/components/Panel';
import { useMatch, useMatchSession, useSessionStatus } from '../../store/MatchProvider';

/**
 * Azioni della partita. Il server accetta `pass_phase` solo in `draw`, `main1` e `main2` del giocatore attivo
 * (`phase/actions.go`), mentre resa e patta valgono sempre: i controlli si disabilitano, non si nascondono.
 */
const PASSABLE_PHASES = ['draw', 'main1', 'main2'];

export function Actions() {
  const { t } = useTranslation();
  const session = useMatchSession();
  const myColor = useMatch((s) => s.myColor);
  const phase = useMatch((s) => s.game?.phase ?? null);
  const activePlayer = useMatch((s) => s.game?.activePlayer ?? null);
  const drawOffer = useMatch((s) => s.drawOffer);
  const playing = useMatch((s) => s.lifecycle === 'playing');
  const connected = useSessionStatus((s) => s.connection.kind === 'open');
  const [confirmResign, setConfirmResign] = useState(false);

  const canAct = playing && connected;
  const myTurn = myColor !== null && activePlayer === myColor;
  const canPass = canAct && myTurn && phase !== null && PASSABLE_PHASES.includes(phase);

  if (drawOffer.incoming) {
    return (
      <Panel role="group" aria-label={t('match.actions')} className="flex flex-wrap items-center gap-2 p-3">
        <span className="text-sm">{t('match.action.drawIncoming')}</span>
        <Button disabled={!canAct} onClick={() => session.send({ type: 'draw_accepted' })}>
          {t('match.action.accept')}
        </Button>
        <Button variant="secondary" disabled={!canAct} onClick={() => session.send({ type: 'draw_declined' })}>
          {t('match.action.decline')}
        </Button>
      </Panel>
    );
  }

  return (
    <Panel role="group" aria-label={t('match.actions')} className="flex flex-wrap items-center gap-2 p-3">
      <Button disabled={!canPass} onClick={() => session.send({ type: 'pass_phase' })}>
        {t('match.action.pass')}
      </Button>
      <Button variant="secondary" disabled={!canAct || drawOffer.outgoing} onClick={() => session.send({ type: 'draw_offer' })}>
        {t(drawOffer.outgoing ? 'match.action.drawPending' : 'match.action.offerDraw')}
      </Button>
      {confirmResign ? (
        <>
          <span className="text-sm">{t('match.action.resignConfirm')}</span>
          <Button
            variant="danger"
            onClick={() => {
              setConfirmResign(false);
              session.send({ type: 'resign' });
            }}
          >
            {t('match.action.resignYes')}
          </Button>
          <Button variant="secondary" onClick={() => setConfirmResign(false)}>
            {t('match.action.cancel')}
          </Button>
        </>
      ) : (
        <Button variant="danger" disabled={!canAct} onClick={() => setConfirmResign(true)}>
          {t('match.action.resign')}
        </Button>
      )}
    </Panel>
  );
}
