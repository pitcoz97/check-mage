import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router';

import { Hand } from '../../game/hand/Hand';
import type { AppliedEffect, Color, Square } from '../../game/model';
import { Button } from '../../design/components/Button';
import { Panel } from '../../design/components/Panel';
import { Spinner } from '../../design/components/Spinner';
import { useCatalog } from '../../spells/CatalogProvider';
import { effectPresentation } from '../../spells/effects.registry';
import { useMatch, useMatchSession, useSessionStatus } from '../../store/MatchProvider';
import type { GameOutcome } from '../../store/matchStore';
import { useCasting, type Casting } from './useCasting';
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

/** Durata del lampeggio sulle caselle toccate da una magia. */
const SPELL_FLASH_MS = 1_200;

/**
 * Ultimo avviso da mostrare: rifiuto del server, esito di un'offerta di patta, o rifiuto deciso dal client.
 * Si sceglie per progressivo, senza effetti collaterali: l'avviso più recente vince.
 */
function useNotice(): { text: string | null; show(text: string): void } {
  const { t } = useTranslation();
  const seq = useMatch((s) => s.seq);
  const lastError = useMatch((s) => s.lastError);
  const drawNotice = useMatch((s) => s.drawNotice);
  const lastCast = useMatch((s) => s.lastCast);
  const myColor = useMatch((s) => s.myColor);
  const byId = useCatalog((s) => s.byId);
  const [local, setLocal] = useState<{ text: string; seq: number } | null>(null);

  const candidates = [
    lastError === null ? null : { seq: lastError.seq, text: protocolErrorMessage(t, lastError.info) },
    lastCast === null
      ? null
      : {
          seq: lastCast.seq,
          text: t(lastCast.player === myColor ? 'spells.castByYou' : 'spells.castByOpponent', {
            name: byId.get(lastCast.spellId)?.name ?? lastCast.spellId,
            effects: lastCast.effects.map((effect) => effectPresentation(effect.kind).label(t)).join(', '),
          }),
        },
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
function PlayerHand({ casting }: { casting: Casting }) {
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
    />
  );
}

/** Barra della modalità targeting: cosa si sta lanciando, cosa scegliere, come annullare. */
function TargetingBar({ casting }: { casting: Casting }) {
  const { t } = useTranslation();
  if (casting.spellName === null) return null;
  return (
    <Panel role="status" data-targeting className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
      <span className="font-semibold">{t('spells.targeting.title', { name: casting.spellName })}</span>
      <span className="text-muted">{casting.prompt}</span>
      <Button variant="secondary" className="ml-auto" onClick={casting.cancel}>
        {t('spells.targeting.cancel')}
      </Button>
      <span className="text-xs text-muted">{t('spells.targeting.cancelHint')}</span>
    </Panel>
  );
}

function MatchScreen() {
  const outcome = useMatch((s) => s.outcome);
  const notice = useNotice();
  const casting = useCasting(notice.show);
  const flash = useSpellFlash();
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
      board={<MatchBoard onRefused={notice.show} targeting={casting.boardTargeting} flash={flash} />}
      phases={<PhaseTrack />}
      history={<MoveHistory />}
      actions={
        outcome === null ? (
          <>
            <TargetingBar casting={casting} />
            <Actions />
          </>
        ) : (
          <OutcomePanel outcome={outcome} />
        )
      }
      self={<PlayerPanel side="self" />}
      hand={outcome === null ? <PlayerHand casting={casting} /> : null}
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
