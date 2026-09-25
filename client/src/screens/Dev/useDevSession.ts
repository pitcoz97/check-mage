import { useEffect, useState } from 'react';

import type { Auth } from '../../store/authStore';
import type { MatchSession } from '../../store/matchSession';
import { startDevSession, type DevScenario } from './devSession';

/** Monta i figli con l'account e la sessione finti di `startDevSession`. */
export function useDevSession(withMatch: boolean, scenario: DevScenario | null = null): { auth: Auth; session: MatchSession } | null {
  const [preview, setPreview] = useState<{ auth: Auth; session: MatchSession } | null>(null);
  useEffect(() => {
    let active = true;
    let started: MatchSession | null = null;
    void startDevSession({ withMatch, scenario }).then((value) => {
      started = value.session;
      if (active) setPreview(value);
      else value.session.dispose();
    });
    return () => {
      active = false;
      started?.dispose();
    };
  }, [withMatch, scenario]);
  return preview;
}
