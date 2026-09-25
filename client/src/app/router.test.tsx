// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { boardThemeStore } from '../game/board/boardTheme';
import { changeLanguage, initI18n } from '../i18n';
import { createWebStorage } from '../lib/storage';
import { AuthProvider } from '../store/AuthProvider';
import { createAuth } from '../store/authStore';
import { CatalogProvider } from '../spells/CatalogProvider';
import { MatchProvider } from '../store/MatchProvider';
import { testCatalogStore } from '../testing/catalog';
import { testMatchSession } from '../testing/session';
import { ACCOUNT, data, fakeServer, memoryStorage } from '../testing/fakes';
import { routes } from './router';

const languageStore = createWebStorage(() => undefined);

/** Classifica del server finto: i test la sostituiscono per provare dati ed errori. */
let leaderboard: () => Response = () =>
  data([
    { rank: 1, id: 21, username: 'VoidRook', elo: 2014 },
    { rank: 2, id: 22, username: 'Ser_Knight', elo: 1978 },
    { rank: 3, id: 23, username: 'Lady_Ember', elo: 1951 },
    { rank: 4, id: 7, username: 'mario', elo: 1234 },
  ]);

/** Utente già autenticato: sessione salvata e `/me` valido. */
async function renderAuthenticated(path: string) {
  const { storage } = memoryStorage();
  await storage.set('session', JSON.stringify({ accessToken: 'a1', refreshToken: 'r1' }));
  let ticket = 0;
  const server = fakeServer({
    'GET /me': () => data(ACCOUNT),
    'GET /users/7': () => data({ user: ACCOUNT, stats: { wins: 1, losses: 0, draws: 0, total: 1 } }),
    'GET /ws/ticket': () => data({ ticket: `t${++ticket}`, expires_in: 30 }),
    'GET /leaderboard': () => leaderboard(),
  });
  const auth = createAuth({ baseUrl: 'http://api', storage, fetchImpl: server.fetchImpl });
  const { session, sockets } = testMatchSession(auth, storage);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <AuthProvider auth={auth}>
      <CatalogProvider store={testCatalogStore()}>
        <MatchProvider session={session}>
          <RouterProvider router={router} />
        </MatchProvider>
      </CatalogProvider>
    </AuthProvider>,
  );
  return { router, view, session, sockets, storage };
}

beforeAll(async () => {
  await initI18n(languageStore);
});

afterEach(async () => {
  cleanup();
  await changeLanguage('it', languageStore);
});

