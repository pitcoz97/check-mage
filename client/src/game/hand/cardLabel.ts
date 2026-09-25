import type { TFunction } from 'i18next';

import { spellRulesText } from '../../spells/effects.registry';
import { cardRefusalMessage, type CardRefusal } from '../../spells/playability';
import type { Spell } from '../../spells/schema';

/**
 * Etichetta accessibile di una carta in mano: nome, costo, testo di regole e, se non si può giocare, il motivo.
 * In mano il testo della carta è rimpicciolito come nel design, e il motivo non è scritto sulla carta (D5): è qui
 * che il lettore di schermo trova tutto.
 */
export function spellCardLabel(t: TFunction, spell: Spell | undefined, spellId: string, refusal: CardRefusal | null): string {
  const name = spell?.name ?? spellId;
  const cost = spell === undefined ? t('spells.costUnknown') : String(spell.manaCost);
  const parts: string[] = [t('spells.card.label', { name, cost })];
  if (spell !== undefined) parts.push(...spellRulesText(t, spell.effects));
  if (refusal !== null) parts.push(cardRefusalMessage(t, refusal, spell));
  return parts.join('. ');
}
