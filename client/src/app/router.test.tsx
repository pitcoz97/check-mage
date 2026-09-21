// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { changeLanguage, initI18n } from '../i18n';
import { createWebStorage } from '../lib/storage';
import { AuthProvider } from '../store/AuthProvider';
import { createAuth } from '../store/authStore';
import { MatchProvider } from '../store/MatchProvider';
import { testMatchSession } from '../testing/session';
import { ACCOUNT, data, fakeServer, memoryStorage } from '../testing/fakes';
import { routes } from './router';

const languageStore = createWebStorage(() => undefined);

/** Utente già autenticato: sessione salvata e `/me` valido. */
async function renderAuthenticated(path: string) {
  const { storage } = memoryStorage();
  await storage.set('session', JSON.stringify({ accessToken: 'a1', refreshToken: 'r1' }));
  let ticket = 0;
  const server = fakeServer({
    'GET /me': () => data(ACCOUNT),
    'GET /users/7': () => data({ user: ACCOUNT, stats: { wins: 1, losses: 0, draws: 0, total: 1 } }),
    'GET /ws/ticket': () => data({ ticket: `t${++ticket}`, expires_in: 30 }),
  });
  const auth = createAuth({ baseUrl: 'http://api', storage, fetchImpl: server.fetchImpl });
  const { session, sockets } = testMatchSession(auth, storage);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <AuthProvider auth={auth}>
      <MatchProvider session={session}>
        <RouterProvider router={router} />
      </MatchProvider>
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
    expect(await screen.findByRole('heading', { name: 'Pronto a giocare?' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/lobby');
    expect((screen.getByRole('button', { name: 'Gioca' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('rotta sconosciuta → 404', async () => {
    await renderAuthenticated('/non-esiste');
    expect(await screen.findByRole('heading', { name: 'Pagina non trovata' })).toBeTruthy();
  });

  it('il cambio lingua aggiorna i testi', async () => {
    await renderAuthenticated('/lobby');
    const select = await screen.findByRole('combobox', { name: 'Lingua' });
    await act(async () => {
      fireEvent.change(select, { target: { value: 'en' } });
    });
    expect(await screen.findByRole('heading', { name: 'Ready to play?' })).toBeTruthy();
    expect(document.documentElement.lang).toBe('en');
  });

  it('/match senza una partita in corso → lobby (aprire il socket metterebbe in coda)', async () => {
    const { router, sockets } = await renderAuthenticated('/match');
    expect(await screen.findByRole('heading', { name: 'Pronto a giocare?' })).toBeTruthy();
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

describe('coda, partita e connessione', () => {
  it('Gioca → coda con Annulla → di nuovo Gioca → partita → /match con i giocatori', async () => {
    const { router, sockets } = await renderAuthenticated('/lobby');
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Gioca' }));
    });
    expect(await screen.findByText('In cerca di un avversario…')).toBeTruthy();
    await waitFor(() => expect(sockets.sockets).toHaveLength(1));
    act(() => sockets.last().open());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    });
    expect(sockets.last().closedWith).toBe(1000);
    expect(screen.getByRole('button', { name: 'Gioca' })).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Gioca' }));
    });
    await waitFor(() => expect(sockets.sockets).toHaveLength(2));
    act(() => {
      sockets.last().open();
      sockets.last().receive(gameState());
    });
    expect(await screen.findByRole('img', { name: 'Scacchiera' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/match');
    expect(screen.getByText('luigi · Nero')).toBeTruthy();
    expect(screen.getByText('mario · Bianco')).toBeTruthy();
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
    expect(await screen.findByRole('img', { name: 'Scacchiera' })).toBeTruthy();

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
    expect(await screen.findByRole('heading', { name: 'Pronto a giocare?' })).toBeTruthy();
    expect(await storage.get('active-match')).toBeNull();
  });
});
