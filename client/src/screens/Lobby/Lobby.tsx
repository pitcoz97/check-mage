import { useTranslation } from 'react-i18next';

import { Button } from '../../design/components/Button';
import { Panel } from '../../design/components/Panel';
import { useAuth } from '../../store/AuthProvider';

/** Lobby: profilo compatto in alto, CTA "Gioca" dominante (briefing §7.2). Matchmaking allo Step 3. */
export function Lobby() {
  const { t } = useTranslation();
  const account = useAuth((s) => s.account);
  return (
    <div className="flex flex-col items-center gap-8 py-6">
      {account !== null && (
        <Panel className="flex w-full max-w-md items-center gap-3 p-3">
          <span aria-hidden="true" className="flex size-11 items-center justify-center rounded-full bg-elevated text-lg font-bold">
            {account.username.slice(0, 1).toUpperCase()}
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-semibold">{account.username}</span>
            <span className="text-sm text-muted">{t('lobby.elo', { elo: account.elo })}</span>
          </div>
        </Panel>
      )}
      <div className="flex flex-col items-center gap-6 text-center">
        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-bold">{t('lobby.title')}</h1>
          <p className="text-muted">{t('lobby.lead')}</p>
        </div>
        <Button className="min-w-56 text-lg" disabled aria-describedby="play-unavailable">
          {t('lobby.play')}
        </Button>
        <p id="play-unavailable" className="text-sm text-muted">
          {t('lobby.playUnavailable')}
        </p>
      </div>
    </div>
  );
}
