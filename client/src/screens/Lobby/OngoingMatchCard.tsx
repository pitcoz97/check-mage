import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { formatClock } from '../../game/clock';
import { MiniBoard } from '../../game/board/MiniBoard';
import type { Color, PlayedMove, Square } from '../../game/model';
import { useMatch } from '../../store/MatchProvider';
import { useClock } from '../Match/useClock';

/**
 * "Partita in corso" della home (REDESIGN_PLAN.md F14, D13): la partita continua in background mentre si naviga, e
 * da qui si riprende. Con la sessione collegata mostra avversario, di chi è il turno, il proprio orologio (Android) e
 * la miniatura live; dopo un ricaricamento il client sa solo che una partita esiste (ASSUMPTIONS C11), quindi la card
 * lo dice e basta.
 */

/** Ultima mossa dalla notazione UCI del server, per evidenziarla nella miniatura (lettura, nessuna regola). */
function lastMoveOf(moves: readonly PlayedMove[]): { from: Square; to: Square } | null {
  const last = moves.at(-1);
  if (last === undefined || last.kind !== 'move') return null;
  return { from: last.uci.slice(0, 2) as Square, to: last.uci.slice(2, 4) as Square };
}

function ResumeLink({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  return (
    <Link
      to="/match"
      className={`flex h-10 shrink-0 items-center rounded-10 bg-play font-extrabold text-on-play shadow-edge-play hover:brightness-110 ${
        compact ? 'px-3.5 text-14' : 'px-4 text-15'
      }`}
    >
      {t('home.resume')}
    </Link>
  );
}

function LiveClock({ color }: { color: Color }) {
  const remaining = useClock(color);
  return <>{remaining === null ? '—' : formatClock(remaining)}</>;
}

export function OngoingMatchCard({ variant }: { variant: 'panel' | 'compact' }) {
  const { t } = useTranslation();
  const game = useMatch((s) => s.game);
  const myColor = useMatch((s) => s.myColor);
  const live = useMatch((s) => s.lifecycle === 'playing');

  const opponentColor: Color = myColor === 'black' ? 'white' : 'black';
  const opponent = game?.players?.[opponentColor].username ?? null;
  const mine = myColor !== null && game?.activePlayer === myColor;
  const heading = t('home.ongoing');

  if (!live || game === null) {
    return (
      <section data-ongoing="saved" className="flex items-center gap-3.5 rounded-14 bg-panel p-3 lg:rounded-16 lg:p-4">
        <span className="flex grow flex-col gap-0.5">
          <span className="text-11 font-extrabold tracking-[0.1em] text-arcane-bright uppercase lg:text-12">{heading}</span>
          <span className="text-15 font-bold">{t('home.savedOnly')}</span>
        </span>
        <ResumeLink compact={variant === 'compact'} />
      </section>
    );
  }

  const turn = <span className={mine ? 'text-play-bright' : 'text-muted'}>{t(mine ? 'home.yourMove' : 'home.theirMove')}</span>;
  const board = (
    <MiniBoard
      fen={game.fen}
      orientation={myColor ?? 'white'}
      lastMove={lastMoveOf(game.moves)}
      label={t('home.miniLabel')}
      className={variant === 'compact' ? 'size-20 rounded-4! shadow-none!' : 'w-[min(376px,100%)] self-center'}
    />
  );

  if (variant === 'compact') {
    return (
      <section data-ongoing="live" className="flex h-[104px] items-center gap-3.5 rounded-14 bg-panel p-3">
        {board}
        <span className="flex min-w-0 grow flex-col gap-[3px]">
          <span className="text-11 font-extrabold tracking-[0.1em] text-arcane-bright uppercase">{heading}</span>
          <span className="truncate text-15 font-bold">{t('home.vs', { name: opponent ?? t('match.opponent') })}</span>
          <span className="text-13 font-bold">
            {turn}
            {myColor !== null && (
              <span className="text-play-bright">
                {' · '}
                <LiveClock color={myColor} />
              </span>
            )}
          </span>
        </span>
        <ResumeLink compact />
      </section>
    );
  }

  return (
    <section data-ongoing="live" className="flex w-[440px] shrink-0 flex-col gap-3 rounded-16 bg-panel p-4">
      <div className="flex items-center gap-3">
        <span className="flex grow flex-col gap-0.5">
          <span className="text-12 font-extrabold tracking-[0.1em] text-arcane-bright uppercase">{heading}</span>
          <span className="text-15 font-bold">
            {t('home.vs', { name: opponent ?? t('match.opponent') })} · {turn}
          </span>
        </span>
        <ResumeLink />
      </div>
      {board}
    </section>
  );
}
