import { useTranslation } from 'react-i18next';

import type { PlayedMove } from '../../game/model';
import { Panel } from '../../design/components/Panel';
import { useMatch } from '../../store/MatchProvider';

/**
 * Storico delle mosse come lo manda il server: UCI, con le mosse assorbite da uno scudo marcate (`0000`,
 * `game/room.go:37`). La notazione SAN non è ricostruibile in modo affidabile, perché le magie cambiano la
 * scacchiera fuori dalle mosse (BACKEND-REQUESTS B7).
 */
function pairs(moves: readonly PlayedMove[]): { number: number; white: PlayedMove | null; black: PlayedMove | null }[] {
  const rows: { number: number; white: PlayedMove | null; black: PlayedMove | null }[] = [];
  for (let i = 0; i < moves.length; i += 2) {
    rows.push({ number: i / 2 + 1, white: moves[i] ?? null, black: moves[i + 1] ?? null });
  }
  return rows;
}

export function MoveHistory() {
  const { t } = useTranslation();
  const moves = useMatch((s) => s.game?.moves ?? []);
  const label = (move: PlayedMove | null) => (move === null ? '' : move.kind === 'move' ? move.uci : '--');

  return (
    <Panel className="flex h-full min-h-0 flex-col gap-2 p-3">
      <h2 className="text-14 font-semibold text-muted">{t('match.history')}</h2>
      {moves.length === 0 ? (
        <p className="text-14 text-muted">{t('match.moveList.empty')}</p>
      ) : (
        <ol data-history className="min-h-0 flex-1 overflow-y-auto font-mono text-14 tabular-nums">
          {pairs(moves).map((row) => (
            <li key={row.number} className="flex gap-3">
              <span className="w-6 text-muted">{row.number}.</span>
              <span className="w-20" title={row.white?.kind === 'absorbed' ? t('match.moveList.absorbed') : undefined}>
                {label(row.white)}
              </span>
              <span className="w-20" title={row.black?.kind === 'absorbed' ? t('match.moveList.absorbed') : undefined}>
                {label(row.black)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
