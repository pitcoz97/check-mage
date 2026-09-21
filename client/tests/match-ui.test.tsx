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
import { MatchProvider } from '../src/store/MatchProvider';
import { memoryStorage } from '../src/testing/fakes';
import type { SocketFactory } from '../src/ws/connection';

/**
 * Criteri di accettazione dello Step 4 contro il mock (porting di chess-server), con la schermata di gioco vera:
 * - una partita completa fino al matto, giocata cliccando sulle caselle;
 * - riconnessione a metà partita: la UI si ricostruisce dallo stato che rimanda il server.
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
      <MatchProvider session={session}>
        <MemoryRouter initialEntries={['/match']}>
          <Routes>
            <Route path="/match" element={<Match />} />
            <Route path="/lobby" element={<h1>Lobby</h1>} />
          </Routes>
        </MemoryRouter>
      </MatchProvider>
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
});
