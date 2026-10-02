import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import { WebSocketServer, type RawData, type WebSocket } from 'ws';

import { isScenarioName, type MockConfig } from '../config';
import type { Color } from '../game/fen';
import { CLOSE_BOT, CLOSE_CHALLENGE, CLOSE_DECK_INVALID, CLOSE_REPLACED, Room, type GameClient, type GameResult } from '../game/room';
import { createRateLimiter } from '../rest/rateLimit';
import type { RequestGate } from '../rest/app';
import { Bot } from '../scenarios/bot';
import { isBotLevel } from '../scenarios/botPolicy';
import { hostileSender } from '../scenarios/hostile';
import { setupScenario } from '../scenarios/index';
import type { ScenarioName } from '../scenarios/names';
import { HTTP, WS, type GameError } from '../serverTexts';
import type { ChallengeCloseCode, ChallengeStore, ChallengeWaiter } from '../store/challenges';
import type { DeckStore } from '../store/decks';
import type { PresenceStore } from '../store/presence';
import type { UserStore } from '../store/users';
import { createRng, opaqueId, type Logger } from '../util';
import type { WireServerMessage } from '../wire';

/**
 * Porting di `handlers/ws.go`, `game/client.go` e `game/manager.go`: upgrade, pump dei messaggi, heartbeat, coda
 * e riconnessione, più le sfide dirette di `game/challenges.go` e le partite contro il bot di `game/bot.go`. Gli
 * scenari con bot sono un'aggiunta del mock.
 */

export interface GatewayDeps {
  config: MockConfig;
  users: UserStore;
  gate: RequestGate;
  log: Logger;
  decks: DeckStore;
  presence: PresenceStore;
  challenges: ChallengeStore;
}

/** Il `Client` di Go con la sua connessione. */
interface Connection extends GameClient, ChallengeWaiter {
  room: Room | null;
  ws: WebSocket;
  /** Chiuso dalla simulazione di riavvio: il processo "muore", quindi nessun `Leave`. */
  killed: boolean;
  /** Mazzo attivo letto all'apertura (`handlers/ws.go`, D6), e se è valido. */
  deck: readonly string[];
  deckValid: boolean;
}

const BOT = { username: 'mock_bot', email: 'bot@mock.local' };

/** `maxMessageSize` (`game/client.go:23`). */
const MAX_MESSAGE_BYTES = 4096;

/** `closeWith` (`game/client.go:142-153`): la chiusura parte dopo un attimo, così l'errore che la spiega arriva prima. */
const CLOSE_DELAY_MS = 250;

