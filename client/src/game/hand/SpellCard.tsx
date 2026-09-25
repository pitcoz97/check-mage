import { useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { effectPresentation, spellRulesText } from '../../spells/effects.registry';
import { EffectIcon } from '../../spells/icons/EffectIcon';
import type { CardRefusal } from '../../spells/playability';
import type { Spell } from '../../spells/schema';
import { spellCardLabel } from './cardLabel';

/**
 * Carta magia nella struttura del componente Carta del design (REDESIGN_PLAN.md §3.3), a 200×280 nominali: chi la
 * mostra più piccola la scala (la mano, come nel design). Tutto arriva dal catalogo e dai registry: costo, nome,
 * arte e testo di regole. Nessun ramo per una magia in particolare, e una magia che il client non conosce si vede
 * comunque.
 *
 * Rarità e tipo non sono nel catalogo (P2-15): la cornice è quella della rarità comune e la riga del tipo nasce dal
 * kind del primo effetto (D7). La carta non giocabile è **scurita** da un velo, mai trasparente (D5).
 */

/** Corpo del nome: parte da quello del design e scende fino al minimo; sotto va a capo (D6). */
const NAME_SIZE_PX = 13;
const NAME_MIN_PX = 10;

export interface SpellCardFaceProps {
  /** `undefined` quando il catalogo non conosce lo `spell_id` che il server ha messo in mano. */
  readonly spell: Spell | undefined;
  readonly spellId: string;
  /** Carta non giocabile ora: il velo scuro sopra. */
  readonly dimmed?: boolean;
}

/** La faccia della carta: solo presentazione. Il testo accessibile lo porta chi la rende cliccabile. */
export function SpellCardFace({ spell, spellId, dimmed = false }: SpellCardFaceProps) {
  const { t } = useTranslation();
  const name = spell?.name ?? spellId;
  // Di una magia che il catalogo non conosce non si inventa il testo: resta il nome.
  const rules = spell === undefined ? [] : spellRulesText(t, spell.effects);
  const first = spell?.effects[0];
  const presentation = effectPresentation(first?.kind ?? 'unknown');
  const type = first === undefined ? t('spells.card.typePlain') : t('spells.card.type', { kind: presentation.label(t) });
  const nameRef = useFittedName(name);

  return (
    <span
      aria-hidden="true"
      data-card-face
      className="relative flex h-[280px] w-[200px] flex-col rounded-12 border-2 border-rarity-common bg-card-frame p-1.5 text-left text-primary shadow-card"
    >
      <span className="flex grow flex-col overflow-hidden rounded-8 bg-card-inner">
        <span className="flex h-8 shrink-0 items-center justify-between gap-1.5 bg-elevated pr-[5px] pl-2.5">
          <span ref={nameRef} data-card-name className="min-w-0 font-display leading-[1.05] font-bold tracking-[0.02em] whitespace-nowrap">
            {name}
          </span>
          <span
            data-card-cost
            className="flex size-6 shrink-0 items-center justify-center rounded-full bg-gold text-14 font-extrabold text-on-gold shadow-edge-coin"
          >
            {spell === undefined ? t('spells.costUnknown') : spell.manaCost}
          </span>
        </span>

        <span className={`relative flex h-[100px] shrink-0 items-center justify-center border-y border-card-frame ${presentation.art.bg}`}>
          <svg viewBox="0 0 100 100" className="absolute size-[92px] stroke-art-ring" fill="none" strokeWidth="1.2">
            <circle cx="50" cy="50" r="44" />
            <circle cx="50" cy="50" r="36" strokeDasharray="3 5" />
            <path d="M50 2v10M50 88v10M2 50h10M88 50h10" />
          </svg>
          <EffectIcon name={presentation.icon} className={`relative size-[52px] ${presentation.art.ink}`} />
        </span>

        <span className="flex h-[22px] shrink-0 items-center justify-between border-b border-card-frame bg-elevated pr-2 pl-2.5">
          <span data-card-type className="text-[10.5px] font-bold tracking-[0.08em] text-card-type uppercase">
            {type}
          </span>
          <span className="size-[9px] rotate-45 bg-rarity-common shadow-ring-card-frame" />
        </span>

        <span data-card-rules className="flex grow flex-col gap-1 bg-parchment px-2.5 py-2 text-12 leading-[1.35] font-medium text-on-parchment">
          {rules.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </span>
      </span>
      {dimmed && <span data-card-veil className="absolute inset-0 rounded-10 bg-card-disabled" />}
    </span>
  );
}

/**
 * Nome su una riga al corpo del design; se non entra, il corpo scende fino al minimo e poi il nome va a capo.
 * Si misura il DOM dopo il render: niente stato, così nessun secondo render.
 */
function useFittedName(name: string) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (node === null) return;
    node.style.whiteSpace = 'nowrap';
    node.style.overflowWrap = 'normal';
    let size = NAME_SIZE_PX;
    node.style.fontSize = `${size}px`;
    while (node.scrollWidth > node.clientWidth && size > NAME_MIN_PX) {
      size -= 0.5;
      node.style.fontSize = `${size}px`;
    }
    // A capo anche dentro una parola: un id senza spazi (magia sconosciuta) altrimenti non si spezzerebbe.
    if (node.scrollWidth > node.clientWidth) {
      node.style.whiteSpace = 'normal';
      node.style.overflowWrap = 'anywhere';
    }
  }, [name]);
  return ref;
}

export interface SpellCardProps extends SpellCardFaceProps {
  /** Motivo per cui non è giocabile ora, `null` se lo è. */
  readonly refusal: CardRefusal | null;
  readonly selected?: boolean;
  readonly onPick?: (() => void) | undefined;
}

/** Carta a grandezza piena e cliccabile: la galleria di sviluppo. In partita le carte le rende la mano. */
export function SpellCard({ spell, spellId, refusal, selected = false, onPick }: SpellCardProps) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      data-card={spellId}
      data-playable={refusal === null}
      data-selected={selected}
      aria-disabled={refusal !== null}
      aria-label={spellCardLabel(t, spell, spellId, refusal)}
      onClick={onPick}
      className={`rounded-12 p-0 ${selected ? 'shadow-glow-selected' : ''}`}
    >
      <SpellCardFace spell={spell} spellId={spellId} dimmed={refusal !== null} />
    </button>
  );
}
