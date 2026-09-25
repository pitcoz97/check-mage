import { createLogger } from '../../lib/log';
import { createAuth, type Auth } from '../../store/authStore';
import { createMatchSession, type MatchSession } from '../../store/matchSession';
import { fakeSockets } from '../../testing/fakeSocket';
import { data, fakeServer, memoryStorage } from '../../testing/fakes';

/**
 * Impianto delle anteprime di sviluppo (`/dev/match`, `/dev/home`): un account, un server REST e un socket finti con
 * lo scenario delle tavole del design. I dati passano da adapter e reducer veri. Mai nella build di produzione.
 */

const SELF = { id: 7, username: 'Riccardo', email: 'dev@checkmage.local', elo: 1240, created_at: '2026-01-15T10:00:00Z' };
const OPPONENT = { id: 8, username: 'Morgana_77', elo: 1285, created_at: '2026-01-15T10:00:00Z' };

/** Le mosse della tavola (1. e4 e5 … 7. h3 c5) in UCI. */
const MOVES = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8e7', 'd2d3', 'g8f6', 'b1c3', 'd7d6', 'e1g1', 'e8g8', 'h2h3', 'c7c5'];
const FEN = 'r2q1rk1/pp2bppp/2np1n2/2p1p3/2B1P3/2NP1N1P/PPP2PP1/R1BQ1RK1 w - - 0 8';

/** Stati della partita che le tavole non disegnano, per vederli nell'anteprima (`/dev/match?scenario=…`). */
export const DEV_SCENARIOS = ['over', 'draw', 'reconnecting', 'replaced', 'disconnected', 'promotion'] as const;
export type DevScenario = (typeof DEV_SCENARIOS)[number];

export function isDevScenario(value: string | null): value is DevScenario {
  return value !== null && (DEV_SCENARIOS as readonly string[]).includes(value);
}

/** La posizione della tavola con un pedone bianco in b7 pronto a promuovere. */
const PROMOTION_FEN = 'r2q1rk1/pP2bppp/2np1n2/2p1p3/2B1P3/2NP1N1P/PPP2PP1/R1BQ1RK1 w - - 0 8';

function gameState(moves: readonly string[], activeEffects: readonly object[], overrides: { fen?: string; phase?: string } = {}) {
  return {
    type: 'game_state',
    payload: {
      board: { fen: overrides.fen ?? FEN, moves, turn: 'white', status: 'active' },
      white_player: { id: SELF.id, username: SELF.username },
      black_player: { id: OPPONENT.id, username: OPPONENT.username },
      time_control: { base_ms: 600_000, increment_ms: 5_000 },
      white_time: 252_000,
      black_time: 227_000,
      phase: overrides.phase ?? 'main1',
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

/** La classifica della tavola, con l'utente dentro i primi dieci per mostrarne la riga evidenziata. */
const LEADERBOARD = [
  { rank: 1, id: 21, username: 'VoidRook', elo: 2014 },
  { rank: 2, id: 22, username: 'Ser_Knight', elo: 1978 },
  { rank: 3, id: 23, username: 'Lady_Ember', elo: 1951 },
  { rank: 4, id: 8, username: 'Morgana_77', elo: 1285 },
  { rank: 5, id: 7, username: 'Riccardo', elo: 1240 },
];

const SHIELD = { square: 'e4', effects: [{ kind: 'shield', remaining_turns: 1, source_spell_id: 'shield' }] };
const FREEZE = { square: 'c3', effects: [{ kind: 'freeze', remaining_turns: 1, source_spell_id: 'ice_chain' }] };

/** Account e sessione finti per le anteprime: con `withMatch` la partita delle tavole è già in corso. */
export async function startDevSession({
  withMatch,
  scenario = null,
}: {
  withMatch: boolean;
  scenario?: DevScenario | null;
}): Promise<{ auth: Auth; session: MatchSession }> {
  const { storage } = memoryStorage();
  await storage.set('session', JSON.stringify({ accessToken: 'dev', refreshToken: 'dev' }));
  const server = fakeServer({
    'GET /me': () => data(SELF),
    'GET /ws/ticket': () => data({ ticket: 'dev', expires_in: 30 }),
    'GET /users/7': () => data({ user: SELF, stats: { wins: 23, losses: 17, draws: 4, total: 44 } }),
    'GET /users/8': () => data({ user: OPPONENT, stats: { wins: 0, losses: 0, draws: 0, total: 0 } }),
    'GET /leaderboard': () => data(LEADERBOARD),
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
  if (!withMatch) return { auth, session };
  session.findMatch();
  // Il ticket arriva in modo asincrono: si aspetta che il socket esista.
  for (let attempt = 0; attempt < 50 && sockets.sockets.length === 0; attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
  const socket = sockets.last();
  socket.open();
  socket.receive(gameState(MOVES.slice(0, 12), []));
  socket.receive({
    type: 'spell_cast',
    payload: { player: 'white', spell_id: 'shield', targets: ['e4'], effects_applied: [{ kind: 'shield_piece', target: 'e4', remaining_turns: 1 }] },
  });
  socket.receive(gameState(MOVES, [SHIELD]));
  socket.receive({
    type: 'spell_cast',
    payload: { player: 'black', spell_id: 'ice_chain', targets: ['c3'], effects_applied: [{ kind: 'freeze_piece', target: 'c3', remaining_turns: 1 }] },
  });
  socket.receive(gameState(MOVES, [SHIELD, FREEZE]));
  socket.receive({ type: 'hand', payload: { hand: ['blink', 'frost', 'shield', 'shatter', 'conscription'], mana: 4, max_mana: 8, deck_size: 18 } });
  if (scenario === 'over') socket.receive({ type: 'game_over', payload: { result: '1-0', reason: 'checkmate', winner: SELF.username } });
  if (scenario === 'draw') socket.receive({ type: 'draw_offer', payload: { from: OPPONENT.username } });
  if (scenario === 'disconnected') socket.receive({ type: 'opponent_disconnected', payload: { message: 'x' } });
  if (scenario === 'promotion') socket.receive(gameState(MOVES, [], { fen: PROMOTION_FEN, phase: 'move' }));
  // Il socket cade: la sessione riprova (banner con i secondi) o, con 4001, la partita è stata aperta altrove.
  if (scenario === 'reconnecting') socket.drop(1006);
  if (scenario === 'replaced') socket.drop(4001);
  return { auth, session };
}

