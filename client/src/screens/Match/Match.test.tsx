// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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
import { NOTICE_MS } from './useNotice';

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
/** Il box del suggerimento della colonna laterale: avvisi, carta in corso, cosa fare nella fase (D16). */
const hint = () => (document.querySelector('[data-hint-box="panel"]') as HTMLElement).textContent ?? '';
/** La CTA della fase nella colonna laterale (su Android c'è la gemella compatta). */
const passButton = () => document.querySelector('[data-region="side"] [data-action="pass"]') as HTMLButtonElement;

describe('schermata di partita', () => {
  it('pannelli: nomi, colori, ELO e orologi dal server', async () => {
    await setup();
    const self = document.querySelector('[data-player="self"]') as HTMLElement;
    const opponent = document.querySelector('[data-player="opponent"]') as HTMLElement;
    expect(self.textContent).toContain('mario');
    expect(self.textContent).toContain('Bianco');
    expect(opponent.textContent).toContain('luigi');
    expect(await waitFor(() => self.textContent)).toContain('(1250)');
    expect((document.querySelector('[data-clock="opponent"]') as HTMLElement).textContent).toBe('9:55');
    expect(self.dataset['active']).toBe('true');
  });

  it('fasi, turno e storico delle mosse, con la mossa assorbita dallo scudo', async () => {
    const { receive } = await setup();
    expect((document.querySelector('[data-phase="move"]') as HTMLElement).dataset['current']).toBe('true');
    expect((document.querySelector('[data-turn]') as HTMLElement).textContent).toContain('Turno 1 · Tocca a te');
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
    expect(hint()).toContain('Mossa non valida.');
  });

  it('il rifiuto deciso dal client non disturba il server', async () => {
    const { sent, receive } = await setup();
    receive(gameState({ phase: 'main1' }));
    fireEvent.click(square('e2'));
    await waitFor(() => expect(hint()).toContain('Non è la fase della mossa.'));
    expect(sent()).toEqual([]);
  });

  it('mano, targeting e cast: la carta apre la scelta del bersaglio e il frame parte con la casella scelta', async () => {
    const { receive, expectSent, sent } = await setup();
    receive(gameState({ phase: 'main1', white_mana: 3, white_max_mana: 5 }));
    receive({ type: 'hand', payload: { hand: ['frost', 'shatter'], mana: 3, max_mana: 5, deck_size: 34 } });

    // Il catalogo arriva in modo asincrono: prima le carte non ci sono.
    const card = await waitFor(() => document.querySelector('[data-card="frost"]') as HTMLButtonElement);
    expect(card.textContent).toContain('Brina');
    // Frantumare costa 4 e il mana è 3: resta visibile, spenta; il motivo è nell'etichetta e compare al tocco (D5).
    const nova = document.querySelector('[data-card="shatter"]') as HTMLButtonElement;
    expect(nova.getAttribute('aria-disabled')).toBe('true');
    expect(nova.getAttribute('aria-label')).toContain('Servono 4 mana');
    fireEvent.click(nova);
    expect(hint()).toContain('Servono 4 mana.');
    expect(sent()).toEqual([]);
    fireEvent.click(card);

    // Modalità targeting: la scacchiera evidenzia solo i pezzi avversari.
    expect(document.querySelector('[data-hint-box="panel"]')?.getAttribute('data-mode')).toBe('casting');
    expect(square('e7').dataset['castTarget']).toBe('true');
    expect(square('e2').dataset['castTarget']).toBe('false');
    fireEvent.click(square('e7'));
    await expectSent({ type: 'cast_spell', payload: { spell_id: 'frost', targets: ['e7'] } });

    // Mano e mana non cambiano finché non lo dice il server.
    expect(document.querySelector('[data-card="frost"]')).toBeTruthy();
    receive({ type: 'spell_cast', payload: { player: 'white', spell_id: 'frost', targets: ['e7'], effects_applied: [{ kind: 'freeze_piece', target: 'e7', remaining_turns: 2 }] } });
    await waitFor(() => expect(document.querySelector('[data-card="frost"]')).toBeNull());
    expect(square('e7').getAttribute('aria-label')).toBe('e7, pedone Nero, Congelato, ancora 2 turni');
    expect(hint()).toContain('Hai lanciato Brina: Gelo');
    expect(sent()).toHaveLength(1);
  });

  it('il targeting si annulla con Esc o con un secondo tocco sulla carta, senza disturbare il server', async () => {
    const { receive, sent } = await setup();
    receive(gameState({ phase: 'main1', white_mana: 5, white_max_mana: 5 }));
    receive({ type: 'hand', payload: { hand: ['frost'], mana: 5, max_mana: 5, deck_size: 35 } });
    fireEvent.click(await waitFor(() => document.querySelector('[data-card="frost"]') as HTMLButtonElement));
    expect(document.querySelector('[data-hint-box="panel"]')?.getAttribute('data-mode')).toBe('casting');

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(document.querySelector('[data-hint-box="panel"]')?.getAttribute('data-mode')).not.toBe('casting'));
    expect(square('e7').dataset['castTarget']).toBe('false');
    expect(sent()).toEqual([]);

    // Secondo tocco sulla carta selezionata: annulla anche quello, senza pulsante (D8).
    const card = document.querySelector('[data-card="frost"]') as HTMLButtonElement;
    fireEvent.click(card);
    expect(card.dataset['selected']).toBe('true');
    expect(screen.queryByRole('button', { name: 'Annulla' })).toBeNull();
    fireEvent.click(card);
    await waitFor(() => expect(document.querySelector('[data-hint-box="panel"]')?.getAttribute('data-mode')).not.toBe('casting'));
    expect(sent()).toEqual([]);
  });

  it('azioni: passa fase secondo la fase, patta e resa con conferma', async () => {
    const { receive, expectSent } = await setup();
    expect(passButton().disabled).toBe(true); // in fase move si deve muovere
    expect(passButton().textContent).toContain('Muovi un pezzo');
    receive(gameState({ phase: 'main1' }));
    expect(passButton().disabled).toBe(false);
    expect(passButton().textContent).toContain('Passa alla fase Mossa');
    fireEvent.click(passButton());
    await expectSent({ type: 'pass_phase', payload: {} });

    fireEvent.click(first('button', '½ Offri patta'));
    await expectSent({ type: 'draw_offer', payload: {} });
    receive({ type: 'draw_offer_sent', payload: { message: 'x' } });
    expect((first('button', 'Patta offerta') as HTMLButtonElement).disabled).toBe(true);
    receive({ type: 'draw_declined', payload: { message: 'x', reason: 'declined' } });
    expect(hint()).toContain('L’avversario ha rifiutato la patta.');

    fireEvent.click(first('button', 'Abbandona'));
    expect(screen.getAllByText('Abbandonare la partita?').length).toBeGreaterThan(0);
    fireEvent.click(first('button', 'Annulla'));
    fireEvent.click(first('button', 'Abbandona'));
    fireEvent.click(first('button', 'Sì, abbandono'));
    await expectSent({ type: 'resign', payload: {} });
  });

  it('box del suggerimento: fase corrente e propri pezzi congelati; un avviso lo sostituisce per qualche secondo (D16)', async () => {
    const { receive } = await setup();
    receive(gameState({ phase: 'main1', active_effects: [{ square: 'e2', effects: [{ kind: 'freeze', remaining_turns: 2 }] }] }));
    expect(hint()).toContain('Magie 1');
    expect(hint()).toContain('Il tuo pedone in e2 è congelato: ancora 2 turni.');

    vi.useFakeTimers();
    try {
      receive({ type: 'error', payload: { message: 'x', code: 'rate_limited' } });
      expect(hint()).toContain('Troppe azioni ravvicinate');
      act(() => void vi.advanceTimersByTime(NOTICE_MS + 10));
      expect(hint()).not.toContain('Troppe azioni ravvicinate');
      expect(hint()).toContain('Il tuo pedone in e2 è congelato');
    } finally {
      vi.useRealTimers();
    }
  });

  it('storico: le magie della sessione stanno dopo la mossa che le precede, con chi le ha lanciate (D11)', async () => {
    const { receive } = await setup();
    receive(gameState({ board: { fen: START, moves: ['e2e4'], turn: 'black', status: 'active' }, active_player: 'black', phase: 'main1' }));
    receive({ type: 'spell_cast', payload: { player: 'black', spell_id: 'frost', targets: ['e4'], effects_applied: [{ kind: 'noop' }] } });
    const items = [...document.querySelectorAll('[data-region="side"] [data-history] li')].map((item) => item.textContent);
    expect(items[0]).toContain('e2e4');
    expect(items[1]).toContain('Brina');
    expect(items[1]).toContain('→ e4');
    expect(items[1]).toContain('luigi');
  });

  it('orologio in esaurimento: sotto il minuto è segnato (D19)', async () => {
    const { receive } = await setup();
    receive(gameState({ white_time: 45_000 }));
    const clock = document.querySelector('[data-region="main"] [data-clock="self"]') as HTMLElement;
    expect(clock.dataset['low']).toBe('true');
    expect((document.querySelector('[data-clock="opponent"]') as HTMLElement).dataset['low']).toBe('false');
  });

  it('Android: la barra apre il foglio sulla scheda scelta, Esc lo chiude; la Chat è «Presto» (D17, D9)', async () => {
    await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Grimorio' }));
    const sheet = screen.getByRole('dialog');
    expect(sheet.getAttribute('data-sheet')).toBe('grimoire');
    expect(sheet.querySelector('[data-grimoire]')?.textContent).toContain('Brina');
    expect(sheet.textContent).toContain('½ Offri patta');
    // Su Android è l'unica uscita dalla partita, che resta in background (D13).
    expect(within(sheet).getByRole('link', { name: 'Home' }).getAttribute('href')).toBe('/lobby');
    // La scheda Chat non si seleziona.
    fireEvent.click(sheet.querySelector('[data-tab="chat"]') as HTMLElement);
    expect(sheet.querySelector('[data-tab="grimoire"]')?.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('offerta di patta ricevuta: accetta o rifiuta', async () => {
    const { receive, expectSent } = await setup();
    receive({ type: 'draw_offer', payload: { from: 'luigi' } });
    expect(document.querySelector('[data-draw-offer]')?.textContent).toContain('L’avversario offre patta');
    // Su Android i pulsanti stanno nel foglio del Menu: la riga del suggerimento lo dice.
    expect(document.querySelector('[data-hint-box="line"]')?.textContent).toContain('rispondi dal Menu');
    fireEvent.click(first('button', 'Rifiuta'));
    await expectSent({ type: 'draw_declined', payload: {} });
  });

  it('fine partita: riepilogo e ritorno alla lobby', async () => {
    const { receive, storage } = await setup();
    await waitFor(async () => expect(await storage.get('active-match')).toBe('7'));
    receive(gameState({ board: { fen: START, moves: [], turn: 'white', status: 'resigned' } }));
    receive({ type: 'game_over', payload: { result: '0-1', reason: 'resign', winner: 'luigi' } });
    expect(screen.getAllByText('Hai perso').length).toBeGreaterThan(0);
    expect(document.querySelector('[data-outcome]')?.getAttribute('data-outcome')).toBe('loss');
    expect(screen.getAllByText('Abbandono.').length).toBeGreaterThan(0);
    fireEvent.click(first('button', 'Torna alla lobby'));
    expect(await screen.findByRole('heading', { name: 'Lobby' })).toBeTruthy();
    expect(await storage.get('active-match')).toBeNull();
  });

  it('promozione: quattro pezzi sulle case del tema, la scelta parte col pezzo, un tocco fuori annulla', async () => {
    const { receive, expectSent, sent } = await setup();
    receive(gameState({ board: { fen: '4k3/P7/8/8/8/8/8/4K3 w - - 0 1', moves: [], turn: 'white', status: 'active' } }));
    fireEvent.click(square('a7'));
    fireEvent.click(square('a8'));
    const dialog = screen.getByRole('dialog', { name: 'Scegli il pezzo' });
    expect(within(dialog).getAllByRole('button')).toHaveLength(4);
    fireEvent.click(dialog);
    expect(screen.queryByRole('dialog', { name: 'Scegli il pezzo' })).toBeNull();
    expect(sent()).toEqual([]);

    fireEvent.click(square('a7'));
    fireEvent.click(square('a8'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Scegli il pezzo' })).getByRole('button', { name: 'donna' }));
    await expectSent({ type: 'move', payload: { move: 'a7a8q' } });
  });

  it('banner di connessione: riconnessione coi secondi, partita aperta altrove con "Riprendi qui"', async () => {
    const { sockets } = await setup();
    act(() => sockets.last().drop(1006));
    expect(document.querySelector('[data-banner="reconnecting"]')?.textContent).toMatch(/\d+ s/);
    act(() => sockets.last().open());
    act(() => sockets.last().drop(4001));
    const replaced = document.querySelector('[data-banner="replaced"]') as HTMLElement;
    expect(within(replaced).getByRole('button', { name: 'Riprendi qui' })).toBeTruthy();
  });
});
