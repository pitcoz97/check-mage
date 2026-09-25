import { useTranslation } from 'react-i18next';

import { Panel } from '../../design/components/Panel';
import { ManaCrystals } from '../../game/mana/ManaCrystals';
import { useMatch } from '../../store/MatchProvider';

/**
 * Pannello del mana nella colonna laterale (tavola "Partita · desktop"): "4 / 8" e i dieci rombi. La nota
 * "+1 per turno · max 10" descrive la regola del server (ASSUMPTIONS C16).
 */
export function ManaPanel() {
  const { t } = useTranslation();
  const mana = useMatch((s) => (s.myColor === null ? null : (s.game?.mana[s.myColor] ?? null)));
  if (mana === null) return null;
  return (
    <Panel data-mana className="flex flex-col gap-3 px-4 py-3.5">
      <div className="flex items-baseline gap-3">
        <h2 className="text-12 font-bold tracking-[0.08em] text-muted uppercase">{t('match.mana.label')}</h2>
        <span aria-hidden="true" className="font-display text-24 font-extrabold text-gold-bright">
          {t('spells.manaSpaced', { ...mana })}
        </span>
        <span className="sr-only">{t('spells.mana', { ...mana })}</span>
        <span className="grow" />
        <span className="text-12 text-muted">{t('match.mana.note')}</span>
      </div>
      <ManaCrystals current={mana.current} max={mana.max} size="lg" className="justify-between px-1" />
    </Panel>
  );
}
