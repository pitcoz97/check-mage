import { useTranslation } from 'react-i18next';

import { Spinner } from '../design/components/Spinner';

/** Attesa del chunk della schermata di partita, caricato a richiesta. */
export function MatchFallback() {
  const { t } = useTranslation();
  return (
    <div className="safe-area flex min-h-full items-center justify-center">
      <Spinner label={t('match.joining')} />
    </div>
  );
}
