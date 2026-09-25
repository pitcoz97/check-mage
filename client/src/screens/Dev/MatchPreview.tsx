import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Spinner } from '../../design/components/Spinner';
import { createLogger } from '../../lib/log';
import { AuthProvider } from '../../store/AuthProvider';
import { createAuth, type Auth } from '../../store/authStore';
import { createMatchSession, type MatchSession } from '../../store/matchSession';
import { MatchProvider } from '../../store/MatchProvider';
import { fakeSockets } from '../../testing/fakeSocket';
import { data, fakeServer, memoryStorage } from '../../testing/fakes';
import { Match } from '../Match/Match';

/**
 * Pagina di sviluppo (`/dev/match`): la schermata di partita vera, alimentata da un socket finto con lo scenario
 * delle tavole "Partita" del design (posizione, Magie 1, mana 4/8, cavallo congelato in c3, scudo in e4, cinque
 * carte, due magie nello storico). I frame passano da adapter e reducer veri. Serve a confrontare la partita col
 * design senza account né server. Non esiste nella build di produzione.
 */

const SELF = { id: 7, username: 'Riccardo', email: 'dev@checkmage.local', elo: 1240, created_at: '2026-01-15T10:00:00Z' };
const OPPONENT = { id: 8, username: 'Morgana_77', elo: 1285, created_at: '2026-01-15T10:00:00Z' };

/** Le mosse della tavola (1. e4 e5 … 7. h3 c5) in UCI. */
const MOVES = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8e7', 'd2d3', 'g8f6', 'b1c3', 'd7d6', 'e1g1', 'e8g8', 'h2h3', 'c7c5'];
const FEN = 'r2q1rk1/pp2bppp/2np1n2/2p1p3/2B1P3/2NP1N1P/PPP2PP1/R1BQ1RK1 w - - 0 8';

function gameState(moves: readonly string[], activeEffects: readonly object[]) {
  return {
    type: 'game_state',
    payload: {
      board: { fen: FEN, moves, turn: 'white', status: 'active' },
      white_player: { id: SELF.id, username: SELF.username },
      black_player: { id: OPPONENT.id, username: OPPONENT.username },
      time_control: { base_ms: 600_000, increment_ms: 5_000 },
      white_time: 252_000,
      black_time: 227_000,
      phase: 'main1',
      active_player: 'white',
      turn_number: 15,
      white_mana: 4,
      white_max_mana: 8,
      black_mana: 2,
      black_max_mana: 8,
      white_hand_size: 5,
      black_hand_size: 4,
      white_deck_size: 18,
      black_deck_size: 19,
      active_effects: activeEffects,
    },
  };
}

const SHIELD = { square: 'e4', effects: [{ kind: 'shield', remaining_turns: 2, source_spell_id: 'aegis' }] };
const FREEZE = { square: 'c3', effects: [{ kind: 'freeze', remaining_turns: 1, source_spell_id: 'frostbolt' }] };

async function startPreview(): Promise<{ auth: Auth; session: MatchSession }> {
  const { storage } = memoryStorage();
  await storage.set('session', JSON.stringify({ accessToken: 'dev', refreshToken: 'dev' }));
  const server = fakeServer({
    'GET /me': () => data(SELF),
    'GET /ws/ticket': () => data({ ticket: 'dev', expires_in: 30 }),
    'GET /users/7': () => data({ user: SELF, stats: { wins: 0, losses: 0, draws: 0, total: 0 } }),
    'GET /users/8': () => data({ user: OPPONENT, stats: { wins: 0, losses: 0, draws: 0, total: 0 } }),
  });
  const auth = createAuth({ baseUrl: 'http://dev.local', storage, fetchImpl: server.fetchImpl });
  await auth.store.getState().bootstrap();

  const sockets = fakeSockets();
  const session = createMatchSession({
    wsBaseUrl: 'ws://dev.local/ws',
    tickets: auth.api,
    auth: auth.store,
    storage,
    createSocket: sockets.factory,
    log: createLogger(() => undefined),
    onlineEvents: null,
    // Il socket finto non manda `timer_update`: senza questo la sessione lo darebbe per morto dopo 5 s (C10).
    silenceMs: 2_000_000_000,
  });
  session.findMatch();
  // Il ticket arriva in modo asincrono: si aspetta che il socket esista.
  for (let attempt = 0; attempt < 50 && sockets.sockets.length === 0; attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
  const socket = sockets.last();
  socket.open();
  socket.receive(gameState(MOVES.slice(0, 12), []));
  socket.receive({
    type: 'spell_cast',
    payload: { player: 'white', spell_id: 'aegis', targets: ['e4'], effects_applied: [{ kind: 'shield_piece', target: 'e4', remaining_turns: 2 }] },
  });
  socket.receive(gameState(MOVES, [SHIELD]));
  socket.receive({
    type: 'spell_cast',
    payload: { player: 'black', spell_id: 'frostbolt', targets: ['c3'], effects_applied: [{ kind: 'freeze_piece', target: 'c3', remaining_turns: 1 }] },
  });
  socket.receive(gameState(MOVES, [SHIELD, FREEZE]));
  socket.receive({ type: 'hand', payload: { hand: ['teleport', 'frostbolt', 'aegis', 'disintegrate', 'nova'], mana: 4, max_mana: 8, deck_size: 18 } });
  return { auth, session };
}

export function MatchPreview() {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<{ auth: Auth; session: MatchSession } | null>(null);

  useEffect(() => {
    let active = true;
    let started: MatchSession | null = null;
    void startPreview().then((value) => {
      started = value.session;
      if (active) setPreview(value);
      else value.session.dispose();
    });
    return () => {
      active = false;
      started?.dispose();
    };
  }, []);

  if (preview === null) return <Spinner label={t('match.joining')} />;
  return (
    <AuthProvider auth={preview.auth}>
      <MatchProvider session={preview.session}>
        <Match />
      </MatchProvider>
    </AuthProvider>
  );
}
