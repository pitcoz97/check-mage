import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router';

import { Hand } from '../../game/hand/Hand';
import type { AppliedEffect, Color, Square } from '../../game/model';
import { Button } from '../../design/components/Button';
import { Panel } from '../../design/components/Panel';
import { Spinner } from '../../design/components/Spinner';
import { useCatalog } from '../../spells/CatalogProvider';
import { cardRefusalMessage } from '../../spells/playability';
import { useMatch, useMatchSession, useSessionStatus } from '../../store/MatchProvider';
import type { GameOutcome } from '../../store/matchStore';
import { MatchRail } from '../../app/Navigation';
import { StatePage } from '../../app/StatePage';
import { PassButton, SecondaryActions } from './Actions';
import { ConnectionBanner } from './ConnectionBanner';
import { HintBox } from './HintBox';
import { ManaPanel } from './ManaPanel';
import { MatchBoard } from './MatchBoard';
import { MatchLayout } from './MatchLayout';
import { MatchBottomBar } from './MatchSheet';
import { PlayerRow } from './PlayerRow';
import { SideTabs } from './SideTabs';
import { PhasePills, TurnPanel } from './TurnPanel';
import { useCasting, type Casting } from './useCasting';
import { useNotice } from './useNotice';

/**
 * Dopo un ricaricamento il client riapre la connessione solo se ricorda una partita aperta (ASSUMPTIONS C11).
 * Se il server non manda un `game_state` entro questo tempo la partita non esiste più: aprire il socket ha messo
 * l'utente in coda, quindi si chiude (uscita dalla coda) e si torna in lobby.
 */
export const RESUME_TIMEOUT_MS = 4_000;

/** Durata del lampeggio sulle caselle toccate da una magia. */
const SPELL_FLASH_MS = 1_200;

function outcomeHeadline(outcome: GameOutcome, myColor: Color | null): 'win' | 'loss' | 'draw' | 'whiteWins' | 'blackWins' | 'unknownResult' {
  if (outcome.result === '1/2-1/2') return 'draw';
  if (outcome.result === 'unknown') return 'unknownResult';
  const winner: Color = outcome.result === '1-0' ? 'white' : 'black';
  if (myColor === null) return winner === 'white' ? 'whiteWins' : 'blackWins';
  return winner === myColor ? 'win' : 'loss';
}

type Headline = ReturnType<typeof outcomeHeadline>;

/** Banda dell'esito: verde vittoria, rosso sconfitta, oro patta, spenta se l'esito non si conosce. */
const OUTCOME_BAND: Record<Headline, string> = {
  win: 'bg-play',
  loss: 'bg-danger',
  draw: 'bg-gold',
  whiteWins: 'bg-gold',
  blackWins: 'bg-gold',
  unknownResult: 'bg-quiet',
};

/**
 * Riepilogo di fine partita: esito, motivo, ritorno alla home. Non è nelle tavole (D20): card Pietra con la banda del
 * colore dell'esito e il titolo in Cinzel. Sta al posto delle azioni, così la posizione finale resta visibile.
 */
function OutcomePanel({ outcome }: { outcome: GameOutcome }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const session = useMatchSession();
  const myColor = useMatch((s) => s.myColor);
  const headline = outcomeHeadline(outcome, myColor);
  return (
    <Panel role="status" data-outcome={headline} className="flex flex-col gap-3 overflow-hidden rounded-16 p-5 pt-0">
      <span aria-hidden="true" className={`-mx-5 mb-2 block h-1.5 ${OUTCOME_BAND[headline]}`} />
      <h2 className="text-12 font-extrabold tracking-label text-muted uppercase">{t('match.over.title')}</h2>
      <p className="font-display text-28 leading-tight font-bold tracking-[0.02em]">{t(`match.over.${headline}`)}</p>
      <p className="text-14 text-tertiary">{t(`match.over.reason.${outcome.reason}`)}</p>
      <Button
        size="lg"
        fullWidth
        onClick={() => {
          session.leave();
          void navigate('/lobby');
        }}
      >
        {t('match.over.backToLobby')}
      </Button>
    </Panel>
  );
}

/**
 * Caselle toccate dall'ultima magia: pulsano per un attimo, poi si spengono. Solo feedback grafico, nessuno stato
 * di gioco (il server ha già mandato tutto quello che conta).
 */
function useSpellFlash(): readonly Square[] {
  const lastCast = useMatch((s) => s.lastCast);
  const seq = lastCast?.seq ?? 0;
  /** Progressivo della magia il cui lampeggio è già finito. */
  const [faded, setFaded] = useState(0);

  useEffect(() => {
    if (seq === 0 || faded === seq) return;
    const timer = setTimeout(() => setFaded(seq), SPELL_FLASH_MS);
    return () => clearTimeout(timer);
  }, [seq, faded]);

  if (lastCast === null || faded === seq) return [];
  return [...lastCast.targets, ...lastCast.effects.flatMap(effectSquares)];
}

