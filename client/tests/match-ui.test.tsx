// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import WebSocket from 'ws';

import { startMockServer, type MockServerHandle } from '../mock-server/index';
import { initI18n } from '../src/i18n';
import { createLogger } from '../src/lib/log';
import { createWebStorage, type KeyValueStorage } from '../src/lib/storage';
import { Match } from '../src/screens/Match/Match';
import { AuthProvider } from '../src/store/AuthProvider';
import { createAuth } from '../src/store/authStore';
import { createMatchSession } from '../src/store/matchSession';
import { createCatalogStore } from '../src/spells/catalog';
import { CatalogProvider } from '../src/spells/CatalogProvider';
import { MatchProvider } from '../src/store/MatchProvider';
import { memoryStorage } from '../src/testing/fakes';
import type { SocketFactory } from '../src/ws/connection';

/**
 * Criteri di accettazione degli Step 4 e 5 contro il mock (porting di chess-server), con la schermata di gioco vera:
 * - una partita completa fino al matto, giocata cliccando sulle caselle;
 * - riconnessione a metà partita: la UI si ricostruisce dallo stato che rimanda il server;
 * - magie lanciate dalla mano in main1 e main2, con tutti i kind di effetto, targeting annullabile, carte
 *   disabilitate col motivo, effetto che segue il pezzo e pickup rifiutato su un pezzo congelato.
 *
 * Le due schede in parallelo restano una prova manuale; qui l'avversario è il bot del mock.
 *
 * Il socket usa la libreria `ws`: il `WebSocket` di jsdom e quello di Node non vanno d'accordo sugli eventi. Tutto
 * il resto — ticket, riconnessione, dispatch, reducer, componenti — è il codice del client.
 */
const wsSocketFactory: SocketFactory = (url, handlers) => {
  const socket = new WebSocket(url);
  socket.on('open', () => handlers.onOpen());
  socket.on('message', (data) => handlers.onMessage(data.toString()));
  socket.on('close', (code) => handlers.onClose(code));
  socket.on('error', () => undefined); // la chiusura arriva comunque
  return { send: (data) => socket.send(data), close: (code = 1000) => socket.close(code) };
};

const PASSWORD = 'Password1';
let servers: MockServerHandle[] = [];

beforeAll(async () => {
  await initI18n(createWebStorage(() => undefined));
});
afterEach(async () => {
  cleanup();
  await Promise.all(servers.map((s) => s.close()));
  servers = [];
});

/** Registra un utente sul mock e ne salva la sessione nello storage, come farebbe il login. */
async function signIn(server: MockServerHandle, name: string, storage: KeyValueStorage): Promise<void> {
  const body = (payload: object) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  await fetch(`${server.httpUrl}/auth/register`, body({ username: name, email: `${name}@ui.test`, password: PASSWORD }));
  const res = await fetch(`${server.httpUrl}/auth/login`, body({ email: `${name}@ui.test`, password: PASSWORD }));
  const json = (await res.json()) as { data: { tokens: { access_token: string; refresh_token: string } } };
  await storage.set('session', JSON.stringify({ accessToken: json.data.tokens.access_token, refreshToken: json.data.tokens.refresh_token }));
}

