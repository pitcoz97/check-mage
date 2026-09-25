import type { TFunction } from 'i18next';

import { it } from '../i18n/locales/it';
import { effectPresentation, spellRulesText } from './effects.registry';
import type { Rarity, Spell } from './schema';

/**
 * Nome, testo e riga del tipo di una carta (ASSUMPTIONS §7, M4 e M14).
 *
 * Nomi e testi stanno nell'i18n, sotto la chiave dell'id della magia: è una ricerca di chiave, non un ramo per
 * magia. Una magia che l'i18n non conosce ancora (un server più nuovo del client) mostra il nome del catalogo e il
 * testo generato dagli effetti; di una magia che nemmeno il catalogo conosce resta l'id.
 */

type CatalogId = keyof typeof it.spells.catalog;
type TagId = keyof typeof it.spells.tag;

function isCatalogId(id: string): id is CatalogId {
  return Object.hasOwn(it.spells.catalog, id);
}

function isTagId(tag: string): tag is TagId {
  return Object.hasOwn(it.spells.tag, tag);
}

export function spellName(t: TFunction, spell: Spell | undefined, spellId: string): string {
  if (isCatalogId(spellId)) return t(`spells.catalog.${spellId}.name`);
  return spell?.name ?? spellId;
}

/** Testo di regole, una riga per paragrafo. Vuoto se il catalogo non conosce la magia: non si inventa nulla. */
export function spellText(t: TFunction, spell: Spell | undefined, spellId: string): string[] {
  if (spell === undefined) return [];
  if (isCatalogId(spellId)) return [t(`spells.catalog.${spellId}.text`)];
  return spellRulesText(t, spell.effects);
}

/** "Magia · Gelo": l'archetipo è il primo tag; senza tag noti si ripiega sul kind del primo effetto. */
export function spellTypeLine(t: TFunction, spell: Spell | undefined): string {
  const tag = spell?.tags.find(isTagId);
  if (tag !== undefined) return t('spells.card.type', { kind: t(`spells.tag.${tag}`) });
  const first = spell?.effects[0];
  return first === undefined ? t('spells.card.typePlain') : t('spells.card.type', { kind: effectPresentation(first.kind).label(t) });
}

/** Classe della cornice e del rombo per rarità: comune = grigio, leggendaria = la "mitica" del design. */
export const RARITY_FRAME: Record<Rarity, { readonly border: string; readonly gem: string }> = {
  common: { border: 'border-rarity-common', gem: 'bg-rarity-common' },
  legendary: { border: 'border-rarity-mythic', gem: 'bg-rarity-mythic' },
};