/** Caselle dichiarate da un effetto: il client anima quello che dice il server, non lo ricalcola (G8). */
function effectSquares(effect: AppliedEffect): Square[] {
  if ('target' in effect) return [effect.target];
  if ('from' in effect) return [effect.from, effect.to];
  return [];
}

/** La mano del giocatore, con il catalogo caricato all'ingresso in partita. */
function PlayerHand({ casting, onRefused }: { casting: Casting; onRefused(message: string): void }) {
  const { t } = useTranslation();
  const byId = useCatalog((s) => s.byId);
  const loading = useCatalog((s) => s.status !== 'ready');
  const hand = useMatch((s) => s.hand);
  const myColor = useMatch((s) => s.myColor);
  const mana = useMatch((s) => (s.myColor === null ? null : (s.game?.mana[s.myColor] ?? null)));
  const phase = useMatch((s) => s.game?.phase ?? 'unknown');
  const activePlayer = useMatch((s) => s.game?.activePlayer ?? null);
  const playing = useMatch((s) => s.lifecycle === 'playing');
  const castPending = useMatch((s) => s.pendingCast !== null);
  const connected = useSessionStatus((s) => s.connection.kind === 'open');

  return (
    <Hand
      cards={hand}
      spellOf={(spellId) => byId.get(spellId)}
      context={{
        playing,
        connected,
        myTurn: myColor !== null && activePlayer === myColor,
        phase,
        mana: mana?.current ?? 0,
        castPending,
      }}
      selectedInstanceId={casting.selectedInstanceId}
      loading={loading}
      onPick={casting.pick}
      onCancel={casting.cancel}
      // La carta spenta non porta scritto il motivo (D5): lo dice il tocco.
      onRefused={(refusal, spell) => onRefused(cardRefusalMessage(t, refusal, spell))}
    />
  );
}

function MatchScreen() {
  const outcome = useMatch((s) => s.outcome);
  const { notice, show, dismiss } = useNotice();
  const targeting = useCasting(show);
  // Scegliere una carta porta l'istruzione del bersaglio nel box: un avviso precedente lascia il posto.
  const casting: Casting = {
    ...targeting,
    pick: (card, spell) => {
      dismiss();
      targeting.pick(card, spell);
    },
  };
  const flash = useSpellFlash();
  return (
    <MatchLayout
      nav={<MatchRail />}
      banner={<ConnectionBanner />}
      opponent={<PlayerRow side="opponent" />}
      board={<MatchBoard onRefused={show} targeting={casting.boardTargeting} flash={flash} />}
      self={<PlayerRow side="self" />}
      hand={
        outcome === null ? (
          <PlayerHand casting={casting} onRefused={show} />
        ) : (
          <div className="px-3 lg:hidden">
            <OutcomePanel outcome={outcome} />
          </div>
        )
      }
      turn={<TurnPanel hint={<HintBox casting={casting} notice={notice} variant="panel" />} />}
      mana={<ManaPanel />}
      tabs={<SideTabs className="grow" />}
      actions={
        outcome === null ? (
          <>
            <PassButton />
            <SecondaryActions />
          </>
        ) : (
          <OutcomePanel outcome={outcome} />
        )
      }
      phasesCompact={
        <>
          <PhasePills compact />
          <PassButton compact />
        </>
      }
      hintLine={<HintBox casting={casting} notice={notice} variant="line" />}
      bottomBar={<MatchBottomBar />}
    />
  );
}

type ResumeState = 'checking' | 'resuming' | 'none';

/**
 * Accesso alla schermata di partita: con una partita in corso la mostra; dopo un ricaricamento riprende quella
 * salvata; altrimenti rimanda alla lobby, perché aprire il socket senza partita metterebbe l'utente in coda.
 */
export function Match() {
  const { t } = useTranslation();
  const session = useMatchSession();
  const lifecycle = useMatch((s) => s.lifecycle);
  const connection = useSessionStatus((s) => s.connection.kind);
  const [resume, setResume] = useState<ResumeState>(lifecycle === 'idle' ? 'checking' : 'none');

  useEffect(() => {
    if (resume !== 'checking') return;
    let active = true;
    void session.hasSavedMatch().then((saved) => {
      if (!active) return;
      if (saved) session.resume();
      setResume(saved ? 'resuming' : 'none');
    });
    return () => {
      active = false;
    };
  }, [resume, session]);

  // Socket aperto ma nessuno stato di partita: la partita salvata non esiste più.
  useEffect(() => {
    if (resume !== 'resuming' || lifecycle !== 'idle' || connection !== 'open') return;
    const timer = setTimeout(() => {
      session.leave();
      setResume('none');
    }, RESUME_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [resume, lifecycle, connection, session]);

  if (lifecycle === 'playing' || lifecycle === 'over') return <MatchScreen />;
  if (lifecycle === 'queued' || resume === 'none') return <Navigate to="/lobby" replace />;
  return (
    <>
      <div className="fixed inset-x-0 top-[env(safe-area-inset-top,0px)] z-50 flex justify-center">
        <ConnectionBanner />
      </div>
      <StatePage>
        <Spinner label={t('match.joining')} />
      </StatePage>
    </>
  );
}