async function startMatch(scenario: string, name: string) {
  const server = await startMockServer({ port: 0, quiet: true, botDelayMs: 20, reconnectTimeoutMs: 3000 });
  servers.push(server);
  const { storage } = memoryStorage();
  await signIn(server, name, storage);

  const auth = createAuth({ baseUrl: server.httpUrl, storage });
  await auth.store.getState().bootstrap();
  const session = createMatchSession({
    wsBaseUrl: server.wsUrl,
    tickets: auth.api,
    auth: auth.store,
    storage,
    log: createLogger(() => undefined),
    createSocket: wsSocketFactory,
    extraParams: { scenario },
    onlineEvents: null,
  });

  // Come fa la lobby: si entra nella schermata quando la partita è iniziata davvero.
  session.findMatch();
  await waitFor(() => expect(session.match.getState().lifecycle).toBe('playing'), { timeout: 15_000 });

  render(
    <AuthProvider auth={auth}>
      {/* Il catalogo arriva davvero da `GET /spells` del mock, come in produzione. */}
      <CatalogProvider store={createCatalogStore({ api: auth.api, log: createLogger(() => undefined) })}>
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
  await screen.findByRole('grid', { name: 'Scacchiera' }, { timeout: 10_000 });
  return { server, session };
}

const square = (name: string) => document.querySelector(`[data-square="${name}"]`) as HTMLButtonElement;

interface TestSession {
  match: {
    getState(): {
      game: { phase: string; activePlayer: string; moves: readonly { kind: string; uci?: string }[] } | null;
      myColor: string | null;
      outcome: unknown;
    };
  };
}

const turnOf = (session: TestSession) => {
  const state = session.match.getState();
  return { phase: state.game?.phase, mine: state.game?.activePlayer === state.myColor };
};

/** Aspetta il proprio turno e, nelle fasi delle magie, passa con il bottone (le carte arrivano allo Step 5). */
async function toMovePhase(session: TestSession): Promise<void> {
  for (let guard = 0; guard < 6; guard++) {
    await waitFor(() => expect(turnOf(session).mine).toBe(true), { timeout: 10_000 });
    const { phase } = turnOf(session);
    if (phase === 'move') return;
    fireEvent.click(screen.getAllByRole('button', { name: 'Passa fase' })[0] as HTMLButtonElement);
    await waitFor(() => expect(turnOf(session).phase).not.toBe(phase), { timeout: 10_000 });
  }
  throw new Error('la fase di mossa non è mai arrivata');
}

/** Chiude il proprio turno: dopo la mossa il server si ferma in main2 finché non si passa. */
async function endTurn(session: TestSession): Promise<void> {
  if (!turnOf(session).mine) return;
  fireEvent.click(screen.getAllByRole('button', { name: 'Passa fase' })[0] as HTMLButtonElement);
  await waitFor(() => expect(turnOf(session).mine).toBe(false), { timeout: 10_000 });
}

/** Gioca una mossa cliccando partenza e arrivo, come farebbe una persona, e aspetta la conferma del server. */
async function play(session: TestSession, move: string): Promise<void> {
  await toMovePhase(session);
  fireEvent.click(square(move.slice(0, 2)));
  fireEvent.click(square(move.slice(2, 4)));
  await waitFor(() => expect(session.match.getState().game?.moves.some((m) => m.kind === 'move' && m.uci === move)).toBe(true), {
    timeout: 10_000,
  });
}

type Session = Awaited<ReturnType<typeof startMatch>>['session'];

const cardOf = (spellId: string) => document.querySelector(`[data-card="${spellId}"]`) as HTMLButtonElement | null;
const passButton = () => screen.getAllByRole('button', { name: 'Passa fase' })[0] as HTMLButtonElement;

/** Lancia una magia dalla mano: tap sulla carta, tap sui bersagli, e si aspetta lo `spell_cast` del server. */
async function cast(session: Session, spellId: string, targets: readonly string[]): Promise<void> {
  await waitFor(() => expect(cardOf(spellId)?.disabled).toBe(false), { timeout: 10_000 });
  fireEvent.click(cardOf(spellId) as HTMLButtonElement);
  for (const target of targets) fireEvent.click(square(target));
  await waitFor(() => expect(session.match.getState().lastCast?.spellId).toBe(spellId), { timeout: 10_000 });
}

describe('schermata di partita contro il mock', () => {
  it(
    'partita completa fino al matto, giocata dalla scacchiera',
    async () => {
      const { session } = await startMatch('checkmate', 'ui_mate');
      expect(session.match.getState().myColor).toBe('white');

      for (const move of ['e2e4', 'd1h5', 'f1c4', 'h5f7']) await play(session, move);

      expect(await screen.findAllByText('Hai vinto', undefined, { timeout: 15_000 })).not.toHaveLength(0);
      expect(screen.getAllByText('Scacco matto.').length).toBeGreaterThan(0);
      // Lo storico mostra le mosse che il server ha accettato.
      expect((document.querySelector('[data-history]') as HTMLElement).textContent).toContain('h5f7');
    },
    60_000,
  );

  it(
    'riconnessione a metà partita: banner, rientro automatico e stato ripristinato',
    async () => {
      const { session } = await startMatch('restart', 'ui_reconnect');
      await play(session, 'e2e4');
      await endTurn(session); // dopo la mossa il turno si chiude passando main2

      // Lo scenario "restart" chiude i socket senza avvisare: la connessione se ne accorge e rientra da sola.
      await waitFor(() => expect(session.status.getState().connection.kind).not.toBe('open'), { timeout: 10_000 });
      expect(screen.getByRole('status', { name: '' }).textContent ?? '').toContain('Connessione persa');

      await waitFor(() => expect(session.status.getState().connection.kind).toBe('open'), { timeout: 15_000 });
      await waitFor(() => expect(session.match.getState().game?.moves.length ?? 0).toBeGreaterThan(0), { timeout: 10_000 });
      expect((document.querySelector('[data-history]') as HTMLElement).textContent).toContain('e2e4');
      expect(square('e4').getAttribute('aria-label')).toBe('e4, pedone Bianco');
      expect(session.match.getState().outcome).toBeNull();
    },
    60_000,
  );

  it(
    'magie dalla mano: tutti gli effetti, cast in main1 e main2, targeting annullabile, Teleport non avanza la fase',
    async () => {
      const { session } = await startMatch('spellbook', 'ui_spellbook');
      const seen = new Set<string>();
      session.match.subscribe((state) => state.lastCast?.effects.forEach((effect) => seen.add(effect.kind)));
      await waitFor(() => expect(turnOf(session).phase).toBe('main1'), { timeout: 10_000 });

      // Targeting annullabile: si apre la scelta del bersaglio e si annulla con Esc, senza mandare nulla.
      await waitFor(() => expect(cardOf('teleport')?.disabled).toBe(false), { timeout: 10_000 });
      fireEvent.click(cardOf('teleport') as HTMLButtonElement);
      expect(screen.getAllByText('Bersaglio per Teleport').length).toBeGreaterThan(0);
      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByText('Bersaglio per Teleport')).toBeNull());
      expect(session.match.getState().lastCast).toBeNull();

      // main1: congela, protegge, distrugge.
      await cast(session, 'frostbolt', ['e7']);
      await cast(session, 'aegis', ['e2']);
      await cast(session, 'disintegrate', ['b8']);
      expect(square('e7').getAttribute('aria-label')).toContain('Congelato');
      expect(square('e2').getAttribute('aria-label')).toContain('Protetto');
      expect(square('b8').getAttribute('aria-label')).toBe('b8');

      // In fase di mossa le carte restano visibili, disabilitate col motivo.
      fireEvent.click(passButton());
      await waitFor(() => expect(turnOf(session).phase).toBe('move'), { timeout: 10_000 });
      expect(cardOf('spark')?.disabled).toBe(true);
      expect(cardOf('spark')?.textContent).toContain('Non puoi lanciare magie in questa fase');

      // L'effetto segue il pezzo: lo scudo era su e2, il pedone va in e4.
      fireEvent.click(square('e2'));
      fireEvent.click(square('e4'));
      await waitFor(() => expect(square('e4').getAttribute('aria-label')).toContain('Protetto'), { timeout: 10_000 });

      // main2: si casta anche qui.
      await waitFor(() => expect(turnOf(session).phase).toBe('main2'), { timeout: 10_000 });
      await cast(session, 'spark', []);

      // Turno successivo: Teleport sposta un pezzo senza consumare la mossa, quindi la fase resta main1.
      fireEvent.click(passButton());
      await waitFor(() => expect(turnOf(session).mine && turnOf(session).phase === 'main1').toBe(true), { timeout: 20_000 });
      await cast(session, 'teleport', ['b1', 'a3']);
      expect(turnOf(session).phase).toBe('main1');
      expect(square('a3').getAttribute('aria-label')).toBe('a3, cavallo Bianco');
      await cast(session, 'insight', []);
      await cast(session, 'channel', []);

      expect([...seen].sort()).toEqual(['destroy_piece', 'draw_card', 'freeze_piece', 'gain_mana', 'move_piece', 'noop', 'shield_piece']);
    },
    90_000,
  );

  it(
    'un pezzo congelato dall’avversario rifiuta il pickup, col motivo',
    async () => {
      const { session } = await startMatch('spells', 'ui_frozen');
      await play(session, 'g1f3');
      await endTurn(session); // il bot gioca il suo turno e lancia le sue magie

      const frozen = () => session.match.getState().game?.activeEffects.find((entry) => entry.effects.some((e) => e.kind === 'freeze'));
      await waitFor(() => expect(frozen()).toBeDefined(), { timeout: 20_000 });
      const target = frozen()?.square as string;
      expect(square(target).getAttribute('aria-label')).toContain('Congelato');

      // Nella propria fase di mossa il pezzo congelato non si prende: il motivo si vede prima di disturbare il server.
      await toMovePhase(session);
      fireEvent.click(square(target));
      expect(screen.getAllByText('Il pezzo è congelato e non può muoversi.').length).toBeGreaterThan(0);
      expect(square(target).dataset['selected']).toBe('false');
    },
    60_000,
  );
});
