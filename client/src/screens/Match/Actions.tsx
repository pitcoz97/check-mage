import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../design/components/Button';
import { InfoBox } from '../../design/components/InfoBox';
import type { Phase } from '../../game/model';
import { useMatch, useMatchSession, useSessionStatus } from '../../store/MatchProvider';

/**
 * Azioni della partita. Il server accetta `pass_phase` solo in `draw`, `main1` e `main2` del giocatore attivo
 * (`phase/actions.go`), mentre resa e patta valgono sempre: i controlli si disabilitano, non si nascondono.
 */
const PASSABLE_PHASES: readonly Phase[] = ['draw', 'main1', 'main2'];

/** La fase in cui porta il passaggio: l'etichetta della CTA la nomina, come nella tavola ("Passa alla fase Mossa"). */
const NEXT_PHASE: Partial<Record<Phase, Phase>> = { draw: 'main1', main1: 'move' };

interface PassState {
  readonly enabled: boolean;
  readonly label: string;
  readonly short: string;
}

function usePassState(): PassState {
  const { t } = useTranslation();
  const myColor = useMatch((s) => s.myColor);
  const reported = useMatch((s) => s.game?.phase ?? 'unknown');
  const phase: Phase | null = reported === 'unknown' ? null : reported;
  const activePlayer = useMatch((s) => s.game?.activePlayer ?? null);
  const playing = useMatch((s) => s.lifecycle === 'playing');
  const connected = useSessionStatus((s) => s.connection.kind === 'open');

  const myTurn = myColor !== null && activePlayer === myColor;
  const enabled = playing && connected && myTurn && phase !== null && PASSABLE_PHASES.includes(phase);
  if (!myTurn) return { enabled, label: t('match.action.waitOpponent'), short: t('match.action.short.wait') };
  const next = phase === null ? undefined : NEXT_PHASE[phase];
  if (next !== undefined) {
    const short = t(phase === 'draw' ? 'match.action.short.draw' : 'match.action.short.main1');
    return { enabled, label: t('match.action.nextPhase', { phase: t(`match.phase.${next}`) }), short };
  }
  if (phase === 'main2') return { enabled, label: t('match.action.endTurn'), short: t('match.action.short.main2') };
  if (phase === 'move') return { enabled, label: t('match.action.mustMove'), short: t('match.action.short.move') };
  return { enabled, label: t('match.action.pass'), short: t('match.action.pass') };
}

function Arrow({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

/**
 * CTA verde della fase: grande nella colonna laterale (60px, "Passa alla fase Mossa →"), compatta accanto alle fasi
 * su Android ("Mossa →", con l'etichetta completa per i lettori di schermo).
 */
export function PassButton({ compact = false }: { compact?: boolean }) {
  const session = useMatchSession();
  const pass = usePassState();
  if (compact) {
    return (
      <Button
        data-action="pass"
        aria-label={pass.label}
        disabled={!pass.enabled}
        onClick={() => session.send({ type: 'pass_phase' })}
        size="compact"
        className="shrink-0 gap-1.5"
      >
        {pass.short}
        <Arrow className="size-4" />
      </Button>
    );
  }
  return (
    <Button data-action="pass" size="action" fullWidth disabled={!pass.enabled} onClick={() => session.send({ type: 'pass_phase' })} className="gap-2.5">
      {pass.label}
      <Arrow className="size-5" />
    </Button>
  );
}

/**
 * Patta e resa, affiancate (44px). L'offerta ricevuta e la conferma della resa non sono nelle tavole: stanno nel
 * box incassato, con l'anello viola (una scelta da fare) o del pericolo (D20).
 */
export function SecondaryActions() {
  const { t } = useTranslation();
  const session = useMatchSession();
  const drawOffer = useMatch((s) => s.drawOffer);
  const playing = useMatch((s) => s.lifecycle === 'playing');
  const connected = useSessionStatus((s) => s.connection.kind === 'open');
  const [confirmResign, setConfirmResign] = useState(false);
  const canAct = playing && connected;

  if (drawOffer.incoming) {
    return (
      <InfoBox tone="arcane" role="group" aria-label={t('match.actions')} data-draw-offer className="flex flex-col gap-2.5">
        <p className="flex items-center gap-2.5 font-bold">
          <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-8 bg-arcane-deep font-display text-15 text-arcane-pale">
            ½
          </span>
          {t('match.action.drawIncoming')}
        </p>
        <div className="flex gap-2.5">
          <Button fullWidth disabled={!canAct} onClick={() => session.send({ type: 'draw_accepted' })} size="sm">
            {t('match.action.accept')}
          </Button>
          <Button variant="secondary" fullWidth disabled={!canAct} onClick={() => session.send({ type: 'draw_declined' })} size="sm">
            {t('match.action.decline')}
          </Button>
        </div>
      </InfoBox>
    );
  }

  if (confirmResign) {
    return (
      <InfoBox tone="danger" role="group" aria-label={t('match.actions')} data-resign-confirm className="flex flex-col gap-2.5">
        <p className="font-bold">{t('match.action.resignConfirm')}</p>
        <div className="flex gap-2.5">
          <Button
            variant="danger"
            fullWidth
            onClick={() => {
              setConfirmResign(false);
              session.send({ type: 'resign' });
            }}
            size="sm"
          >
            {t('match.action.resignYes')}
          </Button>
          <Button variant="secondary" fullWidth onClick={() => setConfirmResign(false)} size="sm">
            {t('match.action.cancel')}
          </Button>
        </div>
      </InfoBox>
    );
  }

  return (
    <div role="group" aria-label={t('match.actions')} className="flex gap-2.5">
      <Button
        variant="secondary"
        fullWidth
        disabled={!canAct || drawOffer.outgoing}
        onClick={() => session.send({ type: 'draw_offer' })}
        size="sm"
      >
        {t(drawOffer.outgoing ? 'match.action.drawPending' : 'match.action.offerDraw')}
      </Button>
      <Button variant="secondary" fullWidth disabled={!canAct} onClick={() => setConfirmResign(true)} size="sm">
        {t('match.action.resign')}
      </Button>
    </div>
  );
}
