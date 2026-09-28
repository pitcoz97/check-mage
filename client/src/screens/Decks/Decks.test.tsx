// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { routes } from '../../app/router';
import { initI18n } from '../../i18n';
import { createWebStorage } from '../../lib/storage';
import { CatalogProvider } from '../../spells/CatalogProvider';
import fallbackCatalog from '../../spells/fallback.json';
import { AuthProvider } from '../../store/AuthProvider';
import { createAuth } from '../../store/authStore';
import { MatchProvider } from '../../store/MatchProvider';
import { testCatalogStore } from '../../testing/catalog';
import { ACCOUNT, data, fail, fakeServer, memoryStorage } from '../../testing/fakes';
import { testMatchSession } from '../../testing/session';

/** Collezione del set iniziale: comuni 2, rare 1, leggendarie 0. */
const COLLECTION = {
  cards: fallbackCatalog.map((spell) => ({
    spell_id: spell.id,
    copies: spell.rarity === 'common' ? 2 : spell.rarity === 'rare' ? 1 : 0,
    max_copies: spell.rarity === 'legendary' ? 1 : 2,
  })),
  owned: 45,
  total: 59,
};

const commons = fallbackCatalog.filter((s) => s.rarity === 'common').map((s) => s.id);
const rares = fallbackCatalog.filter((s) => s.rarity === 'rare').map((s) => s.id);
/** 40 carte valide: tutte le comuni a 2 (36) e quattro rare a 1. */
const FULL = [...commons.map((id) => ({ spell_id: id, copies: 2 })), ...rares.slice(0, 4).map((id) => ({ spell_id: id, copies: 1 }))];

type WireDeck = { id: number; name: string; cards: { spell_id: string; copies: number }[]; size: number; valid: boolean; active: boolean; updated_at: string };

function deck(id: number, name: string, cards: WireDeck['cards'], active: boolean, day: number): WireDeck {
  const size = cards.reduce((n, c) => n + c.copies, 0);
  return { id, name, cards, size, valid: size === 40, active, updated_at: `2026-09-${String(day).padStart(2, '0')}T10:00:00Z` };
}

interface Harness {
  decks: WireDeck[];
  requests: { key: string; body: unknown }[];
  failSave: boolean;
}

async function renderDecks(path: string) {
  const h: Harness = {
    decks: [deck(1, 'Mazzo iniziale', FULL, true, 20), deck(2, 'Gelo', [{ spell_id: 'frost', copies: 2 }], false, 27), deck(3, 'Sacro', FULL, false, 25)],
    requests: [],
    failSave: false,
  };
  const list = () => data({ decks: h.decks, max_decks: 10, deck_size: 40 });
  const record = (key: string, init: RequestInit | undefined) => {
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    h.requests.push({ key, body });
    return body as { name: string; cards: WireDeck['cards'] } | null;
  };
  const routesFor: Record<string, (init: RequestInit | undefined) => Response> = {
    'GET /me': () => data(ACCOUNT),
    'GET /ws/ticket': () => data({ ticket: 't', expires_in: 30 }),
    'GET /me/collection': () => data(COLLECTION),
    'GET /me/decks': list,
    'POST /me/decks': (init) => {
      const body = record('POST /me/decks', init);
      const created = deck(9, body?.name ?? '', body?.cards ?? [], false, 28);
      h.decks = [...h.decks, created];
      return data(created, 201);
    },
  };
  for (const id of [1, 2, 3, 9]) {
    routesFor[`PUT /me/decks/${id}`] = (init) => {
      const body = record(`PUT /me/decks/${id}`, init);
      if (h.failSave) return fail(400, 'Copie non possedute');
      const current = h.decks.find((d) => d.id === id);
      const updated = deck(id, body?.name ?? '', body?.cards ?? [], current?.active ?? false, 28);
      h.decks = h.decks.map((d) => (d.id === id ? updated : d));
      return data(updated);
    };
    routesFor[`POST /me/decks/${id}/activate`] = (init) => {
      record(`POST /me/decks/${id}/activate`, init);
      h.decks = h.decks.map((d) => ({ ...d, active: d.id === id }));
      return list();
    };
    routesFor[`DELETE /me/decks/${id}`] = (init) => {
      record(`DELETE /me/decks/${id}`, init);
      const removed = h.decks.find((d) => d.id === id);
      h.decks = h.decks.filter((d) => d.id !== id);
      if (removed?.active === true && h.decks[0] !== undefined) h.decks[0] = { ...h.decks[0], active: true };
      return list();
    };
  }
  const { storage } = memoryStorage();
  await storage.set('session', JSON.stringify({ accessToken: 'a1', refreshToken: 'r1' }));
  const server = fakeServer(routesFor);
  const auth = createAuth({ baseUrl: 'http://api', storage, fetchImpl: server.fetchImpl });
  const { session } = testMatchSession(auth, storage);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AuthProvider auth={auth}>
      <CatalogProvider store={testCatalogStore()}>
        <MatchProvider session={session}>
          <RouterProvider router={router} />
        </MatchProvider>
      </CatalogProvider>
    </AuthProvider>,
  );
  return { router, h };
}

