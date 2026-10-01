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
import { ACCOUNT, data, fail, fakeServer, memoryStorage } from '../testing/fakes';
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

/** Amici del server finto (A1–A3): due amici veri, due altri giocatori, una richiesta ricevuta da wario. */
const FRIENDS = {
  friends: [
    { id: 8, username: 'luigi', elo: 1300, status: 'online' },
    { id: 9, username: 'toad', elo: 1100, status: 'playing' },
  ],
  others: [
    { id: 12, username: 'daisy', elo: 1180, status: 'online' },
    { id: 10, username: 'peach', elo: 1250, status: 'offline' },
  ],
  incoming: [{ id: 11, username: 'wario', elo: 1150, status: 'offline' }],
  outgoing: [],
  online: 2,
  max_friends: 200,
};
let searchRelation = 'none';
/** Bloccati e richieste ricevute del server finto. */
let blocks: { id: number; username: string }[] = [];
let friendRequests = 0;

/** Sfide ricevute e risposta a `POST /me/challenges` del server finto: i test le sostituiscono. */
let incoming: unknown[] = [];
let challengeReply: () => Response = () =>
  data({ id: 'ch-1', from: { id: 7, username: 'mario', elo: 1234 }, to: { id: 8, username: 'luigi', elo: 1300 }, expires_in: 60 }, 201);

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
    'GET /me/friends': () => data(FRIENDS),
    'POST /me/friends/requests/11/accept': () =>
      data({ ...FRIENDS, friends: [...FRIENDS.friends, { id: 11, username: 'wario', elo: 1150, status: 'offline' }], incoming: [] }),
    'GET /users/search': () => data([{ id: 10, username: 'peach', elo: 1250, relation: searchRelation }]),
    'POST /me/friends/requests': () => {
      searchRelation = 'outgoing';
      return data({ ...FRIENDS, others: [], outgoing: [{ id: 10, username: 'peach', elo: 1250, status: 'offline' }] }, 201);
    },
    'POST /me/presence': () => data({ incoming, friend_requests: friendRequests }),
    'DELETE /me/friends/8': () => data({ ...FRIENDS, friends: [FRIENDS.friends[1]] }),
    'GET /me/blocks': () => data(blocks),
    'POST /me/blocks': () => {
      blocks = [{ id: 10, username: 'peach' }];
      return data(blocks);
    },
    'DELETE /me/blocks/10': () => {
      blocks = [];
      return data(blocks);
    },
    'GET /users/10': () => data({ user: { id: 10, username: 'peach', elo: 1250, created_at: '2026-02-01T10:00:00Z' }, stats: { wins: 0, losses: 0, draws: 0, total: 0 } }),
    'GET /users/10/games': () => data([]),
    'POST /me/challenges': () => challengeReply(),
    'DELETE /me/challenges/in-1': () => data(null),
    'GET /users/8': () => data({ user: { id: 8, username: 'luigi', elo: 1300, created_at: '2026-02-01T10:00:00Z' }, stats: { wins: 5, losses: 3, draws: 1, total: 9 } }),
    'GET /users/8/games': () =>
      data([
        { id: 1, white_id: 8, black_id: 7, white: 'luigi', black: 'mario', result: '1-0', time_control: '10+5', pgn: '', played_at: '2026-09-30T10:00:00Z', rated: true },
        { id: 2, white_id: 7, black_id: 8, white: 'mario', black: 'luigi', result: '1/2-1/2', time_control: '10+5', pgn: '', played_at: '2026-09-29T10:00:00Z', rated: false },
      ]),
    'GET /users/7/games': () => data([]),
    'GET /me/collection': () =>
      data({
        cards: [
          { spell_id: 'frost', copies: 2, max_copies: 2 },
          { spell_id: 'shatter', copies: 1, max_copies: 2 },
          { spell_id: 'haste', copies: 0, max_copies: 1 },
        ],
        owned: 3,
        total: 5,
      }),
    'GET /me/decks': () =>
      data({
        decks: [
          { id: 1, name: 'Mazzo iniziale', cards: [{ spell_id: 'frost', copies: 2 }], size: 40, valid: true, active: false, updated_at: '2026-09-20T10:00:00Z' },
          { id: 2, name: 'Rune d’Oro', cards: [{ spell_id: 'shield', copies: 2 }], size: 40, valid: true, active: true, updated_at: '2026-09-21T10:00:00Z' },
          { id: 3, name: 'Bozza', cards: [], size: 0, valid: false, active: false, updated_at: '2026-09-27T10:00:00Z' },
        ],
        max_decks: 10,
        deck_size: 40,
      }),
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
  return { router, view, session, sockets, storage, server };
}

