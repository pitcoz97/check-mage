import { DECK_SIZE } from '../game/catalog';
import { blockingProblem, deckSize, expand, MAX_DECKS, starterDeck, validateDeck, validDeckName, type DeckCards } from '../game/decks';
import { HTTP, type ServerText } from '../serverTexts';
import type { CollectionStore } from './collection';

/**
 * Porting di `handlers/decks.go` e `db/decks.go`: i mazzi personali in memoria, con le stesse regole e gli stessi
 * errori (D1–D6).
 */

export const STARTER_DECK_NAME = 'Mazzo iniziale';

interface DeckRow {
  id: number;
  name: string;
  cards: DeckCards;
  active: boolean;
  updatedAt: Date;
}

export interface WireDeck {
  readonly id: number;
  readonly name: string;
  readonly cards: readonly { spell_id: string; copies: number }[];
  readonly size: number;
  readonly valid: boolean;
  readonly active: boolean;
  readonly updated_at: string;
}

export interface WireDeckList {
  readonly decks: readonly WireDeck[];
  readonly max_decks: number;
  readonly deck_size: number;
}

export type DeckResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: ServerText };

const failure = (status: number, error: ServerText): DeckResult<never> => ({ ok: false, status, error });

export function createDeckStore(collections: CollectionStore) {
  const byUser = new Map<number, DeckRow[]>();
  let nextId = 0;
  // Orologio monotono: due scritture nello stesso millisecondo restano ordinate (D5).
  let lastStamp = 0;
  const stamp = () => {
    lastStamp = Math.max(Date.now(), lastStamp + 1);
    return new Date(lastStamp);
  };

  const isValid = (cards: DeckCards, owned: ReadonlyMap<string, number>) => validateDeck(cards, owned).length === 0;

  function insert(userId: number, name: string, cards: DeckCards, active: boolean): DeckRow {
    const rows = byUser.get(userId) ?? [];
    if (active) for (const row of rows) row.active = false;
    const row: DeckRow = { id: ++nextId, name, cards: new Map(cards), active, updatedAt: stamp() };
    rows.push(row);
    byUser.set(userId, rows);
    return row;
  }

  /** `userDecks`: a chi non ha mazzi il mazzo iniziale, attivo (D4). */
  function userDecks(userId: number): { rows: DeckRow[]; owned: ReadonlyMap<string, number> } {
    const owned = collections.owned(userId);
    let rows = byUser.get(userId) ?? [];
    if (rows.length === 0) {
      const starter = starterDeck(owned);
      insert(userId, STARTER_DECK_NAME, starter, isValid(starter, owned));
      rows = byUser.get(userId) ?? [];
    }
    return { rows, owned };
  }

  function view(row: DeckRow, owned: ReadonlyMap<string, number>): WireDeck {
    return {
      id: row.id,
      name: row.name,
      cards: [...row.cards.keys()].sort().map((id) => ({ spell_id: id, copies: row.cards.get(id) ?? 0 })),
      size: deckSize(row.cards),
      valid: isValid(row.cards, owned),
      active: row.active,
      updated_at: row.updatedAt.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    };
  }

  function list(userId: number): WireDeckList {
    const { rows, owned } = userDecks(userId);
    return { decks: rows.map((row) => view(row, owned)), max_decks: MAX_DECKS, deck_size: DECK_SIZE };
  }

  /** `readDeck`: nome ammesso e nessun problema bloccante (le bozze corte si salvano, D3). */
  function readDeck(body: Record<string, unknown> | null, owned: ReadonlyMap<string, number>): DeckResult<{ name: string; cards: DeckCards }> {
    if (body === null) return failure(400, HTTP.invalidBody);
    const name = validDeckName(typeof body['name'] === 'string' ? body['name'] : '');
    if (name === null) return failure(400, HTTP.deckName);
    const cards: DeckCards = new Map();
    const raw = body['cards'] ?? [];
    if (!Array.isArray(raw)) return failure(400, HTTP.invalidBody);
    for (const entry of raw as unknown[]) {
      const record = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {};
      const id = record['spell_id'];
      const copies = record['copies'];
      if (typeof id !== 'string' || id === '' || typeof copies !== 'number' || !Number.isInteger(copies) || copies < 0) {
        return failure(400, HTTP.invalidBody);
      }
      if (copies > 0) cards.set(id, (cards.get(id) ?? 0) + copies);
    }
    const blocking = blockingProblem(validateDeck(cards, owned));
    if (blocking !== null) {
      const text = { unknown_spell: HTTP.deckUnknown, too_many_copies: HTTP.deckCopies, not_owned: HTTP.deckNotOwned, deck_size: HTTP.deckNotValid }[blocking.code];
      return failure(400, text);
    }
    return { ok: true, status: 200, data: { name, cards } };
  }

  return {
    list: (userId: number): DeckResult<WireDeckList> => ({ ok: true, status: 200, data: list(userId) }),

    create(userId: number, body: Record<string, unknown> | null): DeckResult<WireDeck> {
      const { rows, owned } = userDecks(userId);
      const read = readDeck(body, owned);
      if (!read.ok) return read;
      if (rows.length >= MAX_DECKS) return failure(400, HTTP.deckLimit);
      return { ok: true, status: 201, data: view(insert(userId, read.data.name, read.data.cards, false), owned) };
    },

    update(userId: number, id: number, body: Record<string, unknown> | null): DeckResult<WireDeck> {
      const { rows, owned } = userDecks(userId);
      const row = rows.find((r) => r.id === id);
      if (row === undefined) return failure(404, HTTP.deckNotFound);
      const read = readDeck(body, owned);
      if (!read.ok) return read;
      if (row.active && !isValid(read.data.cards, owned)) return failure(400, HTTP.deckNotValid);
      row.name = read.data.name;
      row.cards = new Map(read.data.cards);
      row.updatedAt = stamp();
      return { ok: true, status: 200, data: view(row, owned) };
    },

    /** L'ultimo mazzo resta; se era l'attivo, diventa attivo il valido più recente o si ricrea l'iniziale (D5). */
    remove(userId: number, id: number): DeckResult<WireDeckList> {
      const { rows, owned } = userDecks(userId);
      const target = rows.find((r) => r.id === id);
      if (target === undefined) return failure(404, HTTP.deckNotFound);
      if (rows.length === 1) return failure(400, HTTP.deckLast);
      const rest = rows.filter((r) => r.id !== id);
      byUser.set(userId, rest);
      if (target.active) {
        const next = rest.filter((r) => isValid(r.cards, owned)).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
        if (next !== undefined) next.active = true;
        else insert(userId, STARTER_DECK_NAME, starterDeck(owned), true);
      }
      return { ok: true, status: 200, data: list(userId) };
    },

    activate(userId: number, id: number): DeckResult<WireDeckList> {
      const { rows, owned } = userDecks(userId);
      const target = rows.find((r) => r.id === id);
      if (target === undefined) return failure(404, HTTP.deckNotFound);
      if (!isValid(target.cards, owned)) return failure(400, HTTP.deckNotValid);
      for (const row of rows) row.active = row.id === id;
      return { ok: true, status: 200, data: list(userId) };
    },

    /** `ActiveDeck`: il mazzo attivo espanso per la partita, e se è valido (D6). */
    activeDeck(userId: number): { cards: string[]; valid: boolean } {
      const { rows, owned } = userDecks(userId);
      const active = rows.find((r) => r.active);
      return active === undefined ? { cards: [], valid: false } : { cards: expand(active.cards), valid: isValid(active.cards, owned) };
    },

    /** Solo test ed e2e: sostituisce le carte del mazzo attivo senza controlli (per provare `deck_invalid`). */
    forceActiveCards(userId: number, cards: DeckCards): void {
      const active = userDecks(userId).rows.find((r) => r.active);
      if (active !== undefined) active.cards = new Map(cards);
    },
  };
}

export type DeckStore = ReturnType<typeof createDeckStore>;
