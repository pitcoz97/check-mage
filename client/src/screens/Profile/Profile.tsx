import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { PublicProfile, UserAccount } from '../../api/types';
import { AppIcon } from '../../design/components/AppIcon';
import { Button } from '../../design/components/Button';
import { Panel } from '../../design/components/Panel';
import { Spinner } from '../../design/components/Spinner';
import { useApi, useAuth } from '../../store/AuthProvider';

const DATE_FORMAT: Intl.DateTimeFormatOptions = { dateStyle: 'long' };

type Loaded = { readonly account: UserAccount; readonly profile: PublicProfile };
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
      <Panel className="flex max-w-3xl flex-col items-start gap-3 rounded-16 p-5">
        <p role="alert">{t('profile.loadError')}</p>
        <Button variant="secondary" size="sm" onClick={() => void retry()}>
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
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex items-center gap-4">
        <span aria-hidden="true" className="flex size-16 shrink-0 items-center justify-center rounded-12 bg-play text-28 font-extrabold text-on-play">
          {account.username.slice(0, 1).toUpperCase()}
        </span>
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="truncate font-display text-22 font-bold tracking-[0.02em] lg:text-32">{account.username}</h1>
          <span className="flex items-center gap-2 self-start rounded-10 bg-panel px-3 py-1.5 text-14 font-bold">
            <AppIcon name="trophy" strokeWidth={2} className="size-4 text-gold" />
            {t('nav.rating', { elo: account.elo })}
          </span>
        </div>
      </header>

      <Panel className="rounded-16 p-5">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <dt className="text-12 font-extrabold tracking-label text-muted uppercase">{t('profile.elo')}</dt>
            <dd className="font-mono text-20 font-bold">{account.elo}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-12 font-extrabold tracking-label text-muted uppercase">{t('profile.email')}</dt>
            <dd className="break-all">{account.email}</dd>
          </div>
          {joined !== null && !Number.isNaN(joined.getTime()) && (
            <div className="flex flex-col gap-1">
              <dt className="text-12 font-extrabold tracking-label text-muted uppercase">{t('profile.memberSince')}</dt>
              <dd>{joined.toLocaleDateString(i18n.language, DATE_FORMAT)}</dd>
            </div>
          )}
        </dl>
      </Panel>

      <section className="flex flex-col gap-3">
        <h2 className="text-12 font-extrabold tracking-label text-muted uppercase">{t('profile.stats')}</h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:gap-5">
          {stats.map(([key, value]) => (
            <div key={key} data-stat={key} className="flex flex-col-reverse gap-1 rounded-16 bg-panel p-[18px]">
              <dt className="text-12 font-bold tracking-[0.08em] text-muted uppercase">{t(`profile.${key}`)}</dt>
              <dd className="font-display text-[34px] leading-none font-extrabold text-gold-bright">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
