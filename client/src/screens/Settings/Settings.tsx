import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../design/components/Button';
import { Panel } from '../../design/components/Panel';
import { BOARD_THEMES, boardThemeStore, useBoardTheme, type BoardTheme } from '../../game/board/boardTheme';
import { LanguageSwitch } from '../../i18n/LanguageSwitch';
import { useAuth } from '../../store/AuthProvider';

/**
 * Impostazioni (REDESIGN_PLAN.md D11): tema della scacchiera (D1), lingua (D15) ed Esci con conferma (D14). La
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
