import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { PublicProfile, UserAccount } from '../../api/types';
import { Button } from '../../design/components/Button';
import { Panel } from '../../design/components/Panel';
import { Spinner } from '../../design/components/Spinner';
import { useApi, useAuth } from '../../store/AuthProvider';

const DATE_FORMAT: Intl.DateTimeFormatOptions = { dateStyle: 'long' };

type Loaded ={ readonly account: UserAccount; readonly profile: PublicProfile };
type State = { readonly kind: 'loading' } | { readonly kind: 'error' } | ({ readonly kind: 'ready' } & Loaded);

/** Profilo: account da `/me`, statistiche da `/users/{id}` (chess-server `handlers/auth.go:272`, `handlers/stats.go:111`). */
export function Profile() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const accountId = useAuth((s) => s.account?.id ?? null);
  const [state, setState] = useState<State>({ kind: 'loading' });

  const fetchProfile = useCallback(async (): Promise<State> => {
    if (accountId === null) return { kind: 'error' };
    const [me, profile] = await Promise.all([api.fetchAccount(), api.fetchPublicProfile(accountId)]);
    return me.ok && profile.ok ? { kind: 'ready', account: me.value, profile: profile.value } : { kind: 'error' };
  }, [api, accountId]);

  useEffect(() => {
    let active = true;
    void fetchProfile().then((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
    };
  }, [fetchProfile]);

  async function retry() {
    setState({ kind: 'loading' });
    setState(await fetchProfile());
  }

  if (state.kind === 'loading') {
    return (
      <div className="flex justify-center py-10">
        <Spinner label={t('profile.loading')} />
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <Panel className="flex flex-col items-start gap-3 p-6">
        <p role="alert">{t('profile.loadError')}</p>
        <Button variant="secondary" onClick={() => void retry()}>
          {t('profile.retry')}
        </Button>
      </Panel>
    );
  }

  const { account, profile } = state;
  const joined = account.createdAt === null ? null : new Date(account.createdAt);
  const stats = [
    ['wins', profile.stats.wins],
    ['losses', profile.stats.losses],
    ['draws', profile.stats.draws],
    ['total', profile.stats.total],
  ] as const;

  return (
    <div className="flex flex-col gap-4">
      <Panel className="flex flex-col gap-4 p-6">
        <h1 className="text-xl font-bold">{account.username}</h1>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-sm text-muted">{t('profile.elo')}</dt>
            <dd className="text-lg font-semibold">{account.elo}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">{t('profile.email')}</dt>
            <dd className="break-all">{account.email}</dd>
          </div>
          {joined !== null && !Number.isNaN(joined.getTime()) && (
            <div>
              <dt className="text-sm text-muted">{t('profile.memberSince')}</dt>
              <dd>{joined.toLocaleDateString(i18n.language, DATE_FORMAT)}</dd>
            </div>
          )}
        </dl>
      </Panel>

      <Panel className="flex flex-col gap-3 p-6">
        <h2 className="text-lg font-semibold">{t('profile.stats')}</h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map(([key, value]) => (
            <div key={key} data-stat={key} className="rounded-md bg-elevated p-3 text-center">
              <dt className="text-sm text-muted">{t(`profile.${key}`)}</dt>
              <dd className="text-xl font-bold">{value}</dd>
            </div>
          ))}
        </dl>
      </Panel>
    </div>
  );
}
