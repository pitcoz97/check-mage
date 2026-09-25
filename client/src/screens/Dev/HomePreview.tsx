import { useTranslation } from 'react-i18next';
import { Route, Routes, useSearchParams } from 'react-router';

import { AppShell } from '../../app/AppShell';
import { Spinner } from '../../design/components/Spinner';
import { AuthProvider } from '../../store/AuthProvider';
import { MatchProvider } from '../../store/MatchProvider';
import { Leaderboard } from '../Leaderboard/Leaderboard';
import { Lobby } from '../Lobby/Lobby';
import { Profile } from '../Profile/Profile';
import { Settings } from '../Settings/Settings';
import { useDevSession } from './useDevSession';

/**
 * Pagina di sviluppo (`/dev/home`): shell e home con l'account finto delle anteprime. `?match=1` mette in corso la
 * partita delle tavole (card "Partita in corso" con la miniatura live). Anche `/dev/home/leaderboard`,
 * `/dev/home/settings` e `/dev/home/profile`. I link della shell portano alle rotte vere. Non esiste nella build
 * di produzione.
 */
export function HomePreview() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const preview = useDevSession(params.get('match') === '1');
  if (preview === null) return <Spinner label={t('match.joining')} />;
  return (
    <AuthProvider auth={preview.auth}>
      <MatchProvider session={preview.session}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Lobby />} />
            <Route path="leaderboard" element={<Leaderboard />} />
            <Route path="settings" element={<Settings />} />
            <Route path="profile" element={<Profile />} />
          </Route>
        </Routes>
      </MatchProvider>
    </AuthProvider>
  );
}
