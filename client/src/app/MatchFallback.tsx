import { useTranslation } from 'react-i18next';

import { Spinner } from '../design/components/Spinner';
import { StatePage } from './StatePage';

/** Attesa del chunk della schermata di partita, caricato a richiesta. */
export function MatchFallback() {
  const { t } = useTranslation();
  return (
    <StatePage>
      <Spinner label={t('match.joining')} />
    </StatePage>
  );
}
