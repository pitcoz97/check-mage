import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router';

import type { Color } from '../../game/model';
import { Button } from '../../design/components/Button';
import { Panel } from '../../design/components/Panel';
import { Spinner } from '../../design/components/Spinner';
import { useMatch, useMatchSession, useSessionStatus } from '../../store/MatchProvider';
import type { GameOutcome } from '../../store/matchStore';
import { ConnectionBanner } from './ConnectionBanner';
import { MatchLayout } from './MatchLayout';

const FILES = 8;

/**
 * Dopo un ricaricamento il client riapre la connessione solo se ricorda una partita aperta (ASSUMPTIONS C11).
 * Se il server non manda un `game_state` entro questo tempo la partita non esiste più: aprire il socket ha messo
 * l'utente in coda, quindi si chiude (uscita dalla coda) e si torna in lobby.
 */
export const RESUME_TIMEOUT_MS = 4_000;

/** Scacchiera segnaposto: griglia statica con i colori dei token, senza pezzi né logica (sostituita allo Step 4). */
function BoardPlaceholder() {
  const { t } = useTranslation();
  const squares = Array.from({ length: FILES * FILES }, (_, i) => {
    const light = (Math.floor(i / FILES) + (i % FILES)) % 2 === 0;
    return <div key={i} className={light ? 'bg-board-light' : 'bg-board-dark'} />;
  });
  return (
    <div role="img" aria-label={t('match.board')} className="grid h-full w-full grid-cols-8 grid-rows-8 overflow-hidden rounded-sm">
      {squares}
    </div>
  );
}

function Region({ title, detail }: { title: string; detail?: string }) {
  return (
    <Panel className="flex min-h-[var(--hit-target)] items-center justify-between gap-2 px-3 py-2">
      <h2 className="text-sm font-semibold text-muted">{title}</h2>
      {detail !== undefined && <span className="truncate text-sm">{detail}</span>}
    </Panel>
  );
}

/** Pannello di un giocatore: per ora solo nome e colore, dallo stato del server (Step 4: timer, mana, carte). */
function PlayerRegion({ side }: { side: 'self' | 'opponent' }) {
  const { t } = useTranslation();
  const players = useMatch((s) => s.game?.players ?? null);
  const myColor = useMatch((s) => s.myColor);
  const color: Color | null = myColor === null ? null : side === 'self' ? myColor : myColor === 'white' ? 'black' : 'white';
  const name = color === null || players === null ? undefined : players[color].username;
  const colorLabel = color === null ? undefined : color === 'white' ? t('match.colorWhite') : t('match.colorBlack');
  return (
    <Region
      title={side === 'self' ? t('match.you') : t('match.opponent')}
      {...(name === undefined ? {} : { detail: colorLabel === undefined ? name : `${name} · ${colorLabel}` })}
    />
  );
}

function outcomeHeadline(outcome: GameOutcome, myColor: Color | null): 'win' | 'loss' | 'draw' | 'whiteWins' | 'blackWins' | 'unknownResult' {
  if (outcome.result === '1/2-1/2') return 'draw';
  if (outcome.result === 'unknown') return 'unknownResult';
  const winner: Color = outcome.result === '1-0' ? 'white' : 'black';
  if (myColor === null) return winner === 'white' ? 'whiteWins' : 'blackWins';
  return winner === myColor ? 'win' : 'loss';
}

/** Fine partita testuale (lo Step 4 ne farà il riepilogo completo). */
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
  const { t } = useTranslation();
  const outcome = useMatch((s) => s.outcome);
  return (
    <MatchLayout
      banner={<ConnectionBanner />}
      opponent={<PlayerRegion side="opponent" />}
      board={<BoardPlaceholder />}
      phases={<Region title={t('match.phases')} />}
      history={<Region title={t('match.history')} />}
      actions={outcome === null ? <Region title={t('match.actions')} /> : <OutcomePanel outcome={outcome} />}
      self={<PlayerRegion side="self" />}
      hand={<Region title={t('match.hand')} />}
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
    <div className="safe-area flex min-h-full flex-col">
      <ConnectionBanner />
      <div className="flex flex-1 items-center justify-center">
        <Spinner label={t('match.joining')} />
      </div>
    </div>
  );
}