beforeAll(async () => {
  await initI18n(languageStore);
});

afterEach(async () => {
  cleanup();
  incoming = [];
  searchRelation = 'none';
  blocks = [];
  friendRequests = 0;
  challengeReply = () =>
    data({ id: 'ch-1', from: { id: 7, username: 'mario', elo: 1234 }, to: { id: 8, username: 'luigi', elo: 1300 }, expires_in: 60 }, 201);
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
    await waitFor(() => expect(document.querySelectorAll('[data-card]').length).toBeGreaterThan(18));
    expect(screen.getByText('Sorgente: server — 32 magie')).toBeTruthy();
    // Stato scelto dal selettore: con mana 0 resta giocabile solo la magia che costa 0.
    fireEvent.click(screen.getByRole('button', { name: 'Mana insufficiente' }));
    // La griglia e la mano a ventaglio mostrano le stesse carte: conta la griglia.
    const grid = [...document.querySelectorAll('[data-playable="true"]')].filter((card) => card.closest('[data-hand]') === null);
    expect(grid.map((card) => card.getAttribute('data-card'))).toEqual(['blood_pact']);
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
  it('navigazione: tutte le voci portano alla loro pagina', async () => {
    const { router } = await renderAuthenticated('/lobby');
    await screen.findByRole('heading', { name: 'Bentornato, mario' });
    expect((document.querySelector('[data-nav="friends"]') as HTMLElement).tagName).toBe('A');
    expect((document.querySelector('[data-nav="decks"]') as HTMLElement).tagName).toBe('A');
    await act(async () => {
      fireEvent.click(document.querySelector('[data-nav="ranking"]') as HTMLElement);
    });
    expect(router.state.location.pathname).toBe('/leaderboard');
  });

  it('home: la card Collezione con i dati del server porta alla pagina', async () => {
    const { router } = await renderAuthenticated('/lobby');
    const card = await waitFor(() => {
      const found = document.querySelector('[data-collection-card]') as HTMLElement | null;
      expect(found?.querySelector('[role=progressbar]')).toBeTruthy();
      return found as HTMLElement;
    });
    expect(card.getAttribute('aria-disabled')).toBeNull();
    expect(within(card).getByRole('progressbar', { name: 'Possiedi 3 copie su 5' })).toBeTruthy();
    expect(within(card).getByText('/ 5 carte')).toBeTruthy();
    const counts = [...card.querySelectorAll('[data-rarity]')].map((row) => [row.getAttribute('data-rarity'), row.textContent]);
    expect(counts).toEqual([
      ['common', 'Comuni2'],
      ['rare', 'Rare1'],
      ['legendary', 'Leggendarie0'],
    ]);
    expect(document.querySelectorAll('[data-soon-card]')).toHaveLength(0);
    await act(async () => {
      fireEvent.click(within(card).getByRole('link', { name: 'Sfoglia le carte' }));
    });
    expect(router.state.location.pathname).toBe('/collection');
  });

  it('home: la card Mazzi (prima l’attivo) e la riga «Mazzo attivo · Cambia» di Gioca (D12)', async () => {
    const { router } = await renderAuthenticated('/lobby');
    const card = await waitFor(() => {
      const found = document.querySelector('[data-decks-card]') as HTMLElement | null;
      expect(found?.querySelectorAll('[data-deck]')).toHaveLength(3);
      return found as HTMLElement;
    });
    const rows = [...card.querySelectorAll('[data-deck]')].map((row) => row.textContent);
    expect(rows[0]).toBe('Rune d’OroAttivo');
    expect(rows[1]).toContain('Bozza · 0/40');
    expect(rows[2]).toContain('Mazzo iniziale');
    const active = document.querySelector('[data-active-deck]') as HTMLElement;
    expect(active.getAttribute('data-active-deck')).toBe('2');
    expect(active.textContent).toContain('Rune d’Oro');
    await act(async () => {
      fireEvent.click(within(active).getByRole('link', { name: 'Cambia' }));
    });
    expect(router.state.location.pathname).toBe('/decks');
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

describe('amici e sfide (F1–F8)', () => {
  it('navigazione e home: Amici porta alla pagina; la card dice quanti sono online', async () => {
    const { router } = await renderAuthenticated('/lobby');
    const card = await waitFor(() => {
      const found = document.querySelector('[data-friends-card]') as HTMLElement | null;
      expect(found?.querySelectorAll('[data-friend]')).toHaveLength(4);
      return found as HTMLElement;
    });
    expect(within(card).getByText('2 online')).toBeTruthy();
    expect(within(card).getByText('1 richieste')).toBeTruthy();
    // Prima gli amici veri, poi gli altri giocatori.
    expect([...card.querySelectorAll('[data-friend]')].map((row) => row.getAttribute('data-friend'))).toEqual(['8', '9', '12', '10']);
    await act(async () => {
      fireEvent.click(document.querySelector('[data-nav="friends"]') as HTMLElement);
    });
    expect(router.state.location.pathname).toBe('/friends');
  });

  it('pagina Amici: richieste, amici per stato, altri giocatori; Sfida solo per chi è online; accetta', async () => {
    const { server } = await renderAuthenticated('/friends');
    await screen.findByRole('heading', { name: 'Amici' });
    await waitFor(() => expect(document.querySelectorAll('[data-friends-section]')).toHaveLength(4));
    expect([...document.querySelectorAll('[data-friends-section]')].map((s) => s.getAttribute('data-friends-section'))).toEqual(['incoming', 'online', 'playing', 'others']);
    expect(screen.getByText('2 / 200 amici')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sfida luigi' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sfida daisy' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sfida peach' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Aggiungi peach agli amici' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Accetta la richiesta di wario' }));
    await waitFor(() => expect(document.querySelector('[data-friends-section="incoming"]')).toBeNull());
    expect(server.hits).toContain('POST /me/friends/requests/11/accept');
    expect(screen.getByText('3 / 200 amici')).toBeTruthy();
  });

  it('pagina Amici: la ricerca trova i giocatori e Aggiungi manda la richiesta', async () => {
    const { server } = await renderAuthenticated('/friends');
    const box = await screen.findByRole('searchbox', { name: 'Cerca un giocatore' });
    fireEvent.change(box, { target: { value: 'p' } });
    expect(screen.getByText('Scrivi almeno 2 caratteri.')).toBeTruthy();
    fireEvent.change(box, { target: { value: 'pe' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Aggiungi peach agli amici' }, { timeout: 2_000 }));
    await waitFor(() => expect(server.hits).toContain('POST /me/friends/requests'));
    expect(await screen.findByRole('button', { name: 'Annulla la richiesta a peach' }, { timeout: 2_000 })).toBeTruthy();
    fireEvent.change(box, { target: { value: '' } });
    expect(await screen.findByText('Richieste inviate')).toBeTruthy();
  });

  it('Sfida → socket con la sfida e attesa; rifiutata → motivo e Chiudi', async () => {
    const { sockets, server } = await renderAuthenticated('/friends');
    fireEvent.click(await screen.findByRole('button', { name: 'Sfida luigi' }));
    await waitFor(() => expect(sockets.sockets).toHaveLength(1));
    expect(server.hits).toContain('POST /me/challenges');
    expect(sockets.last().url).toBe('ws://api/ws?ticket=t1&challenge=ch-1');
    sockets.last().open();
    expect(await screen.findByText('In attesa di luigi…')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Sfida luigi' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      sockets.last().drop(4003, 'challenge_declined');
    });
    expect(await screen.findByText('luigi ha rifiutato la sfida.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Chiudi' }));
    expect(document.querySelector('[data-challenge-banner]')).toBeNull();
  });

  it('un rifiuto del server alla sfida si mostra tradotto', async () => {
    challengeReply = () => fail(409, 'Il giocatore è in partita');
    const { sockets } = await renderAuthenticated('/friends');
    fireEvent.click(await screen.findByRole('button', { name: 'Sfida luigi' }));
    expect(await screen.findByText('Il giocatore è in partita.')).toBeTruthy();
    expect(sockets.sockets).toHaveLength(0);
  });

  it('sfida in arrivo: Accetta apre il socket della sfida, la partita parte amichevole', async () => {
    incoming = [{ id: 'in-1', from: { id: 8, username: 'luigi', elo: 1300 }, to: { id: 7, username: 'mario', elo: 1234 }, expires_in: 40 }];
    const { router, sockets } = await renderAuthenticated('/lobby');
    const banner = await waitFor(() => {
      const found = document.querySelector('[data-incoming-challenge="in-1"]') as HTMLElement | null;
      expect(found).toBeTruthy();
      return found as HTMLElement;
    });
    expect(within(banner).getByText('luigi ti sfida')).toBeTruthy();
    fireEvent.click(within(banner).getByRole('button', { name: 'Accetta' }));
    await waitFor(() => expect(sockets.sockets).toHaveLength(1));
    expect(sockets.last().url).toBe('ws://api/ws?ticket=t1&challenge=in-1');
    expect(await screen.findByText('Collegamento alla sfida di luigi…')).toBeTruthy();
    sockets.last().open();
    await act(async () => {
      sockets.last().receive({ ...gameState(), payload: { ...gameState().payload, friendly: true } });
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/match'));
    expect(await screen.findByText('Amichevole')).toBeTruthy();
  });

  it('sfida in arrivo: Rifiuta la chiude sul server e sparisce', async () => {
    incoming = [{ id: 'in-1', from: { id: 8, username: 'luigi', elo: 1300 }, to: { id: 7, username: 'mario', elo: 1234 }, expires_in: 40 }];
    const { server } = await renderAuthenticated('/lobby');
    fireEvent.click(await screen.findByRole('button', { name: 'Rifiuta' }));
    expect(document.querySelector('[data-incoming-challenge]')).toBeNull();
    await waitFor(() => expect(server.hits).toContain('DELETE /me/challenges/in-1'));
  });

  it('profilo di un giocatore: stato, statistiche, ultime partite con l’amichevole; il proprio id porta a /profile', async () => {
    const { router } = await renderAuthenticated('/players/8');
    expect(await screen.findByRole('heading', { name: 'luigi' })).toBeTruthy();
    await waitFor(() => expect(document.querySelectorAll('[data-game]')).toHaveLength(2));
    expect([...document.querySelectorAll('[data-game]')].map((g) => g.getAttribute('data-outcome'))).toEqual(['win', 'draw']);
    expect(within(document.querySelector('[data-game="2"]') as HTMLElement).getByText('Amichevole')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Sfida luigi' })).toBeTruthy();

    await act(async () => {
      await router.navigate('/players/7');
    });
    expect(router.state.location.pathname).toBe('/profile');
  });
});

describe('amicizie: profilo, fine partita, classifica, bloccati, badge (A6–A8)', () => {
  it('badge sulla voce Amici con le richieste ricevute', async () => {
    friendRequests = 2;
    await renderAuthenticated('/lobby');
    const badge = await waitFor(() => {
      const found = document.querySelector('[data-nav="friends"] [data-nav-badge]');
      expect(found).toBeTruthy();
      return found as HTMLElement;
    });
    expect(badge.textContent).toContain('2');
  });

  it('profilo: Aggiungi per un altro giocatore; Rimuovi con conferma per un amico', async () => {
    const { router, server } = await renderAuthenticated('/players/10');
    expect(await screen.findByRole('heading', { name: 'peach' })).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Aggiungi peach agli amici' }));
    expect(await screen.findByRole('button', { name: 'Annulla la richiesta a peach' })).toBeTruthy();
    expect(server.hits).toContain('POST /me/friends/requests');

    await act(async () => {
      await router.navigate('/players/8');
    });
    expect(await screen.findByRole('heading', { name: 'luigi' })).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Rimuovi amico' }));
    const confirm = screen.getByRole('group', { name: 'Rimuovi amico' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Rimuovi amico' }));
    await waitFor(() => expect(server.hits).toContain('DELETE /me/friends/8'));
  });

  it('profilo: Blocca dal menu, con conferma; poi Sblocca', async () => {
    const { server } = await renderAuthenticated('/players/10');
    await screen.findByRole('heading', { name: 'peach' });
    fireEvent.click(await screen.findByRole('button', { name: 'Altre azioni' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Blocca' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Blocca' })).getByRole('button', { name: 'Blocca' }));
    expect(await screen.findByText(/Hai bloccato questo giocatore/)).toBeTruthy();
    expect(server.hits).toContain('POST /me/blocks');
    expect(screen.queryByRole('button', { name: 'Aggiungi peach agli amici' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Altre azioni' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sblocca' }));
    await waitFor(() => expect(server.hits).toContain('DELETE /me/blocks/10'));
    await waitFor(() => expect(screen.queryByText(/Hai bloccato questo giocatore/)).toBeNull());
  });

  it('impostazioni: elenco dei bloccati con Sblocca', async () => {
    blocks = [{ id: 10, username: 'peach' }];
    const { server } = await renderAuthenticated('/settings');
    fireEvent.click(await screen.findByRole('button', { name: 'Sblocca peach' }));
    await waitFor(() => expect(server.hits).toContain('DELETE /me/blocks/10'));
    expect(await screen.findByText('Non hai bloccato nessuno.')).toBeTruthy();
  });

  it('classifica: i nomi portano al profilo, il proprio al proprio', async () => {
    await renderAuthenticated('/leaderboard');
    const link = await screen.findByRole('link', { name: 'VoidRook' });
    expect(link.getAttribute('href')).toBe('/players/21');
    const ranking = document.querySelector('[data-ranking]') as HTMLElement;
    expect(within(ranking).getByRole('link', { name: /mario/ }).getAttribute('href')).toBe('/profile');
  });

  it('fine partita: Aggiungi agli amici l’avversario che non è amico', async () => {
    const { sockets, server } = await renderAuthenticated('/lobby');
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Gioca classificata' }));
    });
    await waitFor(() => expect(sockets.sockets).toHaveLength(1));
    const state = gameState();
    act(() => {
      sockets.last().open();
      sockets.last().receive({ ...state, payload: { ...state.payload, black_player: { id: 12, username: 'daisy' } } });
    });
    await screen.findByRole('grid', { name: 'Scacchiera' }, { timeout: 5_000 });
    act(() => {
      sockets.last().receive({ type: 'game_over', payload: { result: '1-0', reason: 'resign', winner: 'mario' } });
    });
    // Il riepilogo c'è due volte (desktop e Android): basta il primo.
    const [add] = await screen.findAllByRole('button', { name: 'Aggiungi daisy agli amici' });
    fireEvent.click(add as HTMLElement);
    await waitFor(() => expect(server.hits).toContain('POST /me/friends/requests'));
  });
});
