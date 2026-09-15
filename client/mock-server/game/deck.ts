import { opaqueId, shuffle, type Rng } from '../util';
import { DECK_COMPOSITION } from './catalog';

export interface Card {
  /** Id d'istanza opaco (G2). */
  id: string;
  spellId: string;
}

/**
 * Mazzo da 40 carte mescolato con seed. `top` (solo per gli scenari) forza l'ordine delle prime carte:
 * ogni voce prende una copia dal mazzo, così la composizione resta quella di §3.4.
 */
export function buildDeck(rng: Rng, top: readonly string[] = []): Card[] {
  const pool = shuffle(
    Object.entries(DECK_COMPOSITION).flatMap(([spellId, copies]) => Array.from({ length: copies }, () => spellId)),
    rng,
  );
  const head: string[] = [];
  for (const spellId of top) {
    const index = pool.indexOf(spellId);
    if (index >= 0) pool.splice(index, 1);
    head.push(spellId);
  }
  return [...head, ...pool].map((spellId) => ({ id: opaqueId('c', rng), spellId }));
}
