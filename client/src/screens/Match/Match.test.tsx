// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';

import { initI18n } from '../../i18n';
import { createWebStorage } from '../../lib/storage';
import { AuthProvider } from '../../store/AuthProvider';
import { createAuth } from '../../store/authStore';
import { CatalogProvider } from '../../spells/CatalogProvider';
import { MatchProvider } from '../../store/MatchProvider';
import { testCatalogStore } from '../../testing/catalog';
import { ACCOUNT, data, fakeServer, memoryStorage } from '../../testing/fakes';
import { testMatchSession } from '../../testing/session';
import { Match } from './Match';

/**
 * Schermata di partita collegata a store e sessione: i frame arrivano da un socket finto e passano dall'adapter
 * e dal reducer veri.
 */

beforeAll(async () => {
  await initI18n(createWebStorage(() => undefined));
});
afterEach(cleanup);

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** `game_state` con l'utente di `ACCOUNT` (id 7) al bianco. */
function gameState(overrides: Record<string, unknown> = {}) {
  return {
    type: 'game_state',
    payload: {
      board: { fen: START, moves: [], turn: 'white', status: 'active' },
      white_player: { id: 7, username: 'mario' },
      black_player: { id: 8, username: 'luigi' },
      time_control: { base_ms: 600000, increment_ms: 5000 },
      white_time: 600000,
      black_time: 595000,
      phase: 'move',
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
      ...overrides,
    },
  };
}

async function setup() {
  const { storage } = memoryStorage();
  await storage.set('session', JSON.stringify({ accessToken: 'a1', refreshToken: 'r1' }));
  let ticket = 0;
  const server = fakeServer({
    'GET /me': () => data(ACCOUNT),
    'GET /ws/ticket': () => data({ ticket: `t${++ticket}`, expires_in: 30 }),
    'GET /users/7': () => data({ user: { id: 7, username: 'mario', elo: 1250 }, stats: { wins: 1, losses: 0, draws: 0, total: 1 } }),
    'GET /users/8': () => data({ user: { id: 8, username: 'luigi', elo: 1180 }, stats: { wins: 0, losses: 1, draws: 0, total: 1 } }),
  });
  const auth = createAuth({ baseUrl: 'http://api', storage, fetchImpl: server.fetchImpl });
  await auth.store.getState().bootstrap();
  const { session, sockets } = testMatchSession(auth, storage);

  // La partita esiste già quando si apre la schermata: altrimenti la guardia rimanda in lobby.
  session.findMatch();
  await waitFor(() => expect(sockets.sockets).toHaveLength(1));
  sockets.last().open();
  sockets.last().receive(gameState());

  render(
    <AuthProvider auth={auth}>
      <CatalogProvider store={testCatalogStore()}>
        <MatchProvider session={session}>
          <MemoryRouter initialEntries={['/match']}>
            <Routes>
              <Route path="/match" element={<Match />} />
              <Route path="/lobby" element={<h1>Lobby</h1>} />
            </Routes>
          </MemoryRouter>
        </MatchProvider>
      </CatalogProvider>
    </AuthProvider>,
  );
  const receive = (frame: object) => act(() => sockets.last().receive(frame));
  await screen.findByRole('grid', { name: 'Scacchiera' });
  const sent = () => sockets.last().sent.map((raw) => JSON.parse(raw) as { type: string; payload: Record<string, unknown> });
  /** Gli invii sono distanziati di 220 ms (rate limit del server): si aspetta che il frame parta davvero. */
  const expectSent = (expected: object) => waitFor(() => expect(sent().at(-1)).toEqual(expected));
  return { session, sockets, receive, sent, expectSent, storage };
}

const square = (name: string) => document.querySelector(`[data-square="${name}"]`) as HTMLButtonElement;
/** Il layout monta azioni e storico due volte (colonna desktop e sezione mobile): si prende il primo. */
const first = (role: string, name: string) => screen.getAllByRole(role, { name })[0] as HTMLElement;

