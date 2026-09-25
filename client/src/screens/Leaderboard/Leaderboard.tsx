import { useTranslation } from 'react-i18next';

import { Button } from '../../design/components/Button';
import { Panel } from '../../design/components/Panel';
import { Spinner } from '../../design/components/Spinner';
import { useAuth } from '../../store/AuthProvider';
import { RankingRows } from './RankingRows';
import { useLeaderboard } from './useLeaderboard';

/**
 * Classifica (REDESIGN_PLAN.md D11). La schermata non è disegnata: riprende la card "Classifica" della home nel
 * linguaggio del design (D20). Il server dà i primi dieci; posizione propria e stagione non esistono (P2-20).
 */
export function Leaderboard() {
  const { t } = useTranslation();
  const selfId = useAuth((s) => s.account?.id ?? null);
  const { state, retry } = useLeaderboard();

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-22 font-bold tracking-[0.02em] lg:text-32">{t('leaderboard.title')}</h1>
        <p className="text-15 text-muted">{t('leaderboard.lead')}</p>
      </header>
      <Panel className="flex flex-col gap-3 rounded-16 p-4 lg:p-5">
        {state.kind === 'loading' && <Spinner label={t('leaderboard.loading')} />}
        {state.kind === 'error' && (
          <div className="flex flex-col items-start gap-3">
            <p role="alert">{t('leaderboard.error')}</p>
            <Button variant="secondary" size="sm" onClick={retry}>
              {t('leaderboard.retry')}
            </Button>
          </div>
        )}
        {state.kind === 'ready' &&
          (state.entries.length === 0 ? <p className="text-muted">{t('leaderboard.empty')}</p> : <RankingRows entries={state.entries} selfId={selfId} />)}
      </Panel>
    </div>
  );
}