function rejectUpgrade(socket: Duplex, status: number, reason: string, body: string): void {
  socket.write(
    `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  );
  socket.destroy();
}

const envelopeError = (message: string) => JSON.stringify({ success: false, error: message });

const CHALLENGE_ERRORS: Record<ChallengeCloseCode, GameError> = {
  challenge_declined: WS.challengeDeclined,
  challenge_expired: WS.challengeExpired,
  challenge_unavailable: WS.challengeUnavailable,
};

export function createGateway({ config, users, gate, log, decks, presence, challenges }: GatewayDeps) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const rooms = new Map<string, Room>();
  const userRooms = new Map<number, string>();
  const bots = new Set<Bot>();
  let waiting: Connection | null = null;
  let roomCounter = 0;

  /** `sendErr` (`game/client.go:126-137`). */
  const errorMessage = (error: GameError): WireServerMessage => ({
    type: 'error',
    payload: {
      message: error.message,
      code: error.code,
      ...(error.details === undefined ? {} : { details: { ...error.details } }),
    },
  });

  /** Goroutine di `announceEnd` (`game/room.go:1246-1256`): salvataggio, ELO, rimozione dal manager. */
  function onEnded(room: Room, result: GameResult, reason: string): void {
    log.info(`${room.id} finita: ${result} (${reason})`);
    users.saveGame(room.white.userId, room.black.userId, room.pgn(), result, room.timeControl(), !room.friendly);
    // `RemoveRoom` (`game/manager.go:121-132`): l'indice utente si toglie solo se punta ancora a questa room.
    rooms.delete(room.id);
    for (const userId of [room.white.userId, room.black.userId]) {
      if (userRooms.get(userId) === room.id) userRooms.delete(userId);
    }
  }

  function newRoom(
    white: GameClient,
    black: GameClient,
    scenario: ScenarioName,
    deckOf: (c: GameClient) => readonly string[] | undefined,
    origin: { challengeId?: string; bot?: { level: string; color: Color } } = {},
  ): Room {
    roomCounter++;
    const setup = setupScenario(scenario, config);
    const rng = createRng(config.seed + roomCounter);
    const id =
      origin.challengeId !== undefined
        ? `challenge-${origin.challengeId}`
        : origin.bot !== undefined
          ? opaqueId('bot', rng)
          : `room-${white.userId}-${black.userId}`;
    const whiteDeck = deckOf(white);
    const blackDeck = deckOf(black);
    const room = new Room({
      id,
      friendly: origin.challengeId !== undefined || origin.bot !== undefined,
      white,
      black,
      rng,
      baseTimeMs: setup.baseTimeMs ?? config.baseTimeMs,
      incrementMs: config.incrementMs,
      reconnectTimeoutMs: config.reconnectTimeoutMs,
      ...(setup.overrides === undefined ? {} : { overrides: setup.overrides }),
      // Un mazzo assente è la ricetta condivisa (`match.NewWithDecks` con nil): il mazzo del bot.
      decks: { ...(whiteDeck === undefined ? {} : { white: whiteDeck }), ...(blackDeck === undefined ? {} : { black: blackDeck }) },
      ...(origin.bot === undefined ? {} : { bot: origin.bot }),
      onEnded,
    });
    rooms.set(room.id, room);
    // Il bot non è mai «in partita»: lo stesso livello gioca più partite insieme.
    if (origin.bot?.color !== 'white') userRooms.set(white.userId, room.id);
    if (origin.bot?.color !== 'black') userRooms.set(black.userId, room.id);
    // Le sfide ancora aperte dei due giocatori non possono più partire (F9).
    challenges.closeOf(white.userId, black.userId);
    return room;
  }

  /** Simulazione del riavvio del server: socket chiusi senza `Leave`, room dormiente. */
  function restart(room: Room): void {
    log.info(`${room.id}: riavvio simulato`);
    const clients = [room.white, room.black];
    room.suspendForRestart();
    for (const c of clients) {
      const conn = c as Partial<Connection>;
      if (conn.ws !== undefined) {
        conn.killed = true;
        conn.ws.terminate();
      }
    }
  }

  function botUserId(): number {
    const existing = users.findByEmail(BOT.email);
    return (existing ?? users.insert(BOT.username, BOT.email, 'MockBot123'))?.id ?? 0;
  }

  /** `tryReconnectLocked` (`game/manager.go`): rientro nella partita in corso. */
  function tryReconnect(client: Connection): boolean {
    const roomId = userRooms.get(client.userId);
    if (roomId === undefined) return false;
    const room = rooms.get(roomId);
    if (room !== undefined && room.isActive()) {
      log.info(`${client.username} rientra in ${roomId}`);
      client.room = room;
      room.reconnect(client);
      return true;
    }
    userRooms.delete(client.userId);
    return false;
  }

  /** `inMatchLocked`: l'utente ha una partita attiva. */
  function inMatch(userId: number): boolean {
    const roomId = userRooms.get(userId);
    const room = roomId === undefined ? undefined : rooms.get(roomId);
    return room !== undefined && room.isActive();
  }

  /** Mazzo attivo non valido: errore e chiusura (`manager.go`, D6). */
  function rejectInvalidDeck(client: Connection): boolean {
    if (client.deckValid) return false;
    client.send(errorMessage(WS.deckInvalid));
    client.close?.(CLOSE_DECK_INVALID, 'deck_invalid');
    return true;
  }

  /** `game/manager.go:31-101`. Restituisce `true` se è una riconnessione. */
  function joinQueue(client: Connection, scenario: ScenarioName): boolean {
    if (tryReconnect(client)) return true;
    if (rejectInvalidDeck(client)) return false;

    if (scenario !== 'pvp') {
      startWithBot(client, scenario);
      return false;
    }

    // Stesso utente già in coda da un'altra connessione: la nuova prende il posto della vecchia (`manager.go:50-64`).
    if (waiting !== null && waiting.userId === client.userId) {
      const old = waiting;
      waiting = client;
      if (old !== client) {
        old.send(errorMessage(WS.replacedInQueue));
        old.close?.(CLOSE_REPLACED, 'replaced_by_new_connection');
      }
      log.info(`${client.username}: connessione in coda sostituita`);
      return false;
    }
    if (waiting === null) {
      waiting = client;
      log.info(`${client.username} in coda`);
      return false;
    }
    const opponent = waiting;
    waiting = null;
    const room = newRoom(opponent, client, 'pvp', (c) => (c === opponent ? opponent.deck : client.deck));
    opponent.room = room;
    client.room = room;
    log.info(`${room.id} creata: ${opponent.username} (bianco) vs ${client.username} (nero)`);
    room.start();
    return false;
  }

  /** `JoinChallenge` (`game/challenges.go`): il primo aspetta nello slot, il secondo fa partire l'amichevole. */
  function joinChallenge(client: Connection, id: string): boolean {
    if (tryReconnect(client)) return true;
    const ch = challenges.get(id);
    if (ch === undefined || (client.userId !== ch.from.id && client.userId !== ch.to.id)) {
      client.challengeClosed('challenge_unavailable');
      return false;
    }
    if (rejectInvalidDeck(client)) return false;

    // Una connessione dello stesso utente rimasta in coda esce dalla coda.
    if (waiting !== null && waiting.userId === client.userId && waiting !== client) {
      const old = waiting;
      waiting = null;
      old.send(errorMessage(WS.replacedByChallenge));
      old.close?.(CLOSE_REPLACED, 'replaced_by_new_connection');
    }

    const slot = ch.slot as Connection | null;
    if (slot === null || slot.userId === client.userId) {
      ch.slot = client;
      if (slot !== null && slot !== client) {
        slot.send(errorMessage(WS.replacedInChallenge));
        slot.close?.(CLOSE_REPLACED, 'replaced_by_new_connection');
      }
      log.info(`${client.username} aspetta la sfida`);
      return false;
    }

    challenges.started(ch);
    const [white, black] = createRng(config.seed + roomCounter)() < 0.5 ? [slot, client] : [client, slot];
    const room = newRoom(white, black, 'pvp', (c) => (c === white ? white.deck : black.deck), { challengeId: ch.id });
    white.room = room;
    black.room = room;
    log.info(`${room.id} amichevole: ${white.username} (bianco) vs ${black.username} (nero)`);
    room.start();
    return false;
  }

  /** `JoinBot` (`game/bot.go`): partita amichevole contro il bot del livello, col colore scelto dal giocatore. */
  function joinBot(client: Connection, level: string, color: string | null): boolean {
    if (tryReconnect(client)) return true;
    if (!isBotLevel(level)) {
      client.send(errorMessage(WS.botUnavailable));
      client.close?.(CLOSE_BOT, 'bot_unavailable');
      return false;
    }
    if (rejectInvalidDeck(client)) return false;

    // Una connessione dello stesso utente rimasta in coda esce dalla coda.
    if (waiting !== null && waiting.userId === client.userId && waiting !== client) {
      const old = waiting;
      waiting = null;
      old.send(errorMessage(WS.replacedByBot));
      old.close?.(CLOSE_REPLACED, 'replaced_by_new_connection');
    }

    const rng = createRng(config.seed + roomCounter + client.userId);
    const botColor: Color = color === 'white' ? 'black' : color === 'black' ? 'white' : rng() < 0.5 ? 'white' : 'black';
    const account = users.ensureBot(level);
    const bot = new Bot(account.id, account.username, botColor, { level: { name: level, rng } }, config.botDelayMs, { restart });
    bots.add(bot);
    const [white, black] = botColor === 'white' ? [bot.gameClient, client] : [client, bot.gameClient];
    const room = newRoom(white, black, 'pvp', (c) => (c === client ? client.deck : undefined), { bot: { level, color: botColor } });
    bot.attach(room);
    client.room = room;
    log.info(`${room.id} contro il bot ${level}: ${client.username} col ${botColor === 'white' ? 'nero' : 'bianco'}`);
    room.start();
    return false;
  }

  function startWithBot(client: Connection, scenario: ScenarioName): void {
    const setup = setupScenario(scenario, config);
    const bot = new Bot(botUserId(), BOT.username, 'black', setup.bot ?? {}, config.botDelayMs, { restart });
    bots.add(bot);
    // Il bot gioca col suo mazzo iniziale.
    const room = newRoom(client, bot.gameClient, scenario, (c) => (c === client ? client.deck : decks.activeDeck(bot.gameClient.userId).cards));
    bot.attach(room);
    client.room = room;
    log.info(`${room.id} scenario "${scenario}": ${client.username} vs bot`);
    room.start();
  }

  /** `game/client.go:94-121`. */
  function onFrame(client: Connection, limiter: ReturnType<typeof createRateLimiter> | null, data: RawData): void {
    if (limiter !== null && !limiter.allow('conn')) return client.send(errorMessage(WS.rateLimited));
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      return client.send(errorMessage(WS.malformedEnvelope));
    }
    // `json.Unmarshal` in `WSMessage`: `null` è valido (type vuoto), un non-oggetto o un type non stringa no.
    if (parsed !== null && (typeof parsed !== 'object' || Array.isArray(parsed))) return client.send(errorMessage(WS.malformedEnvelope));
    const record = (parsed ?? {}) as Record<string, unknown>;
    const type = record['type'];
    if (type !== undefined && type !== null && typeof type !== 'string') return client.send(errorMessage(WS.malformedEnvelope));
    client.room?.handleMessage(client, typeof type === 'string' ? type : '', record['payload']);
  }

  /** Heartbeat (`game/client.go:19-24,44-73,91-97`): ping periodici, chiusura dopo `pongWaitMs` di silenzio. */
  function startHeartbeat(ws: WebSocket): () => void {
    let lastSeen = Date.now();
    const seen = () => {
      lastSeen = Date.now();
    };
    ws.on('pong', seen);
    ws.on('message', seen);
    const ping = setInterval(() => {
      if (ws.readyState === ws.OPEN) ws.ping();
    }, config.heartbeat.pingMs);
    const deadline = setInterval(
      () => {
        if (Date.now() - lastSeen > config.heartbeat.pongWaitMs) ws.terminate();
      },
      Math.min(1000, config.heartbeat.pongWaitMs),
    );
    return () => {
      clearInterval(ping);
      clearInterval(deadline);
    };
  }

  function onConnection(
    ws: WebSocket,
    userId: number,
    username: string,
    scenario: ScenarioName,
    challengeId: string | null,
    botRequest: { level: string; color: string | null } | null,
  ): void {
    presence.touch(userId); // aprire il socket vale come segnale di presenza (F2)
    const sendRaw = (text: string) => {
      if (ws.readyState === ws.OPEN) ws.send(text);
    };
    const plainSend = (message: WireServerMessage) => sendRaw(JSON.stringify(message));
    const setup = setupScenario(scenario, config);
    const active = decks.activeDeck(userId);
    const client: Connection = {
      userId,
      username,
      room: null,
      ws,
      killed: false,
      deck: active.cards,
      deckValid: active.valid,
      send: setup.hostile === true ? hostileSender(sendRaw) : plainSend,
      close(code, reason) {
        setTimeout(() => {
          if (ws.readyState === ws.OPEN) ws.close(code, reason);
        }, CLOSE_DELAY_MS);
      },
      challengeClosed(code: ChallengeCloseCode) {
        client.send(errorMessage(CHALLENGE_ERRORS[code]));
        client.close?.(CLOSE_CHALLENGE, code);
      },
    };
    const limits = config.rateLimits;
    const limiter = limits === false ? null : createRateLimiter(limits.wsMessages);
    const stopHeartbeat = startHeartbeat(ws);

    ws.on('message', (data) => onFrame(client, limiter, data));
    ws.on('close', () => {
      stopHeartbeat();
      if (client.killed) return;
      // `game/client.go:81-88`: `LeaveQueue` confronta la connessione, non l'utente.
      if (waiting === client) waiting = null;
      challenges.leave(client);
      client.room?.leave(client);
    });
    if (challengeId !== null) joinChallenge(client, challengeId);
    else if (botRequest !== null) joinBot(client, botRequest.level, botRequest.color);
    else joinQueue(client, scenario);
  }

  return {
    /** Catena di `/ws`: limiter generale → limiter ws → `WSAuth` → upgrade (`api/router.go:30,62`). */
    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== '/ws') return rejectUpgrade(socket, 404, 'Not Found', envelopeError(HTTP.notFound.message));
      const key = gate.keyOf(req.headers, req.socket.remoteAddress);
      const tooMany = envelopeError(HTTP.tooManyRequests.message);
      if (!gate.allow('general', key)) return rejectUpgrade(socket, 429, 'Too Many Requests', tooMany);
      if (!gate.allow('ws', key)) return rejectUpgrade(socket, 429, 'Too Many Requests', tooMany);

      const auth = gate.authenticateSocket(req.headers.authorization, url.searchParams);
      if ('message' in auth) return rejectUpgrade(socket, 401, 'Unauthorized', envelopeError(auth.message));

      const requested = url.searchParams.get('scenario') ?? config.scenario;
      if (!isScenarioName(requested)) {
        return rejectUpgrade(socket, 400, 'Bad Request', envelopeError(`scenario sconosciuto: ${requested}`));
      }

      const challengeId = url.searchParams.get('challenge');
      const botLevel = url.searchParams.get('bot');
      const botRequest = botLevel === null || botLevel === '' ? null : { level: botLevel, color: url.searchParams.get('color') };
      wss.handleUpgrade(req, socket, head, (ws) =>
        onConnection(ws, auth.user_id, auth.username, requested, challengeId === null || challengeId === '' ? null : challengeId, botRequest),
      );
    },

    /** Per `GET /me/friends` e le sfide: chi è in partita. */
    inMatch,
    playingIds(): number[] {
      return [...userRooms.keys()].filter(inMatch);
    },

    close(): void {
      for (const bot of bots) bot.dispose();
      for (const room of rooms.values()) room.dispose();
      for (const client of wss.clients) client.terminate();
      wss.close();
    },
  };
}