function setDesktop(on: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: on ? (query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} }) : undefined,
  });
}

const click = async (element: Element) => {
  await act(async () => {
    fireEvent.click(element);
  });
};

beforeAll(async () => {
  await initI18n(createWebStorage(() => undefined));
});

afterEach(() => {
  cleanup();
  setDesktop(false);
});

describe('Mazzi · Android', () => {
  it('la lista: prima l’attivo, poi i più recenti; bozza e «Attivo»; «+ Nuovo mazzo» crea e apre', async () => {
    const { router, h } = await renderDecks('/decks');
    await screen.findByRole('heading', { name: 'Mazzi', level: 1 });
    const links = [...document.querySelectorAll('a[data-deck]')];
    expect(links.map((a) => a.getAttribute('data-deck'))).toEqual(['1', '2', '3']);
    expect(links[0]?.textContent).toContain('Attivo');
    expect(links[1]?.textContent).toContain('Bozza · 2/40');
    await click(screen.getByRole('button', { name: 'Nuovo mazzo' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/decks/9'));
    expect(h.requests[0]).toEqual({ key: 'POST /me/decks', body: { name: 'Nuovo mazzo', cards: [] } });
  });

  it('l’editor: schede, aggiunta dalla griglia, − e +, salvataggio', async () => {
    const { h } = await renderDecks('/decks/2');
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Mazzo · 2 / 40', '+ Aggiungi carte']);
    expect(document.querySelector('[data-deck-valid]')?.textContent).toBe('Mancano 38 carte');
    await click(tabs[1] as HTMLElement);
    // Brina è già a 2 su 2: «Max». Scudo si aggiunge.
    expect(document.querySelector('[data-card="frost"]')?.getAttribute('data-state')).toBe('max');
    expect(document.querySelector('[data-card="haste"]')?.getAttribute('data-state')).toBe('locked');
    await click(document.querySelector('[data-card="shield"]') as HTMLElement);
    expect(document.querySelector('[data-card="shield"] [data-in-deck]')?.textContent).toBe('×1');
    await click(screen.getAllByRole('tab')[0] as HTMLElement);
    expect(screen.getAllByRole('tab')[0]?.textContent).toBe('Mazzo · 3 / 40');
    await click(screen.getByRole('button', { name: 'Togli Brina' }));
    expect((screen.getByRole('button', { name: 'Aggiungi Brina' }) as HTMLButtonElement).disabled).toBe(false);
    await click(screen.getByRole('button', { name: 'Salva mazzo' }));
    await waitFor(() => expect(h.requests.map((r) => r.key)).toContain('PUT /me/decks/2'));
    expect(h.requests.find((r) => r.key === 'PUT /me/decks/2')?.body).toEqual({
      name: 'Gelo',
      cards: [
        { spell_id: 'frost', copies: 1 },
        { spell_id: 'shield', copies: 1 },
      ],
    });
    // Dopo il salvataggio l'editor riparte dal mazzo del server: niente più modifiche.
    await waitFor(() => expect((screen.getByRole('button', { name: 'Salva mazzo' }) as HTMLButtonElement).disabled).toBe(true));
  });

  it('il menu: «Usa in partita» su un mazzo valido; un errore del server si mostra per codice', async () => {
    const { h } = await renderDecks('/decks/3');
    await click(await screen.findByRole('button', { name: 'Altre azioni' }));
    await click(screen.getByRole('menuitem', { name: 'Usa in partita' }));
    await waitFor(() => expect(h.requests.map((r) => r.key)).toContain('POST /me/decks/3/activate'));

    h.failSave = true;
    fireEvent.change(screen.getByRole('textbox', { name: 'Nome del mazzo' }), { target: { value: 'Sacro 2' } });
    await click(screen.getByRole('button', { name: 'Salva mazzo' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Il mazzo usa copie che non possiedi.');
  });
});

describe('Mazzi · desktop', () => {
  it('apre il mazzo attivo con schede, griglia, curva e stato', async () => {
    setDesktop(true);
    await renderDecks('/decks');
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(tabs[0]?.textContent).toContain('Attivo');
    expect(document.querySelector('[data-deck-valid]')?.textContent).toBe('Mazzo valido');
    expect(screen.getByRole('img', { name: /^Curva di mana: 0 mana 2, 1 mana 6/ })).toBeTruthy();
    // Mazzo pieno: le carte possedute non ancora al massimo dicono «Mazzo pieno».
    expect(document.querySelector(`[data-card="${rares[4] ?? ''}"]`)?.getAttribute('data-state')).toBe('full');
    expect(screen.queryByRole('button', { name: 'Usa in partita' })).toBeNull();
  });

  it('il mazzo attivo resta valido; «Svuota» e «Autocompleta»', async () => {
    setDesktop(true);
    await renderDecks('/decks/1');
    await click(await screen.findByRole('button', { name: 'Svuota' }));
    expect(document.querySelector('[data-deck-valid]')?.textContent).toBe('Mancano 40 carte');
    expect((screen.getByRole('button', { name: 'Salva mazzo' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Il mazzo attivo deve restare valido/)).toBeTruthy();
    await click(screen.getByRole('button', { name: 'Autocompleta' }));
    expect(document.querySelector('[data-deck-valid]')?.textContent).toBe('Mazzo valido');
    // Autocompleta parte dalle più economiche: Patto di sangue (0) è nel mazzo.
    expect(document.querySelector('[data-row="blood_pact"]')).toBeTruthy();
  });

  it('cambiare mazzo con modifiche non salvate chiede conferma', async () => {
    setDesktop(true);
    const { router } = await renderDecks('/decks/2');
    await click(await screen.findByRole('button', { name: /^Aggiungi: Scudo,/ }));
    await click(screen.getAllByRole('tab')[2] as HTMLElement);
    const dialog = await screen.findByRole('alertdialog');
    expect(router.state.location.pathname).toBe('/decks/2');
    await click(within(dialog).getByRole('button', { name: 'Resta' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await click(screen.getAllByRole('tab')[2] as HTMLElement);
    await click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Esci senza salvare' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/decks/3'));
  });

  it('«Usa in partita» ed «Elimina mazzo» con conferma', async () => {
    setDesktop(true);
    const { router, h } = await renderDecks('/decks/3');
    await click(await screen.findByRole('button', { name: 'Usa in partita' }));
    await waitFor(() => expect(screen.getAllByRole('tab')[2]?.textContent).toContain('Attivo'));
    await click(screen.getByRole('button', { name: 'Elimina mazzo' }));
    const confirm = screen.getByRole('group', { name: 'Elimina mazzo' });
    await click(within(confirm).getByRole('button', { name: 'Elimina' }));
    await waitFor(() => expect(h.requests.map((r) => r.key)).toContain('DELETE /me/decks/3'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/decks'));
    expect(screen.getAllByRole('tab')).toHaveLength(2);
  });
});
