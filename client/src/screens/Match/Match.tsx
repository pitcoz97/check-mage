import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router';

import type { Color } from '../../game/model';
import { Button } from '../../design/components/Button';
import { Panel } from '../../design/components/Panel';
import { Spinner } from '../../design/components/Spinner';
import { useMatch, useMatchSession, useSessionStatus } from '../../store/MatchProvider';
import type { GameOutcome } from '../../store/matchStore';
import { Actions } from './Actions';
import { ConnectionBanner } from './ConnectionBanner';
import { protocolErrorMessage } from './errorMessage';
import { MatchBoard } from './MatchBoard';
import { MatchLayout } from './MatchLayout';
import { MoveHistory } from './MoveHistory';
import { PhaseTrack } from './PhaseTrack';
import { PlayerPanel } from './PlayerPanel';

/**
 * Dopo un ricaricamento il client riapre la connessione solo se ricorda una partita aperta (ASSUMPTIONS C11).
 * Se il server non manda un `game_state` entro questo tempo la partita non esiste più: aprire il socket ha messo
 * l'utente in coda, quindi si chiude (uscita dalla coda) e si torna in lobby.
 */
export const RESUME_TIMEOUT_MS = 4_000;

/**
 * Ultimo avviso da mostrare: rifiuto del server, esito di un'offerta di patta, o rifiuto deciso dal client.
 * Si sceglie per progressivo, senza effetti collaterali: l'avviso più recente vince.
 */
function useNotice(): { text: string | null; show(text: string): void } {
  const { t } = useTranslation();
  const seq = useMatch((s) => s.seq);
  const lastError = useMatch((s) => s.lastError);
  const drawNotice = useMatch((s) => s.drawNotice);
  const [local, setLocal] = useState<{ text: string; seq: number } | null>(null);

  const candidates = [
    lastError === null ? null : { seq: lastError.seq, text: protocolErrorMessage(t, lastError.info) },
    drawNotice === null
      ? null
      : { seq: drawNotice.seq, text: t(drawNotice.reason === 'move_played' ? 'match.notice.drawLapsed' : 'match.notice.drawDeclined') },
    local,
  ].filter((candidate) => candidate !== null);
  const latest = candidates.sort((a, b) => a.seq - b.seq).at(-1);

  return {
    text: latest?.text ?? null,
    // Mezzo punto sopra il progressivo corrente: più recente di tutto ciò che è già arrivato dal server.
    show: (text: string) => setLocal({ text, seq: seq + 0.5 }),
  };
}

function outcomeHeadline(outcome: GameOutcome, myColor: Color | null): 'win' | 'loss' | 'draw' | 'whiteWins' | 'blackWins' | 'unknownResult' {
  if (outcome.result === '1/2-1/2') return 'draw';
  if (outcome.result === 'unknown') return 'unknownResult';
  const winner: Color = outcome.result === '1-0' ? 'white' : 'black';
  if (myColor === null) return winner === 'white' ? 'whiteWins' : 'blackWins';
  return winner === myColor ? 'win' : 'loss';
}

/** Riepilogo di fine partita: esito, motivo, ritorno alla lobby. */
function OutcomePanel({ outcome }: { outcome: GameOutcome }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const session = useMatchSession();
  const myColor = useMatch((s) => s.myColor);
  return (
    <Panel role="status" className="flex flex-col gap-3 p-4">
      <h2 className="text-lg font-bold">{t('match.over.title')}</h2>
      <p className="font-semibold">{t(`match.over.${outcomeHeadline(outcome, myColor)}`)}</p>
      <p className="text-sm text-muted">{t(`match.over.reason.${outcome.reason}`)}</p>
      <Button
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

function MatchScreen() {
  const outcome = useMatch((s) => s.outcome);
  const notice = useNotice();
  return (
    <MatchLayout
      banner={
        <>
          <ConnectionBanner />
          {notice.text !== null && outcome === null && (
            <p role="status" aria-live="polite" className="bg-elevated px-4 py-2 text-center text-sm">
              {notice.text}
            </p>
          )}
        </>
      }
      opponent={<PlayerPanel side="opponent" />}
      board={<MatchBoard onRefused={notice.show} />}
      phases={<PhaseTrack />}
      history={<MoveHistory />}
      actions={outcome === null ? <Actions /> : <OutcomePanel outcome={outcome} />}
      self={<PlayerPanel side="self" />}
      hand={<HandPlaceholder />}
    />
  );
}

/** Segnaposto della mano: il conteggio arriva dal server, le carte vere arrivano allo Step 5. */
function HandPlaceholder() {
  const { t } = useTranslation();
  const count = useMatch((s) => s.hand.length);
  return (
    <Panel className="flex min-h-[var(--hit-target)] items-center gap-2 px-3 py-2 text-sm text-muted">
      <span>{t('match.hand')}</span>
      <span data-hand-count>{count}</span>
    </Panel>
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
    <div className="safe-area flex min-h-full flex-col">
      <ConnectionBanner />
      <div className="flex flex-1 items-center justify-center">
        <Spinner label={t('match.joining')} />
      </div>
    </div>
  );
}
