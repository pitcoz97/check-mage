import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import { WebSocketServer, type RawData, type WebSocket } from 'ws';

import { isScenarioName, type MockConfig } from '../config';
import { CLOSE_REPLACED, Room, type GameClient, type GameResult } from '../game/room';
import { createRateLimiter } from '../rest/rateLimit';
import type { RequestGate } from '../rest/app';
import { Bot } from '../scenarios/bot';
import { hostileSender } from '../scenarios/hostile';
import { setupScenario } from '../scenarios/index';
import type { ScenarioName } from '../scenarios/names';
import { HTTP, WS, type GameError } from '../serverTexts';
import type { UserStore } from '../store/users';
import { createRng, type Logger } from '../util';
import type { WireServerMessage } from '../wire';

/**
 * Porting di `handlers/ws.go`, `game/client.go` e `game/manager.go`: upgrade, pump dei messaggi, heartbeat, coda
 * e riconnessione. Gli scenari con bot sono un'aggiunta del mock.
 */

export interface GatewayDeps {
  config: MockConfig;
  users: UserStore;
  gate: RequestGate;
  log: Logger;
}

/** Il `Client` di Go con la sua connessione. */
interface Connection extends GameClient {
  room: Room | null;
  ws: WebSocket;
  /** Chiuso dalla simulazione di riavvio: il processo "muore", quindi nessun `Leave`. */
  killed: boolean;
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

export function createGateway({ config, users, gate, log }: GatewayDeps) {
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
    users.saveGame(room.white.userId, room.black.userId, room.pgn(), result, room.timeControl());
    // `RemoveRoom` (`game/manager.go:121-132`): l'indice utente si toglie solo se punta ancora a questa room.
    rooms.delete(room.id);
    for (const userId of [room.white.userId, room.black.userId]) {
      if (userRooms.get(userId) === room.id) userRooms.delete(userId);
    }
  }

  function newRoom(white: GameClient, black: GameClient, scenario: ScenarioName): Room {
    roomCounter++;
    const setup = setupScenario(scenario, config);
    const room = new Room({
      id: `room-${white.userId}-${black.userId}`,
      white,
      black,
      rng: createRng(config.seed + roomCounter),
      baseTimeMs: setup.baseTimeMs ?? config.baseTimeMs,
      incrementMs: config.incrementMs,
      reconnectTimeoutMs: config.reconnectTimeoutMs,
      ...(setup.overrides === undefined ? {} : { overrides: setup.overrides }),
      onEnded,
    });
    rooms.set(room.id, room);
    userRooms.set(white.userId, room.id);
    userRooms.set(black.userId, room.id);
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

  /** `game/manager.go:31-101`. Restituisce `true` se è una riconnessione. */
  function joinQueue(client: Connection, scenario: ScenarioName): boolean {
    const roomId = userRooms.get(client.userId);
    if (roomId !== undefined) {
      const room = rooms.get(roomId);
      if (room !== undefined && room.isActive()) {
        log.info(`${client.username} rientra in ${roomId}`);
        client.room = room;
        room.reconnect(client);
        return true;
      }
      userRooms.delete(client.userId);
    }

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
    const room = newRoom(opponent, client, 'pvp');
    opponent.room = room;
    client.room = room;
    log.info(`${room.id} creata: ${opponent.username} (bianco) vs ${client.username} (nero)`);
    room.start();
    return false;
  }

  function startWithBot(client: Connection, scenario: ScenarioName): void {
    const setup = setupScenario(scenario, config);
    const bot = new Bot(botUserId(), BOT.username, 'black', setup.bot ?? {}, config.botDelayMs, { restart });
    bots.add(bot);
    const room = newRoom(client, bot.gameClient, scenario);
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

  function onConnection(ws: WebSocket, userId: number, username: string, scenario: ScenarioName): void {
    const sendRaw = (text: string) => {
      if (ws.readyState === ws.OPEN) ws.send(text);
    };
    const plainSend = (message: WireServerMessage) => sendRaw(JSON.stringify(message));
    const setup = setupScenario(scenario, config);
    const client: Connection = {
      userId,
      username,
      room: null,
      ws,
      killed: false,
      send: setup.hostile === true ? hostileSender(sendRaw) : plainSend,
      close(code, reason) {
        setTimeout(() => {
          if (ws.readyState === ws.OPEN) ws.close(code, reason);
        }, CLOSE_DELAY_MS);
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
      client.room?.leave(client);
    });
    joinQueue(client, scenario);
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

      wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, auth.user_id, auth.username, requested));
    },

    close(): void {
      for (const bot of bots) bot.dispose();
      for (const room of rooms.values()) room.dispose();
      for (const client of wss.clients) client.terminate();
      wss.close();
    },
  };
}
