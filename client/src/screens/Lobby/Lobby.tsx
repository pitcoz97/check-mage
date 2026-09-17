import { useTranslation } from 'react-i18next';

import { Button } from '../../design/components/Button';

/** Lobby: il CTA "Gioca" è l'elemento dominante (briefing §7.2). Matchmaking allo Step 3. */
export function Lobby() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-6 py-10 text-center">
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
  );
}
