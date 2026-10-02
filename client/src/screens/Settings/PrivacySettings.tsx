import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { HttpErrorInfo } from '../../api/types';
import { Button } from '../../design/components/Button';
import { InfoBox } from '../../design/components/InfoBox';
import { TextField } from '../../design/components/TextField';
import { deliverTextFile } from '../../platform/native';
import { useApi, useAuth } from '../../store/AuthProvider';
import { useMatchSession } from '../../store/MatchProvider';
import { httpErrorMessage } from '../Auth/errorMessage';

/**
 * Privacy (P3, P5, P6): stato online nascosto, esportazione dei dati e cancellazione dell'account con la password.
 * Non è nelle tavole: i pannelli e i controlli delle Impostazioni (D20).
 */
export function PrivacySettings() {
  return (
    <div className="flex flex-col gap-5">
      <HidePresence />
      <ExportData />
      <DeleteAccount />
    </div>
  );
}

function Hint({ children }: { children: string }) {
  return <p className="text-13 text-muted">{children}</p>;
}

function HidePresence() {
  const { t } = useTranslation();
  const api = useApi();
  const hidden = useAuth((s) => s.account?.hidePresence ?? false);
  const setAccount = useAuth((s) => s.setAccount);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  async function toggle() {
    setSaving(true);
    setFailed(false);
    const result = await api.updatePrivacy(!hidden);
    setSaving(false);
    if (result.ok) setAccount(result.value);
    else setFailed(true);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        role="switch"
        aria-checked={hidden}
        disabled={saving}
        data-hide-presence
        onClick={() => void toggle()}
        className="flex items-center justify-between gap-3 text-left text-15 font-bold disabled:opacity-60"
      >
        {t('settings.privacy.hidePresence')}
        <span aria-hidden="true" className={`flex h-7 w-12 shrink-0 items-center rounded-pill p-1 ${hidden ? 'justify-end bg-play' : 'justify-start bg-sunken shadow-ring-quiet'}`}>
          <span className="size-5 rounded-pill bg-parchment" />
        </span>
      </button>
      <Hint>{t('settings.privacy.hidePresenceHint')}</Hint>
      {failed && (
        <p role="alert" className="text-13 text-danger">
          {t('settings.privacy.saveError')}
        </p>
      )}
    </div>
  );
}

function ExportData() {
  const { t } = useTranslation();
  const api = useApi();
  const username = useAuth((s) => s.account?.username ?? 'checkmage');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<'downloaded' | 'copied' | 'failed' | null>(null);

  async function download() {
    setBusy(true);
    setOutcome(null);
    const result = await api.exportData();
    const delivered = result.ok ? await deliverTextFile(`checkmage-${username}-${new Date().toISOString().slice(0, 10)}.json`, result.value) : 'failed';
    setBusy(false);
    setOutcome(delivered);
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <Button variant="secondary" size="sm" data-action="export-data" disabled={busy} onClick={() => void download()}>
        {t('settings.privacy.export')}
      </Button>
      <Hint>{t('settings.privacy.exportHint')}</Hint>
      {outcome === 'downloaded' && <p role="status" className="text-13 text-play-bright">{t('settings.privacy.exported')}</p>}
      {outcome === 'copied' && <p role="status" className="text-13 text-play-bright">{t('settings.privacy.copied')}</p>}
      {outcome === 'failed' && (
        <p role="alert" className="text-13 text-danger">
          {t('settings.privacy.exportError')}
        </p>
      )}
    </div>
  );
}

function DeleteAccount() {
  const { t } = useTranslation();
  const api = useApi();
  const session = useMatchSession();
  const accountDeleted = useAuth((s) => s.accountDeleted);
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<HttpErrorInfo | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy || password === '') return;
    setBusy(true);
    setError(null);
    const result = await api.deleteAccount(password);
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      return;
    }
    session.leave();
    await accountDeleted(); // la guardia porta al login, con l'avviso
  }

  if (!confirming) {
    return (
      <div className="flex flex-col items-start gap-1.5">
        <Button variant="danger" size="sm" data-action="delete-account" onClick={() => setConfirming(true)}>
          {t('settings.privacy.delete')}
        </Button>
        <Hint>{t('settings.privacy.deleteHint')}</Hint>
      </div>
    );
  }
  return (
    <InfoBox tone="danger" role="group" aria-label={t('settings.privacy.delete')} data-delete-account>
      <form className="flex flex-col gap-3" onSubmit={(e) => void onSubmit(e)} noValidate>
        <p className="text-14">{t('settings.privacy.deleteConfirm')}</p>
        <TextField
          label={t('auth.password')}
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          error={error === null ? null : httpErrorMessage(t, error)}
          onChange={(e) => setPassword(e.target.value)}
        />
        <div className="flex flex-wrap gap-2.5">
          <Button type="submit" variant="danger" size="sm" disabled={busy || password === ''}>
            {t('settings.privacy.deleteYes')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setConfirming(false);
              setPassword('');
              setError(null);
            }}
          >
            {t('settings.privacy.cancel')}
          </Button>
        </div>
      </form>
    </InfoBox>
  );
}
