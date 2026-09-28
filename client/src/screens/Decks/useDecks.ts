import { useCallback, useEffect, useState } from 'react';

import type { ApiResult } from '../../api/endpoints';
import type { Deck, DeckList, HttpErrorCode } from '../../api/types';
import { useApi } from '../../store/AuthProvider';

export type DecksState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ready'; readonly list: DeckList };

/** Esito di una scrittura: ok, o il codice dell'errore da mostrare (mai il testo del server). */
export type DeckWrite<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: HttpErrorCode | null };

/**
 * Mazzi da `GET /me/decks`, con le scritture (`handlers/decks.go`). Un mazzo creato o salvato sostituisce il suo nella
 * lista; eliminazione e attivazione rispondono con la lista intera, perché il mazzo attivo può cambiare (D5).
 */
export function useDecks() {
  const api = useApi();
  const [state, setState] = useState<DecksState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void api.fetchDecks().then((result) => {
      if (active) setState(result.ok ? { kind: 'ready', list: result.value } : { kind: 'error' });
    });
    return () => {
      active = false;
    };
  }, [api, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  const settle = useCallback(
    <T>(result: ApiResult<T>, apply?: (value: T) => void): DeckWrite<T> => {
      if (!result.ok) return { ok: false, code: result.error.code };
      apply?.(result.value);
      return { ok: true, value: result.value };
    },
    [],
  );

  const setList = useCallback((list: DeckList) => setState({ kind: 'ready', list }), []);
  // Il mazzo salvato entra subito nella lista: niente rilettura, quindi niente attesa prima di aprirlo.
  const putDeck = useCallback(
    (deck: Deck) =>
      setState((current) => {
        if (current.kind !== 'ready') return current;
        const decks = current.list.decks.some((d) => d.id === deck.id)
          ? current.list.decks.map((d) => (d.id === deck.id ? deck : d))
          : [...current.list.decks, deck];
        return { kind: 'ready', list: { ...current.list, decks } };
      }),
    [],
  );

  return {
    state,
    retry: () => {
      setState({ kind: 'loading' });
      reload();
    },
    async create(name: string, cards: ReadonlyMap<string, number>): Promise<DeckWrite<Deck>> {
      return settle(await api.createDeck(name, cards), putDeck);
    },
    async update(id: string, name: string, cards: ReadonlyMap<string, number>): Promise<DeckWrite<Deck>> {
      return settle(await api.updateDeck(id, name, cards), putDeck);
    },
    async remove(id: string): Promise<DeckWrite<DeckList>> {
      return settle(await api.deleteDeck(id), setList);
    },
    async activate(id: string): Promise<DeckWrite<DeckList>> {
      return settle(await api.activateDeck(id), setList);
    },
  };
}

export type DecksApi = ReturnType<typeof useDecks>;