describe('router e layout shell', () => {
  it('/ porta alla lobby con testi tradotti', async () => {
    const { router } = await renderAuthenticated('/');
    expect(await screen.findByRole('heading', { name: 'Bentornato, mario' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/lobby');
    expect((screen.getByRole('button', { name: 'Gioca classificata' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('rotta sconosciuta → 404', async () => {
    await renderAuthenticated('/non-esiste');
    expect(await screen.findByRole('heading', { name: 'Pagina non trovata' })).toBeTruthy();
  });

  it('il cambio lingua, nelle Impostazioni, aggiorna i testi (D15)', async () => {
    const { router } = await renderAuthenticated('/settings');
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'English' }));
    });
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeTruthy();
    await act(async () => {
      await router.navigate('/lobby');
    });
    expect(await screen.findByRole('heading', { name: 'Welcome back, mario' })).toBeTruthy();
    expect(document.documentElement.lang).toBe('en');
  });

  it('/dev/cards mostra tutto il catalogo (solo in sviluppo)', async () => {
    await renderAuthenticated('/dev/cards');
    expect(await screen.findByRole('heading', { name: 'Catalogo magie' }, { timeout: 5_000 })).toBeTruthy();
    await waitFor(() => expect(document.querySelectorAll('[data-card]').length).toBeGreaterThan(11));
    expect(screen.getByText('Sorgente: server — 11 magie')).toBeTruthy();
    // Stato scelto dal selettore: con mana 0 resta giocabile solo la magia che costa 0.
    fireEvent.click(screen.getByRole('button', { name: 'Mana insufficiente' }));
    // La griglia e la mano a ventaglio mostrano le stesse carte: conta la griglia.
    const grid = [...document.querySelectorAll('[data-playable="true"]')].filter((card) => card.closest('[data-hand]') === null);
    expect(grid.map((card) => card.getAttribute('data-card'))).toEqual(['channel']);
  });

  it('/match senza una partita in corso → lobby (aprire il socket metterebbe in coda)', async () => {
    const { router, sockets } = await renderAuthenticated('/match');
    // La schermata di partita è un chunk a parte: il primo import può prendersi il suo tempo.
    expect(await screen.findByRole('heading', { name: 'Bentornato, mario' }, { timeout: 5_000 })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/lobby');
    expect(sockets.sockets).toHaveLength(0);
  });
});

/** `game_state` in cui l'utente di `ACCOUNT` (id 7) gioca con il bianco. */
function gameState() {
  return {
    type: 'game_state',
    payload: {
      board: { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', moves: [], turn: 'white', status: 'active' },
      white_player: { id: 7, username: 'mario' },
      black_player: { id: 8, username: 'luigi' },
      time_control: { base_ms: 600000, increment_ms: 5000 },
      white_time: 600000,
      black_time: 600000,
      phase: 'draw',
      active_player: 'white',
      turn_number: 1,
      white_mana: 1,
      white_max_mana: 1,
      black_mana: 1,
      black_max_mana: 1,
      white_hand_size: 4,
      black_hand_size: 4,
      white_deck_size: 36,
      black_deck_size: 36,
      active_effects: [],
    },
  };
}

describe('shell, classifica e impostazioni (R5)', () => {
  it('navigazione: le voci «Presto» non portano da nessuna parte, quelle vere sì', async () => {
    const { router } = await renderAuthenticated('/lobby');
    await screen.findByRole('heading', { name: 'Bentornato, mario' });
    const decks = document.querySelector('[data-nav="decks"]') as HTMLElement;
    expect(decks.tagName).toBe('SPAN');
    expect(decks.getAttribute('aria-disabled')).toBe('true');
    expect(decks.textContent).toContain('Presto');
    await act(async () => {
      fireEvent.click(document.querySelector('[data-nav="ranking"]') as HTMLElement);
    });
    expect(router.state.location.pathname).toBe('/leaderboard');
  });

  it('classifica: i primi dieci, la propria riga evidenziata; un errore offre Riprova', async () => {
    await renderAuthenticated('/leaderboard');
    await waitFor(() => expect(document.querySelectorAll('main [data-rank]')).toHaveLength(4));
    const own = document.querySelector('main [data-self]') as HTMLElement;
    expect(own.getAttribute('data-rank')).toBe('4');
    expect(own.textContent).toContain('mario');
    cleanup();

    const original = leaderboard;
    leaderboard = () => new Response(JSON.stringify({ success: false, error: 'Errore DB' }), { status: 500 });
    try {
      await renderAuthenticated('/leaderboard');
      expect(await screen.findByText('Classifica non disponibile.', { selector: '[role=alert]' })).toBeTruthy();
      leaderboard = original;
      fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
      await waitFor(() => expect(document.querySelectorAll('main [data-rank]')).toHaveLength(4));
    } finally {
      leaderboard = original;
    }
  });

  it('home: la card della classifica mostra il podio e la propria riga', async () => {
    await renderAuthenticated('/lobby');
    await waitFor(() => expect(document.querySelectorAll('[data-ranking-card] [data-rank]')).toHaveLength(4));
    expect(document.querySelector('[data-ranking-card] [data-self]')?.textContent).toContain('mario');
  });

  it('impostazioni: il tema della scacchiera si sceglie e resta (D1)', async () => {
    await renderAuthenticated('/settings');
    const noce = await screen.findByRole('radio', { name: 'Noce' });
    await act(async () => {
      fireEvent.click(noce);
    });
    expect(noce.getAttribute('aria-checked')).toBe('true');
    expect(boardThemeStore.getState().theme).toBe('noce');
    await act(() => boardThemeStore.getState().set('arcano'));
  });

  it('home con una partita salvata ma non collegata: la card lo dice e porta a /match (C11)', async () => {
    const { router, storage } = await renderAuthenticated('/profile');
    await screen.findByRole('heading', { name: 'mario' });
    await storage.set('active-match', '7');
    await act(async () => {
      await router.navigate('/lobby');
    });
    const card = await waitFor(() => document.querySelector('[data-ongoing="saved"]') as HTMLElement);
    expect(card.textContent).toContain('Hai una partita aperta');
    expect(within(card).getByRole('link', { name: 'Riprendi' }).getAttribute('href')).toBe('/match');
  });
});

describe('coda, partita e connessione', () => {
  it('Gioca → coda con Annulla → di nuovo Gioca → partita → /match con i giocatori', async () => {
    const { router, sockets } = await renderAuthenticated('/lobby');
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Gioca classificata' }));
    });
    expect(await screen.findByText('In cerca di un avversario…')).toBeTruthy();
    await waitFor(() => expect(sockets.sockets).toHaveLength(1));
    act(() => sockets.last().open());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    });
    expect(sockets.last().closedWith).toBe(1000);
    expect(screen.getByRole('button', { name: 'Gioca classificata' })).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Gioca classificata' }));
    });
    await waitFor(() => expect(sockets.sockets).toHaveLength(2));
    act(() => {
      sockets.last().open();
      sockets.last().receive(gameState());
    });
    expect(await screen.findByRole('grid', { name: 'Scacchiera' }, { timeout: 5_000 })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/match');
    const panel = (side: string) => (document.querySelector(`[data-player="${side}"]`) as HTMLElement).textContent ?? '';
    expect(panel('opponent')).toContain('luigi');
    expect(panel('self')).toContain('mario');

    // Tornare alla home a partita in corso non rimanda più alla partita: resta in background e si riprende (D13).
    await act(async () => {
      await router.navigate('/lobby');
    });
    expect(await screen.findByRole('heading', { name: 'Bentornato, mario' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/lobby');
    expect(document.querySelector('[data-ongoing="live"]')?.textContent).toContain('vs luigi');
    expect(sockets.last().closedWith).toBeNull();
  });

  it('partita salvata: /match riprende la connessione; 4001 → "Riprendi qui"; fine partita → lobby', async () => {
    const { router, sockets, storage } = await renderAuthenticated('/profile');
    await screen.findByRole('heading', { name: 'mario' });
    await storage.set('active-match', '7');
    await act(async () => {
      await router.navigate('/match');
    });
    await waitFor(() => expect(sockets.sockets).toHaveLength(1));
    act(() => {
      sockets.last().open();
      sockets.last().receive({ ...gameState(), payload: { ...gameState().payload, reconnected: true } });
    });
    expect(await screen.findByRole('grid', { name: 'Scacchiera' })).toBeTruthy();

    act(() => sockets.last().drop(4001));
    expect(await screen.findByText('Questa partita è aperta in un’altra scheda o dispositivo.')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Riprendi qui' }));
    });
    await waitFor(() => expect(sockets.sockets).toHaveLength(2));
    act(() => {
      sockets.last().open();
      sockets.last().receive({ type: 'game_over', payload: { result: '1-0', reason: 'resign', winner: 'mario' } });
    });
    // Il layout monta le azioni due volte (colonna desktop e sezione mobile): si prende la prima.
    expect((await screen.findAllByText('Hai vinto')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Abbandono.').length).toBeGreaterThan(0);
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Torna alla lobby' })[0] as HTMLElement);
    });
    expect(await screen.findByRole('heading', { name: 'Bentornato, mario' })).toBeTruthy();
    expect(await storage.get('active-match')).toBeNull();
  });
});
