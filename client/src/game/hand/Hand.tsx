import { useTranslation } from 'react-i18next';

import { cardRefusal, type CastContext } from '../../spells/playability';
import type { Spell } from '../../spells/schema';
import type { HandCard } from '../model';
import { SpellCard } from './SpellCard';

/**
 * La propria mano. Le carte dell'avversario restano un numero nel suo pannello: qui non esiste nessuna struttura
 * con la sua mano (briefing §2.2).
 *
 * Su schermo stretto le carte scorrono in orizzontale; l'ordine è quello in cui il server le ha date.
 */

export interface HandProps {
  readonly cards: readonly HandCard[];
  /** Catalogo: `undefined` per uno `spell_id` che il client non conosce. */
  spellOf(spellId: string): Spell | undefined;
  readonly context: CastContext;
  readonly selectedInstanceId: string | null;
  /** Catalogo non ancora caricato: si mostra l'attesa invece di carte tutte sconosciute. */
  readonly loading?: boolean;
  onPick(card: HandCard, spell: Spell): void;
}

export function Hand({ cards, spellOf, context, selectedInstanceId, loading = false, onPick }: HandProps) {
  const { t } = useTranslation();
  return (
    <section data-hand aria-label={t('spells.hand')} className="flex items-stretch gap-2 overflow-x-auto p-1">
      {loading && <p className="self-center px-2 text-sm text-muted">{t('spells.handLoading')}</p>}
      {!loading && cards.length === 0 && <p className="self-center px-2 text-sm text-muted">{t('spells.handEmpty')}</p>}
      {!loading &&
        cards.map((card) => {
          const spell = spellOf(card.spellId);
          return (
            <SpellCard
              key={card.instanceId}
              spell={spell}
              spellId={card.spellId}
              refusal={cardRefusal(spell, context)}
              selected={card.instanceId === selectedInstanceId}
              onPick={spell === undefined ? undefined : () => onPick(card, spell)}
            />
          );
        })}
    </section>
  );
}
