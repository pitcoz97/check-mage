import { useTranslation } from 'react-i18next';

import { formatClock, isLowTime, MAX_STRIKES } from '../../game/clock';
import type { Color } from '../../game/model';
import { useMatch } from '../../store/MatchProvider';
import { useClock } from './useClock';

/**
 * Orologio del design col tempo per fase (T1–T4): attivo su pergamena con l'anello verde (e l'icona su desktop), fermo
 * e spento sul tempo pieno della prossima fase. Sotto i 15 s (D19, non disegnato) l'anello passa all'arancio
 * "Mitica" e le cifre al rosso: sempre AA. Accanto, i segni delle fasi scadute di fila (●●○).
 */
export function Clock({ side, color, active, name }: { side: 'self' | 'opponent'; color: Color; active: boolean; name: string }) {
  const { t } = useTranslation();
  const { remaining, idle } = useClock(color);
  const strikes = useMatch((s) => s.game?.timeouts[color] ?? 0);
  const low = remaining !== null && !idle && isLowTime(remaining);
  const tone = active
    ? `bg-parchment ${low ? 'text-danger-surface shadow-ring-clock-low' : 'text-app shadow-ring-play'}`
    : `bg-quiet ${low ? 'text-danger' : 'text-muted'}`;
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <Strikes count={strikes} name={name} />
      <span
      role="timer"
      data-clock={side}
      data-active={active}
      data-low={low}
      aria-label={t('match.panel.clock', { name })}
      className={`flex h-[38px] w-[92px] shrink-0 items-center justify-end gap-2 rounded-6 pr-2.5 font-mono text-20 font-bold tabular-nums lg:h-10 lg:w-28 lg:px-3 lg:text-22 ${
        active ? 'lg:justify-between' : ''
      } ${tone}`}
    >
      {active && (
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className={`hidden size-4 lg:block ${low ? 'text-clock-low' : 'text-play'}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
        >
          <circle cx="12" cy="13" r="8" />
          <path d="M12 9v4l2.5 2M10 2h4" />
        </svg>
      )}
      <span>{remaining === null ? '—' : formatClock(remaining)}</span>
      </span>
    </span>
  );
}

/** Tre segni, pieni quanti sono le fasi Magie scadute di fila: alla terza si perde. */
function Strikes({ count, name }: { count: number; name: string }) {
  const { t } = useTranslation();
  const filled = Math.min(count, MAX_STRIKES);
  return (
    <span role="img" data-strikes={filled} aria-label={t('match.panel.strikes', { name, count: filled, max: MAX_STRIKES })} className="flex flex-col gap-[3px] lg:flex-row">
      {Array.from({ length: MAX_STRIKES }, (_, i) => (
        <span key={i} aria-hidden="true" className={`size-[6px] rounded-pill ${i < filled ? 'bg-danger' : 'bg-quiet'}`} />
      ))}
    </span>
  );
}
