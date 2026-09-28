// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

/** Il set iniziale del server: comuni 2, rare 1, leggendarie 0 (45 / 59). */
const STARTER = {
  cards: fallbackCatalog.map((spell) => ({
    spell_id: spell.id,
    copies: spell.rarity === 'common' ? 2 : spell.rarity === 'rare' ? 1 : 0,
    max_copies: spell.rarity === 'legendary' ? 1 : 2,
  })),
  owned: 45,
  total: 59,
};

async function renderCollection(collection: () => Response = () => data(STARTER)) {
  const { storage } = memoryStorage();
  await storage.set('session', JSON.stringify({ accessToken: 'a1', refreshToken: 'r1' }));
  const server = fakeServer({
    'GET /me': () => data(ACCOUNT),
    'GET /ws/ticket': () => data({ ticket: 't', expires_in: 30 }),
    'GET /me/collection': () => collection(),
  });
  const auth = createAuth({ baseUrl: 'http://api', storage, fetchImpl: server.fetchImpl });
  const { session } = testMatchSession(auth, storage);
  const router = createMemoryRouter(routes, { initialEntries: ['/collection'] });
  render(
    <AuthProvider auth={auth}>
      <CatalogProvider store={testCatalogStore()}>
        <MatchProvider session={session}>
          <RouterProvider router={router} />
        </MatchProvider>
      </CatalogProvider>
    </AuthProvider>,
  );
  return { router, server };
}

const tiles = () => document.querySelectorAll('[data-card]');

beforeAll(async () => {
  await initI18n(createWebStorage(() => undefined));
});

afterEach(() => {
  cleanup();
});

describe('Collezione', () => {
  it('carica le 32 magie con il contatore del server; la voce di navigazione è attiva', async () => {
    await renderCollection();
    expect(await screen.findByRole('heading', { name: 'Collezione', level: 1 })).toBeTruthy();
    expect(tiles()).toHaveLength(32);
    const progress = screen.getByRole('progressbar', { name: 'Possiedi 45 copie su 59' });
    expect(progress.getAttribute('aria-valuenow')).toBe('45');
    expect(screen.getByText('32 carte mostrate')).toBeTruthy();
    const nav = screen.getAllByRole('link', { name: 'Collezione' });
    expect(nav.length).toBeGreaterThan(0);
    expect(nav.every((link) => link.getAttribute('aria-current') === 'page')).toBe(true);
  });

  it('una carta non posseduta lo dice nell’etichetta; i rombi seguono il massimo della rarità', async () => {
    await renderCollection();
    const haste = await screen.findByRole('button', { name: /^Fretta, costo 6, Non posseduta$/ });
    expect(haste.getAttribute('data-locked')).toBe('true');
    expect(screen.getByRole('button', { name: /^Brina, costo 1, 2 copie$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Frantumare, costo 4, 1 copia$/ })).toBeTruthy();
    expect(haste.closest('li')?.querySelector('[data-pips]')?.getAttribute('data-pips')).toBe('0/1');
  });

  it('filtri: rarità, costo, solo possedute e ricerca riducono la griglia e il contatore', async () => {
    await renderCollection();
    await screen.findByRole('heading', { name: 'Collezione', level: 1 });
    const rarity = screen.getByRole('group', { name: 'Rarità' });
    fireEvent.click(within(rarity).getByRole('button', { name: 'Leggendarie' }));
    expect(tiles()).toHaveLength(5);
    expect(screen.getByText('5 carte mostrate')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Solo possedute' }));
    expect(tiles()).toHaveLength(0);
    expect(screen.getByText('Nessuna carta con questi filtri.')).toBeTruthy();
    fireEvent.click(within(rarity).getByRole('button', { name: 'Tutte' }));
    fireEvent.click(screen.getByRole('button', { name: 'Solo possedute' }));
    fireEvent.click(screen.getByRole('button', { name: 'Costo 7+' }));
    expect(tiles()).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Costo: tutti' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Cerca una carta' }), { target: { value: 'brina' } });
    expect(screen.getByText('1 carta mostrata')).toBeTruthy();
    expect([...tiles()].map((tile) => tile.getAttribute('data-card'))).toEqual(['frost']);
  });

  it('ordina per nome', async () => {
    await renderCollection();
    await screen.findByRole('heading', { name: 'Collezione', level: 1 });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'name' } });
    // "Anima inquieta" è la prima in ordine alfabetico, "Scudo reale" la penultima prima di "Stendardo".
    expect(tiles()[0]?.getAttribute('data-card')).toBe('restless_soul');
    expect(tiles()[31]?.getAttribute('data-card')).toBe('banner');
  });

  it('toccare una carta apre il foglio di dettaglio; Esc lo chiude e il focus torna alla carta', async () => {
    await renderCollection();
    const frost = await screen.findByRole('button', { name: /^Brina,/ });
    frost.focus();
    fireEvent.click(frost);
    const dialog = screen.getByRole('dialog', { name: 'Dettaglio carta' });
    expect(within(dialog).getByRole('heading', { name: 'Brina' })).toBeTruthy();
    expect(within(dialog).getByText('2 / 2')).toBeTruthy();
    expect(within(dialog).getByText('Magie 1')).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Chiudi' }));
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(frost);

    fireEvent.click(screen.getByRole('button', { name: /^Fretta,/ }));
    expect(within(screen.getByRole('dialog')).getByText('Non hai ancora questa carta.')).toBeTruthy();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Chiudi' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('il pannello di dettaglio parte dalla prima carta e segue la selezione', async () => {
    await renderCollection();
    const panel = await screen.findByRole('complementary', { name: 'Dettaglio carta' });
    expect(within(panel).getByRole('heading', { name: 'Patto di sangue' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Brina,/ }));
    expect(within(screen.getByRole('complementary', { name: 'Dettaglio carta' })).getByRole('heading', { name: 'Brina' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Brina,/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('errore del server: messaggio e riprova', async () => {
    let calls = 0;
    await renderCollection(() => (++calls === 1 ? fail(500, 'Errore recupero collezione') : data(STARTER)));
    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByText('32 carte mostrate')).toBeTruthy();
  });
});
