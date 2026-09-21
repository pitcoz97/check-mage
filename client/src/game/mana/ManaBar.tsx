import { useTranslation } from 'react-i18next';

import { EffectIcon } from '../../spells/icons/EffectIcon';

/**
 * Cristalli di mana: pieni fino al valore corrente, vuoti fino al massimo del giocatore (`spells/spells.go:18-21`,
 * cap 10). Accanto c'è sempre il numero: il colore da solo non basta.
 */
export function ManaBar({ current, max, className = '' }: { current: number; max: number; className?: string }) {
  const { t } = useTranslation();
  const total = Math.max(0, Math.min(10, max));
  const filled = Math.max(0, Math.min(total, current));
  return (
    <span data-mana className={`flex items-center gap-1 ${className}`} aria-label={t('spells.mana', { current, max })}>
      <span aria-hidden="true" className="flex gap-px">
        {Array.from({ length: total }, (_, index) => (
          <EffectIcon key={index} name="crystal" className={`size-2.5 ${index < filled ? 'text-mana-full' : 'text-mana-empty'}`} />
        ))}
      </span>
      <span aria-hidden="true" className="text-xs tabular-nums text-muted">
        {t('spells.manaShort', { current, max })}
      </span>
    </span>
  );
}
