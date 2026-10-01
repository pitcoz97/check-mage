import { createLogger } from '../../lib/log';
import fallbackCatalog from '../../spells/fallback.json';
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
export const DEV_SCENARIOS = ['over', 'draw', 'reconnecting', 'replaced', 'disconnected', 'promotion', 'spells', 'rune'] as const;
export type DevScenario = (typeof DEV_SCENARIOS)[number];

export function isDevScenario(value: string | null): value is DevScenario {
  return value !== null && (DEV_SCENARIOS as readonly string[]).includes(value);
}

/** La posizione della tavola con un pedone bianco in b7 pronto a promuovere. */
const PROMOTION_FEN = 'r2q1rk1/pP2bppp/2np1n2/2p1p3/2B1P3/2NP1N1P/PPP2PP1/R1BQ1RK1 w - - 0 8';

function gameState(
  moves: readonly string[],
  activeEffects: readonly object[],
  overrides: { fen?: string; phase?: string; extra?: Record<string, unknown> } = {},
) {
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
      ...overrides.extra,
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

/** `GET /me/collection` delle anteprime: la collezione piena, come col server finché tutte le carte sono sbloccate (C12). */
const COLLECTION = (() => {
  const cards = [...fallbackCatalog]
    .sort((a, b) => a.mana_cost - b.mana_cost || a.id.localeCompare(b.id))
    .map((spell) => {
      const max = spell.rarity === 'legendary' ? 1 : 2;
      return { spell_id: spell.id, copies: max, max_copies: max };
    });
  return { cards, owned: cards.reduce((n, c) => n + c.copies, 0), total: cards.reduce((n, c) => n + c.max_copies, 0) };
})();

/** `GET /me/decks` delle anteprime: il mazzo iniziale attivo, un mazzo di gelo e una bozza. Le scritture non ci sono. */
/** 40 carte possedute, dalle più economiche. */
const DECK_CARDS = (() => {
  const out: { spell_id: string; copies: number }[] = [];
  let total = 0;
  for (const c of COLLECTION.cards) {
    const copies = Math.min(c.copies, c.max_copies, 40 - total);
    if (copies > 0) out.push({ spell_id: c.spell_id, copies });
    total += Math.max(0, copies);
  }
  return out;
})();
const DECKS = {
  decks: [
    {
      id: 1,
      name: 'Mazzo iniziale',
      cards: DECK_CARDS,
      size: 40,
      valid: true,
      active: true,
      updated_at: '2026-09-20T10:00:00Z',
    },
    {
      id: 2,
      name: 'Gelo & Ombra',
      cards: [
        { spell_id: 'frost', copies: 2 },
        { spell_id: 'ice_wall', copies: 2 },
        { spell_id: 'ice_chain', copies: 2 },
        { spell_id: 'shatter', copies: 2 },
        { spell_id: 'stasis_rune', copies: 2 },
      ],
      size: 10,
      valid: false,
      active: false,
      updated_at: '2026-09-27T10:00:00Z',
    },
  ],
  max_decks: 10,
  deck_size: 40,
};

/**
 * `GET /me/friends` delle anteprime (A1–A3): due amici veri, gli altri giocatori (finché tutti sono sfidabili), una
 * richiesta ricevuta e una inviata. In ogni lista online prima, poi in partita, poi offline.
 */
const FRIENDS = {
  friends: [
    { id: 8, username: 'Morgana_77', elo: 1285, status: 'online' },
    { id: 21, username: 'VoidRook', elo: 2014, status: 'playing' },
  ],
  others: [
    { id: 22, username: 'Ser_Knight', elo: 1978, status: 'online' },
    { id: 24, username: 'Alchimista', elo: 1190, status: 'online' },
    { id: 25, username: 'Torre_Nera', elo: 1402, status: 'offline' },
  ],
  incoming: [{ id: 26, username: 'Strega_Blu', elo: 1320, status: 'online' }],
  outgoing: [{ id: 23, username: 'Lady_Ember', elo: 1951, status: 'offline' }],
  online: 3,
  max_friends: 200,
};

/** `GET /users/search` delle anteprime: qualunque ricerca trova questi tre. */
const SEARCH = [
  { id: 25, username: 'Torre_Nera', elo: 1402, relation: 'none' },
  { id: 23, username: 'Lady_Ember', elo: 1951, relation: 'outgoing' },
  { id: 8, username: 'Morgana_77', elo: 1285, relation: 'friend' },
];

/** `GET /me/blocks` delle anteprime. */
const BLOCKS = [{ id: 31, username: 'Troll_99' }];

/** Una sfida in arrivo da Morgana, per vedere il banner. */
const INCOMING = {
  incoming: [{ id: 'dev-challenge', from: { id: 8, username: 'Morgana_77', elo: 1285 }, to: { id: 7, username: 'Riccardo', elo: 1240 }, expires_in: 45 }],
  friend_requests: 1,
};

/** Ultime partite di Morgana: una classificata vinta, un'amichevole persa, una patta. */
const GAMES = [
  { id: 3, white_id: 8, black_id: 7, white: 'Morgana_77', black: 'Riccardo', result: '1-0', time_control: '10+5', pgn: '', played_at: '2026-09-30T18:00:00Z', rated: true },
  { id: 2, white_id: 21, black_id: 8, white: 'VoidRook', black: 'Morgana_77', result: '1-0', time_control: '10+5', pgn: '', played_at: '2026-09-29T18:00:00Z', rated: false },
  { id: 1, white_id: 8, black_id: 22, white: 'Morgana_77', black: 'Ser_Knight', result: '1/2-1/2', time_control: '10+5', pgn: '', played_at: '2026-09-28T18:00:00Z', rated: true },
];

const SHIELD = { square: 'e4', effects: [{ kind: 'shield', remaining_turns: 1, source_spell_id: 'shield' }] };
const FREEZE = { square: 'c3', effects: [{ kind: 'freeze', remaining_turns: 1, source_spell_id: 'ice_chain' }] };
/** Step 6: l'alfiere in c1 è in phasing (Passo sfasato), fino alla fine del turno. */
const PHASING = { square: 'c1', effects: [{ kind: 'phasing', remaining_turns: 0, source_spell_id: 'phase_step', caster: 'white' }] };

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
    'GET /users/8': () => data({ user: OPPONENT, stats: { wins: 12, losses: 9, draws: 2, total: 23 } }),
    'GET /users/8/games': () => data(GAMES),
    'GET /users/7/games': () => data(GAMES),
    'GET /me/friends': () => data(FRIENDS),
    'GET /users/search': () => data(SEARCH),
    'GET /me/blocks': () => data(BLOCKS),
    'POST /me/presence': () => data(INCOMING),
    'DELETE /me/challenges/dev-challenge': () => data(null),
    'GET /leaderboard': () => data(LEADERBOARD),
    'GET /me/collection': () => data(COLLECTION),
    'GET /me/decks': () => data(DECKS),
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
  // Magie dello Step 2: cimiteri non vuoti nelle righe dei giocatori e carte che chiedono la scelta del pezzo
  // (Promozione anticipata sul pedone in b7, Resurrezione con due tipi nel cimitero). Dello Step 3: un muro e un
  // santuario sulle case. Dello Step 4: una propria runa nascosta in e6, una runa nemica rivelata in a3, carte di rune
  // in mano e l'avviso di una magia nascosta dell'avversario; con `rune` anche l'avviso di una runa scattata. Dello
  // Step 5: trigger e aure nelle righe dei giocatori. Dello Step 6: l'alfiere in c1 in phasing e le tre carte nuove in mano.
  if (scenario === 'spells' || scenario === 'rune') {
    socket.receive(
      gameState(MOVES, [PHASING], {
        fen: PROMOTION_FEN,
        extra: {
          white_mana: 10,
          white_max_mana: 10,
          white_graveyard: ['knight', 'rook', 'pawn'],
          black_graveyard: ['pawn', 'pawn', 'bishop'],
          square_effects: [
            { square: 'd5', effects: [{ kind: 'wall', remaining_turns: 2, source_spell_id: 'ice_wall', caster: 'black' }] },
            { square: 'e4', effects: [{ kind: 'no_capture', remaining_turns: 3, source_spell_id: 'sanctuary', caster: 'white' }] },
            {
              square: 'e6',
              effects: [
                { kind: 'rune', remaining_turns: -1, source_spell_id: 'stasis_rune', caster: 'white', hidden: true, rune: { on_enter: 'freeze_piece', duration: 2 } },
              ],
            },
            {
              square: 'a3',
              effects: [{ kind: 'rune', remaining_turns: -1, source_spell_id: 'repel_rune', caster: 'black', rune: { on_enter: 'return_to_origin' } }],
            },
          ],
          // Step 5: un proprio Riflesso nascosto e uno Stendardo attivo; l'Anima inquieta dell'avversario.
          triggers: [
            { player: 'white', on: 'shielded_piece_attacked', do: 'freeze_attacker', remaining_turns: 1, source_spell_id: 'reflection', hidden: true },
            { player: 'black', on: 'own_piece_lost', do: 'draw_card', remaining_turns: 1, source_spell_id: 'restless_soul' },
          ],
          auras: [{ player: 'white', grant: 'pawn_sidestep', active: true, min_own_pawns: 6, source_spell_id: 'banner' }],
        },
      }),
    );
    socket.receive({
      type: 'hand',
      payload: { hand: ['early_promotion', 'restless_soul', 'phase_step', 'echo_of_fallen', 'haste'], mana: 10, max_mana: 10, deck_size: 18 },
    });
    socket.receive({ type: 'spell_cast', payload: { player: 'black', hidden: true, effects_applied: [{ kind: 'hidden_effect' }] } });
  }
  if (scenario === 'rune') {
    socket.receive({
      type: 'rune_triggered',
      payload: { square: 'f3', owner: 'black', on_enter: 'freeze_piece', result: { kind: 'freeze_piece', target: 'f3', remaining_turns: 3 } },
    });
  }
  // Il socket cade: la sessione riprova (banner con i secondi) o, con 4001, la partita è stata aperta altrove.
  if (scenario === 'reconnecting') socket.drop(1006);
  if (scenario === 'replaced') socket.drop(4001);
  return { auth, session };
}

