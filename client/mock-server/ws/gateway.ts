import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import { WebSocketServer, type RawData, type WebSocket } from 'ws';

import { isScenarioName, type MockConfig } from '../config';
import { Room, type GameClient, type GameResult } from '../game/room';
import { clientKey, createRateLimiter } from '../rest/rateLimit';
import type { RequestGate } from '../rest/app';
import { Bot } from '../scenarios/bot';
import { hostileSender } from '../scenarios/hostile';
import { setupScenario } from '../scenarios/index';
import type { ScenarioName } from '../scenarios/names';
import { WS, type ServerText } from '../serverTexts';
import type { UserStore } from '../store/users';
import { createRng, type Logger } from '../util';
import type { WireServerMessage } from '../wire';

/**
 * Porting di `handlers/ws.go`, `game/client.go` e `game/manager.go`: upgrade, pump dei messaggi, coda e
 * riconnessione. Gli scenari con bot sono un'aggiunta del mock.
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

function rejectUpgrade(socket: Duplex, status: number, reason: string, body: string, type = 'application/json'): void {
  socket.write(
    `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Type: ${type}\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  );
  socket.destroy();
}

export function createGateway({ config, users, gate, log }: GatewayDeps) {
  const wss = new WebSocketServer({ noServer: true });
  const rooms = new Map<string, Room>();
  const userRooms = new Map<number, string>();
  const bots = new Set<Bot>();
  let waiting: Connection | null = null;
  let roomCounter = 0;

  const errorMessage = (text: ServerText): WireServerMessage => ({
    type: 'error',
    payload: config.contract === 'proposed' ? { message: text.message, code: text.code } : { message: text.message },
  });

  /** Goroutine di `endGame` (`game/room.go:997-1019`): salvataggio, ELO, rimozione dal manager. */
  function onEnded(room: Room, result: GameResult, reason: string): void {
    log.info(`${room.id} finita: ${result} (${reason})`);
    users.saveGame(room.white.userId, room.black.userId, room.pgn(), result, '10+0'); // B6
    // `RemoveRoom` (`game/manager.go:111-117`): i client tengono comunque il riferimento alla room (B4).
    rooms.delete(room.id);
    userRooms.delete(room.white.userId);
    userRooms.delete(room.black.userId);
  }

  function newRoom(white: GameClient, black: GameClient, scenario: ScenarioName): Room {
    roomCounter++;
    const setup = setupScenario(scenario, config);
    const room = new Room({
      id: `room-${white.userId}-${black.userId}`,
      white,
      black,
      rng: createRng(config.seed + roomCounter),
      contract: config.contract,
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

  /** `game/manager.go:30-96`. Restituisce `true` se è una riconnessione. */
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

    if (waiting === null) {
      waiting = client;
      log.info(`${client.username} in coda`);
      return false;
    }
    if (waiting.userId === client.userId) {
      client.send(errorMessage(WS.alreadyQueued)); // la connessione resta aperta e inutile (B10)
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

  /** `game/client.go:41-79`. */
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
    };
    const limits = config.rateLimits;
    const limiter = limits === false ? null : createRateLimiter(limits.wsMessages);

    ws.on('message', (data) => onFrame(client, limiter, data));
    ws.on('close', () => {
      if (client.killed) return;
      // `game/client.go:45-53`
      if (waiting?.userId === client.userId) waiting = null; // B10: per UserID
      client.room?.leave(client);
    });
    joinQueue(client, scenario);
  }

  return {
    /** Catena di `/ws`: limiter generale → Auth → limiter ws → upgrade (`api/router.go:27,46,51`). */
    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== '/ws') return rejectUpgrade(socket, 404, 'Not Found', '404 page not found\n', 'text/plain');
      const key = clientKey(req.headers, req.socket.remoteAddress, req.socket.remotePort);
      const tooMany = JSON.stringify({ success: false, error: 'Troppe richieste, rallenta!' });
      if (!gate.allow('general', key)) return rejectUpgrade(socket, 429, 'Too Many Requests', tooMany);

      const auth = gate.authenticate(req.headers.authorization, url.searchParams.get('token'));
      if ('message' in auth) return rejectUpgrade(socket, 401, 'Unauthorized', JSON.stringify({ success: false, error: auth.message }));
      if (!gate.allow('ws', key)) return rejectUpgrade(socket, 429, 'Too Many Requests', tooMany);
      // Un refresh token non ha `username`: in Go la type assertion va in panic → 500 (B3).
      if (auth.username === undefined) return rejectUpgrade(socket, 500, 'Internal Server Error', '', 'text/plain');

      const requested = url.searchParams.get('scenario') ?? config.scenario;
      if (!isScenarioName(requested)) return rejectUpgrade(socket, 400, 'Bad Request', `scenario sconosciuto: ${requested}\n`, 'text/plain');

      const { user_id: userId, username } = auth;
      wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, userId, username, requested));
    },

    close(): void {
      for (const bot of bots) bot.dispose();
      for (const room of rooms.values()) room.dispose();
      for (const client of wss.clients) client.terminate();
      wss.close();
    },
  };
}