describe('schermata di partita', () => {
  it('pannelli: nomi, colori, ELO e orologi dal server', async () => {
    await setup();
    const self = document.querySelector('[data-player="self"]') as HTMLElement;
    const opponent = document.querySelector('[data-player="opponent"]') as HTMLElement;
    expect(self.textContent).toContain('mario');
    expect(self.textContent).toContain('Bianco');
    expect(opponent.textContent).toContain('luigi');
    expect(await waitFor(() => self.textContent)).toContain('ELO 1250');
    expect((document.querySelector('[data-clock="opponent"]') as HTMLElement).textContent).toBe('9:55');
    expect(self.dataset['active']).toBe('true');
  });

  it('fasi, turno e storico delle mosse, con la mossa assorbita dallo scudo', async () => {
    const { receive } = await setup();
    expect((document.querySelector('[data-phase="move"]') as HTMLElement).dataset['current']).toBe('true');
    expect(screen.getAllByText('Tocca a te').length).toBeGreaterThan(0);
    receive(gameState({ board: { fen: START, moves: ['e2e4', '0000'], turn: 'white', status: 'active' } }));
    const history = document.querySelector('[data-history]') as HTMLElement;
    expect(history.textContent).toContain('e2e4');
    expect(history.textContent).toContain('--');
  });

  it('una mossa parte al secondo tap e viene mostrata prima della conferma; un rifiuto la annulla', async () => {
    const { receive, expectSent } = await setup();
    fireEvent.click(square('e2'));
    fireEvent.click(square('e4'));
    await expectSent({ type: 'move', payload: { move: 'e2e4' } });
    await waitFor(() => expect(square('e4').getAttribute('aria-label')).toBe('e4, pedone Bianco'));

    receive({ type: 'error', payload: { message: 'Mossa illegale: e2e4', code: 'illegal_move', details: { move: 'e2e4' } } });
    await waitFor(() => expect(square('e2').getAttribute('aria-label')).toBe('e2, pedone Bianco'));
    expect(screen.getByText('Mossa non valida.')).toBeTruthy();
  });

  it('il rifiuto deciso dal client non disturba il server', async () => {
    const { sent, receive } = await setup();
    receive(gameState({ phase: 'main1' }));
    fireEvent.click(square('e2'));
    expect(await screen.findByText('Non è la fase della mossa.')).toBeTruthy();
    expect(sent()).toEqual([]);
  });

  it('mano, targeting e cast: la carta apre la scelta del bersaglio e il frame parte con la casella scelta', async () => {
    const { receive, expectSent, sent } = await setup();
    receive(gameState({ phase: 'main1', white_mana: 3, white_max_mana: 5 }));
    receive({ type: 'hand', payload: { hand: ['frostbolt', 'nova'], mana: 3, max_mana: 5, deck_size: 34 } });

    // Il catalogo arriva in modo asincrono: prima le carte non ci sono.
    const card = await waitFor(() => document.querySelector('[data-card="frostbolt"]') as HTMLButtonElement);
    expect(card.textContent).toContain('Frost Bolt');
    // Nova costa 5 e il mana è 3: resta visibile, spenta; il motivo è nell'etichetta e compare al tocco (D5).
    const nova = document.querySelector('[data-card="nova"]') as HTMLButtonElement;
    expect(nova.getAttribute('aria-disabled')).toBe('true');
    expect(nova.getAttribute('aria-label')).toContain('Servono 5 mana');
    fireEvent.click(nova);
    expect(screen.getAllByText('Servono 5 mana.').length).toBeGreaterThan(0);
    expect(sent()).toEqual([]);
    fireEvent.click(card);

    // Modalità targeting: la scacchiera evidenzia solo i pezzi avversari.
    expect(screen.getAllByText('Bersaglio per Frost Bolt').length).toBeGreaterThan(0);
    expect(square('e7').dataset['castTarget']).toBe('true');
    expect(square('e2').dataset['castTarget']).toBe('false');
    fireEvent.click(square('e7'));
    await expectSent({ type: 'cast_spell', payload: { spell_id: 'frostbolt', targets: ['e7'] } });

    // Mano e mana non cambiano finché non lo dice il server.
    expect(document.querySelector('[data-card="frostbolt"]')).toBeTruthy();
    receive({ type: 'spell_cast', payload: { player: 'white', spell_id: 'frostbolt', targets: ['e7'], effects_applied: [{ kind: 'freeze_piece', target: 'e7', remaining_turns: 2 }] } });
    await waitFor(() => expect(document.querySelector('[data-card="frostbolt"]')).toBeNull());
    expect(square('e7').getAttribute('aria-label')).toBe('e7, pedone Nero, Congelato, ancora 2 turni');
    expect(screen.getAllByText('Hai lanciato Frost Bolt: Gelo').length).toBeGreaterThan(0);
    expect(sent()).toHaveLength(1);
  });

  it('il targeting si annulla con Esc o con un secondo tocco sulla carta, senza disturbare il server', async () => {
    const { receive, sent } = await setup();
    receive(gameState({ phase: 'main1', white_mana: 5, white_max_mana: 5 }));
    receive({ type: 'hand', payload: { hand: ['frostbolt'], mana: 5, max_mana: 5, deck_size: 35 } });
    fireEvent.click(await waitFor(() => document.querySelector('[data-card="frostbolt"]') as HTMLButtonElement));
    expect(screen.getAllByText('Bersaglio per Frost Bolt').length).toBeGreaterThan(0);

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('Bersaglio per Frost Bolt')).toBeNull());
    expect(square('e7').dataset['castTarget']).toBe('false');
    expect(sent()).toEqual([]);

    // Secondo tocco sulla carta selezionata: annulla anche quello, senza pulsante (D8).
    const card = document.querySelector('[data-card="frostbolt"]') as HTMLButtonElement;
    fireEvent.click(card);
    expect(card.dataset['selected']).toBe('true');
    expect(screen.queryByRole('button', { name: 'Annulla' })).toBeNull();
    fireEvent.click(card);
    await waitFor(() => expect(screen.queryByText('Bersaglio per Frost Bolt')).toBeNull());
    expect(sent()).toEqual([]);
  });

  it('azioni: passa fase secondo la fase, patta e resa con conferma', async () => {
    const { receive, expectSent } = await setup();
    expect((first('button', 'Passa fase') as HTMLButtonElement).disabled).toBe(true); // in fase move si deve muovere
    receive(gameState({ phase: 'main1' }));
    expect((first('button', 'Passa fase') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(first('button', 'Passa fase'));
    await expectSent({ type: 'pass_phase', payload: {} });

    fireEvent.click(first('button', 'Patta'));
    await expectSent({ type: 'draw_offer', payload: {} });
    receive({ type: 'draw_offer_sent', payload: { message: 'x' } });
    expect((first('button', 'Patta offerta') as HTMLButtonElement).disabled).toBe(true);
    receive({ type: 'draw_declined', payload: { message: 'x', reason: 'declined' } });
    expect(screen.getByText('L’avversario ha rifiutato la patta.')).toBeTruthy();

    fireEvent.click(first('button', 'Abbandona'));
    expect(screen.getAllByText('Abbandonare la partita?').length).toBeGreaterThan(0);
    fireEvent.click(first('button', 'Annulla'));
    fireEvent.click(first('button', 'Abbandona'));
    fireEvent.click(first('button', 'Sì, abbandono'));
    await expectSent({ type: 'resign', payload: {} });
  });

  it('offerta di patta ricevuta: accetta o rifiuta', async () => {
    const { receive, expectSent } = await setup();
    receive({ type: 'draw_offer', payload: { from: 'luigi' } });
    expect(screen.getAllByText('L’avversario offre patta').length).toBeGreaterThan(0);
    fireEvent.click(first('button', 'Rifiuta'));
    await expectSent({ type: 'draw_declined', payload: {} });
  });

  it('fine partita: riepilogo e ritorno alla lobby', async () => {
    const { receive, storage } = await setup();
    await waitFor(async () => expect(await storage.get('active-match')).toBe('7'));
    receive(gameState({ board: { fen: START, moves: [], turn: 'white', status: 'resigned' } }));
    receive({ type: 'game_over', payload: { result: '0-1', reason: 'resign', winner: 'luigi' } });
    expect(screen.getAllByText('Hai perso').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Abbandono.').length).toBeGreaterThan(0);
    fireEvent.click(first('button', 'Torna alla lobby'));
    expect(await screen.findByRole('heading', { name: 'Lobby' })).toBeTruthy();
    expect(await storage.get('active-match')).toBeNull();
  });
});
