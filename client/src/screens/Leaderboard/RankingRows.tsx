import { useTranslation } from 'react-i18next';

import type { LeaderboardEntry } from '../../api/types';

/** Colore del rango: il podio della tavola (oro, argento, bronzo), poi il testo normale. */
const PODIUM: Readonly<Record<number, string>> = { 1: 'text-gold-bright', 2: 'text-rank-silver', 3: 'text-rank-bronze' };

/**
 * Righe della classifica (card della tavola "Home · desktop"): rango, nome, ELO in JetBrains Mono. La propria riga,
 * se c'è, è evidenziata in verde come nella tavola.
 */
export function RankingRows({ entries, selfId, compact = false }: { entries: readonly LeaderboardEntry[]; selfId: string | null; compact?: boolean }) {
  const { t } = useTranslation();
  return (
    <ol data-ranking className="flex flex-col gap-1">
      {entries.map((entry) => {
        const self = entry.id === selfId;
        return (
          <li
            key={entry.id}
            data-rank={entry.rank}
            data-self={self || undefined}
            className={`flex items-center gap-2.5 rounded-8 px-2.5 ${compact ? 'h-8 text-14' : 'h-11 text-15'} ${self ? 'bg-row-self shadow-ring-self' : ''}`}
          >
            <span className={`w-[34px] font-extrabold ${PODIUM[entry.rank] ?? 'text-primary'}`}>{entry.rank}</span>
            <span className="min-w-0 grow truncate font-semibold">
              {entry.username}
              {self && <span className="sr-only"> ({t('leaderboard.you')})</span>}
            </span>
            <span className="font-mono text-13 font-bold">{entry.elo}</span>
          </li>
        );
      })}
    </ol>
  );
}
