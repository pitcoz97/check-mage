import { useTranslation } from 'react-i18next';

import { effectPresentation, spellRulesText, TONE_TEXT } from '../../spells/effects.registry';
import { EffectIcon } from '../../spells/icons/EffectIcon';
import { cardRefusalMessage, type CardRefusal } from '../../spells/playability';
import type { Spell } from '../../spells/schema';

/**
 * Carta magia. Tutto arriva dal catalogo e dai registry: costo, nome, icone e testo di regole (§5.1). Nessun ramo
 * per una magia in particolare, e una magia che il client non conosce si vede comunque, disabilitata col motivo.
 *
 * La cornice dorata (`--spell-frame`) dice "giocabile ora": è informazione, non decorazione (briefing §6).
 */

export interface SpellCardProps {
  /** `undefined` quando il catalogo non conosce lo `spell_id` che il server ha messo in mano. */
  readonly spell: Spell | undefined;
  readonly spellId: string;
  /** Motivo per cui non è giocabile ora, `null` se lo è. */
  readonly refusal: CardRefusal | null;
  /** Carta in corso di bersaglio. */
  readonly selected?: boolean;
  /** Assente quando la carta non si può lanciare (magia sconosciuta): il bottone resta disabilitato. */
  readonly onPick?: (() => void) | undefined;
}

export function SpellCard({ spell, spellId, refusal, selected = false, onPick }: SpellCardProps) {
  const { t } = useTranslation();
  const playable = refusal === null;
  const name = spell?.name ?? spellId;
  const rules = spell === undefined ? [t('spells.refusal.unknown_spell')] : spellRulesText(t, spell.effects);

  return (
    <button
      type="button"
      data-card={spellId}
      data-playable={playable}
      data-selected={selected}
      disabled={!playable}
      onClick={onPick}
      aria-label={name}
      className={[
        'flex h-40 w-32 shrink-0 flex-col gap-1 rounded-md border-2 bg-elevated p-2 text-left',
        playable ? 'border-spell-frame' : 'border-subtle opacity-60',
        selected ? 'outline outline-2 outline-offset-2 outline-accent' : '',
      ].join(' ')}
    >
      <span className="flex items-center gap-1">
        <span className="flex items-center gap-0.5 rounded-sm bg-panel px-1 py-0.5 text-xs font-bold tabular-nums">
          <EffectIcon name="crystal" className="size-3 text-mana-full" />
          {spell === undefined ? t('spells.costUnknown') : spell.manaCost}
        </span>
        <span aria-hidden="true" className="ml-auto flex gap-0.5">
          {(spell?.effects ?? []).map((effect, index) => {
            const presentation = effectPresentation(effect.kind);
            return <EffectIcon key={`${effect.kind}-${index}`} name={presentation.icon} className={`size-4 ${TONE_TEXT[presentation.tone]}`} />;
          })}
        </span>
      </span>

      <span className="font-spell text-sm leading-tight font-semibold break-words">{name}</span>

      <span className="flex flex-col gap-0.5 text-xs leading-tight text-muted">
        {rules.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </span>

      {refusal !== null && (
        <span data-refusal className="mt-auto text-xs leading-tight text-danger">
          {cardRefusalMessage(t, refusal, spell)}
        </span>
      )}
    </button>
  );
}
