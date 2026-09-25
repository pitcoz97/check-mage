import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { Spinner } from '../../design/components/Spinner';
import { AuthProvider } from '../../store/AuthProvider';
import { MatchProvider } from '../../store/MatchProvider';
import { Match } from '../Match/Match';
import { isDevScenario } from './devSession';
import { useDevSession } from './useDevSession';

/**
 * Pagina di sviluppo (`/dev/match`): la schermata di partita vera, alimentata da un socket finto con lo scenario
 * delle tavole "Partita" del design (posizione, Magie 1, mana 4/8, cavallo congelato in c3, scudo in e4, cinque
 * carte, due magie nello storico). `?scenario=over|draw|reconnecting|replaced|disconnected|promotion` aggiunge gli
 * stati che le tavole non disegnano. Serve a confrontare la partita col design senza account né server. Non esiste nella
 * build di produzione.
 */
export function MatchPreview() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const scenario = params.get('scenario');
  const preview = useDevSession(true, isDevScenario(scenario) ? scenario : null);
  if (preview === null) return <Spinner label={t('match.joining')} />;
  return (
    <AuthProvider auth={preview.auth}>
      <MatchProvider session={preview.session}>
        <Match />
      </MatchProvider>
    </AuthProvider>
  );
}
