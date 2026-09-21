import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatClock, isLowTime } from '../../game/clock';
import { ManaBar } from '../../game/mana/ManaBar';
import type { Color } from '../../game/model';
import { Panel } from '../../design/components/Panel';
import { useApi } from '../../store/AuthProvider';
import { useMatch } from '../../store/MatchProvider';
import { useClock } from './useClock';

/** ELO pubblico del giocatore (`GET /users/{id}`): una sola richiesta per partita. */
function useElo(playerId: string | null): number | null {
  const api = useApi();
  const [elo, setElo] = useState<number | null>(null);
  useEffect(() => {
    if (playerId === null) return;
    let active = true;
    void api.fetchPublicProfile(playerId).then((result) => {
      if (active && result.ok) setElo(result.value.user.elo);
    });
    return () => {
      active = false;
    };
  }, [api, playerId]);
  return elo;
}

/** Pannello di un giocatore: identità, orologio, turno, carte in mano (le carte vere arrivano allo Step 5). */
export function PlayerPanel({ side }: { side: 'self' | 'opponent' }) {
  const { t } = useTranslation();
  const myColor = useMatch((s) => s.myColor);
  const players = useMatch((s) => s.game?.players ?? null);
  const handSizes = useMatch((s) => s.game?.handSizes ?? null);
  const mana = useMatch((s) => s.game?.mana ?? null);
  const activePlayer = useMatch((s) => s.game?.activePlayer ?? null);
  const opponentConnected = useMatch((s) => s.opponentConnected);

  const color: Color = myColor === null ? (side === 'self' ? 'white' : 'black') : side === 'self' ? myColor : myColor === 'white' ? 'black' : 'white';
  const player = players?.[color] ?? null;
  const elo = useElo(player?.id ?? null);
  const remaining = useClock(color);
  const active = activePlayer === color;

  return (
    <Panel
      data-player={side}
      data-active={active}
      className={`flex items-center gap-3 px-3 py-2 ${active ? 'border-accent' : ''}`}
    >
      <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-elevated font-bold">
        {(player?.username ?? '?').slice(0, 1).toUpperCase()}
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-semibold">{player?.username ?? t(side === 'self' ? 'match.you' : 'match.opponent')}</span>
        {mana !== null && <ManaBar current={mana[color].current} max={mana[color].max} />}
        <span className="flex flex-wrap gap-2 text-xs text-muted">
          <span>{t(color === 'white' ? 'match.colorWhite' : 'match.colorBlack')}</span>
          {elo !== null && <span>{t('match.panel.elo', { elo })}</span>}
          {handSizes !== null && <span>{t('match.panel.cards', { count: handSizes[color] })}</span>}
          {side === 'opponent' && !opponentConnected && <span className="text-danger">{t('match.panel.disconnected')}</span>}
        </span>
      </div>
      <span
        data-clock={side}
        aria-label={t('match.panel.clock', { name: player?.username ?? '' })}
        className={`ml-auto rounded-sm px-2 py-1 font-mono text-lg tabular-nums ${active ? 'bg-elevated' : ''} ${
          remaining !== null && isLowTime(remaining) ? 'text-danger' : ''
        }`}
      >
        {remaining === null ? '—' : formatClock(remaining)}
      </span>
    </Panel>
  );
}
