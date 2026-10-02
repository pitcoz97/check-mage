import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { Button } from '../../design/components/Button';
import { Panel } from '../../design/components/Panel';
import { Spinner } from '../../design/components/Spinner';
import { BOARD_THEMES, boardThemeStore, useBoardTheme, type BoardTheme } from '../../game/board/boardTheme';
import { LanguageSwitch } from '../../i18n/LanguageSwitch';
import { LegalLinks } from '../../legal/LegalLinks';
import { useAuth } from '../../store/AuthProvider';
import { httpErrorMessage } from '../Auth/errorMessage';
import { RowButton } from '../Friends/FriendRow';
import { useBlocks } from '../Friends/useBlocks';

/**
 * Impostazioni (REDESIGN_PLAN.md D11): tema della scacchiera (D1), lingua (D15), giocatori bloccati (A8) ed Esci con
 * conferma (D14). La
 * schermata non è disegnata: pannelli, etichette e controlli sono quelli delle tavole (D20).
 */
export function Settings() {
  const { t } = useTranslation();
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <h1 className="font-display text-22 font-bold tracking-[0.02em] lg:text-32">{t('settings.title')}</h1>
      <Panel className="flex flex-col gap-3 rounded-16 p-4 lg:p-5">
        <h2 className="text-12 font-extrabold tracking-label text-muted uppercase">{t('settings.boardTheme')}</h2>
        <BoardThemePicker />
      </Panel>
      <Panel className="flex flex-col gap-3 rounded-16 p-4 lg:p-5">
        <LanguageSwitch />
      </Panel>
      <Panel className="flex flex-col gap-3 rounded-16 p-4 lg:p-5">
        <h2 className="text-12 font-extrabold tracking-label text-muted uppercase">{t('settings.blocked.title')}</h2>
        <BlockedPlayers />
      </Panel>
      <Panel className="flex flex-col gap-3 rounded-16 p-4 lg:p-5">
        <h2 className="text-12 font-extrabold tracking-label text-muted uppercase">{t('legal.title')}</h2>
        <div className="[&_ul]:justify-start">
          <LegalLinks />
        </div>
      </Panel>
      <Panel className="flex flex-col gap-3 rounded-16 p-4 lg:p-5">
        <h2 className="text-12 font-extrabold tracking-label text-muted uppercase">{t('settings.account')}</h2>
        <Logout />
      </Panel>
    </div>
  );
}

function BoardThemePicker() {
  const { t } = useTranslation();
  const theme = useBoardTheme();
  return (
    <div role="radiogroup" aria-label={t('settings.boardTheme')} className="grid grid-cols-3 gap-3">
      {BOARD_THEMES.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={theme === option}
          data-theme-option={option}
          onClick={() => void boardThemeStore.getState().set(option)}
          className={`flex flex-col items-center gap-2 rounded-12 p-2.5 ${theme === option ? 'bg-arcane-deep shadow-ring-arcane' : 'bg-sunken shadow-ring-quiet'}`}
        >
          <ThemeSwatch theme={option} />
          <span className="text-14 font-bold">{t(`board.theme.${option}`)}</span>
        </button>
      ))}
    </div>
  );
}

/** Quattro case del tema: i colori li dà `[data-board-theme]` in tokens.css. */
function ThemeSwatch({ theme }: { theme: BoardTheme }) {
  return (
    <span aria-hidden="true" data-board-theme={theme} className="grid size-16 grid-cols-2 overflow-hidden rounded-6 shadow-card">
      <span className="bg-board-light" />
      <span className="bg-board-dark" />
      <span className="bg-board-dark" />
      <span className="bg-board-light" />
    </span>
  );
}

/** Giocatori bloccati (A8), dal più recente, con «Sblocca». */
function BlockedPlayers() {
  const { t } = useTranslation();
  const blocks = useBlocks();
  const { state } = blocks;
  if (state.kind === 'loading') return <Spinner label={t('settings.blocked.loading')} />;
  if (state.kind === 'error') return <p className="text-14 text-muted">{t('settings.blocked.error')}</p>;
  return (
    <>
      {state.blocked.length === 0 && <p className="text-14 text-muted">{t('settings.blocked.empty')}</p>}
      {state.blocked.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {state.blocked.map((user) => (
            <li key={user.id} data-blocked-user={user.id} className="flex items-center gap-3 rounded-10 bg-sunken px-3 py-2">
              <Link to={`/players/${user.id}`} className="min-w-0 grow truncate text-15 font-bold text-primary">
                {user.username}
              </Link>
              <RowButton disabled={blocks.busy === user.id} aria-label={t('settings.blocked.unblockName', { name: user.username })} onClick={() => void blocks.unblock(user.id)}>
                {t('settings.blocked.unblock')}
              </RowButton>
            </li>
          ))}
        </ul>
      )}
      {blocks.error !== null && (
        <p role="alert" className="text-13 text-danger">
          {httpErrorMessage(t, blocks.error)}
        </p>
      )}
    </>
  );
}

function Logout() {
  const { t } = useTranslation();
  const logout = useAuth((s) => s.logout);
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <Button variant="secondary" size="sm" className="self-start" onClick={() => setConfirming(true)}>
        {t('settings.logout')}
      </Button>
    );
  }
  return (
    <div role="group" aria-label={t('settings.logout')} className="flex flex-col gap-3">
      <p className="text-15 font-semibold">{t('settings.logoutConfirm')}</p>
      <div className="flex gap-2.5">
        <Button variant="danger" size="sm" onClick={() => void logout()}>
          {t('settings.logoutYes')}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setConfirming(false)}>
          {t('settings.cancel')}
        </Button>
      </div>
    </div>
  );
}
