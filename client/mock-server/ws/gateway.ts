import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import { WebSocketServer, type RawData, type WebSocket } from 'ws';

import type { TicketStore } from '../auth/tickets';
import { isScenarioName, type MockConfig } from '../config';
import { Room, type GameOverSummary, type PlayerConnection } from '../game/room';
import { createRateLimiter } from '../rest/rateLimit';
import { Bot } from '../scenarios/bot';
import { setupScenario } from '../scenarios/index';
import type { ScenarioName } from '../scenarios/names';
import type { User, UserStore } from '../store/users';
import { createRng, type Logger } from '../util';
import { CLIENT_MESSAGE_TYPES, errorMessage, type WireClientType, type WireColor } from '../wire';

export interface GatewayDeps {
  config: MockConfig;
  users: UserStore;
  tickets: TicketStore;
  log: Logger;
}

const BOT_USERNAME = 'mock_bot';

interface Seat {
  room: Room;
  color: WireColor;
  /** Decorazione della connessione decisa dallo scenario della partita (es. ostile), riapplicata al rientro. */
  wrap: (conn: PlayerConnection) => PlayerConnection;
}

const identity = (conn: PlayerConnection): PlayerConnection => conn;

function rejectUpgrade(socket: Duplex, status: number, reason: string, error: string): void {
  const body = JSON.stringify({ error });
  socket.write(
    `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  );
  socket.destroy();
}

function wsConnection(ws: WebSocket): PlayerConnection {
  const sendText = (text: string) => {
    if (ws.readyState === ws.OPEN) ws.send(text);
  };
  return {
    send: (message) => sendText(JSON.stringify(message)),
    sendRaw: sendText,
    close: () => ws.close(4000, 'replaced'),
  };
}

function isClientType(value: unknown): value is WireClientType {
  return typeof value === 'string' && (CLIENT_MESSAGE_TYPES as readonly string[]).includes(value);
}

export function createGateway({ config, users, tickets, log }: GatewayDeps) {
  const wss = new WebSocketServer({ noServer: true });
  const wsLimiter = config.rateLimits === false ? null : createRateLimiter(config.rateLimits.ws);
  const rooms = new Set<Room>();
  const seatOf = new Map<number, Seat>();
  const bots = new Set<Bot>();
  let queue: { user: User; conn: PlayerConnection } | null = null;
  let roomCounter = 0;

  function botUser(): User {
    return users.findByUsername(BOT_USERNAME) ?? users.create(BOT_USERNAME, randomBytes(16).toString('hex'));
  }

  function onGameOver(summary: GameOverSummary): void {
    log.info(`${summary.roomId} finita: ${summary.result} (${summary.reason})`);
    users.recordGame({
      room_id: summary.roomId,
      white: summary.white.username,
      black: summary.black.username,
      whiteId: summary.white.userId,
      blackId: summary.black.userId,
      result: summary.result,
      reason: summary.reason,
    });
    for (const [userId, seat] of seatOf) if (seat.room.roomId === summary.roomId) seatOf.delete(userId);
  }

  function createRoom(white: User, black: User, scenario: ScenarioName): Room {
    roomCounter += 1;
    const setup = setupScenario(scenario, config);
    const room = new Room({
      roomId: `room-${white.id}-${black.id}-${roomCounter}`,
      white: { userId: white.id, username: white.username },
      black: { userId: black.id, username: black.username },
      rng: createRng(config.seed + roomCounter),
      clockMs: config.clockMs,
      reconnectTimeoutMs: config.reconnectTimeoutMs,
      ...setup.room,
      onGameOver,
    });
    rooms.add(room);
    return room;
  }

  /** Restituisce la connessione effettivamente agganciata al room (eventualmente decorata). */
  function startWithBot(user: User, conn: PlayerConnection, scenario: ScenarioName): PlayerConnection {
    const setup = setupScenario(scenario, config);
    const room = createRoom(user, botUser(), scenario);
    const bot = new Bot(room, 'black', setup.bot ?? {}, createRng(config.seed + 7), config.botDelayMs);
    bots.add(bot);
    const wrap = setup.wrapHuman ?? identity;
    const attached = wrap(conn);
    room.attach('white', attached);
    room.attach('black', bot.connection);
    seatOf.set(user.id, { room, color: 'white', wrap });
    log.info(`${room.roomId} scenario "${scenario}": ${user.username} vs bot`);
    room.start();
    return attached;
  }

  function joinQueue(user: User, conn: PlayerConnection): void {
    if (queue !== null && queue.user.id !== user.id) {
      const opponent = queue;
      queue = null;
      const room = createRoom(opponent.user, user, 'pvp');
      room.attach('white', opponent.conn);
      room.attach('black', conn);
      seatOf.set(opponent.user.id, { room, color: 'white', wrap: identity });
      seatOf.set(user.id, { room, color: 'black', wrap: identity });
      log.info(`${room.roomId} pvp: ${opponent.user.username} vs ${user.username}`);
      room.start();
      return;
    }
    if (queue !== null) queue.conn.close();
    queue = { user, conn };
    log.info(`${user.username} in coda`);
  }

  function onFrame(user: User, conn: PlayerConnection, data: RawData): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      return conn.send(errorMessage('malformed_message'));
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return conn.send(errorMessage('malformed_message'));
    const { type, payload } = parsed as { type?: unknown; payload?: unknown };
    if (typeof type !== 'string') return conn.send(errorMessage('malformed_message'));
    if (!isClientType(type)) return conn.send(errorMessage('unknown_message_type'));
    if (payload !== undefined && (typeof payload !== 'object' || payload === null || Array.isArray(payload))) {
      return conn.send(errorMessage('malformed_message'));
    }
    const seat = seatOf.get(user.id);
    if (seat === undefined || seat.room.isOver) return conn.send(errorMessage('no_active_game'));
    seat.room.handle(seat.color, { type, payload: (payload ?? {}) as Record<string, unknown> });
  }

  function onConnection(ws: WebSocket, user: User, scenario: ScenarioName): void {
    const conn = wsConnection(ws);
    let roomConn: PlayerConnection = conn;
    const seat = seatOf.get(user.id);

    if (seat !== undefined && !seat.room.isOver) {
      // Riconnessione a partita in corso (G5): vale lo scenario della partita, non quello del nuovo URL.
      roomConn = seat.wrap(conn);
      log.info(`${user.username} rientra in ${seat.room.roomId}`);
      seat.room.reconnect(seat.color, roomConn);
    } else if (scenario === 'pvp') {
      joinQueue(user, conn);
    } else {
      roomConn = startWithBot(user, conn, scenario);
    }

    ws.on('message', (data) => onFrame(user, conn, data));
    ws.on('close', () => {
      if (queue?.conn === conn) queue = null;
      const current = seatOf.get(user.id);
      if (current !== undefined) current.room.disconnect(current.color, roomConn);
    });
  }

  return {
    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== '/ws') return rejectUpgrade(socket, 404, 'Not Found', 'not_found');
      if (wsLimiter !== null && !wsLimiter.take(req.socket.remoteAddress ?? 'unknown')) {
        return rejectUpgrade(socket, 429, 'Too Many Requests', 'rate_limited');
      }
      const ticket = url.searchParams.get('ticket');
      const userId = ticket === null ? null : tickets.consume(ticket);
      const user = userId === null ? undefined : users.findById(Number(userId));
      if (user === undefined) return rejectUpgrade(socket, 401, 'Unauthorized', 'unauthorized');

      const requested = url.searchParams.get('scenario') ?? config.scenario;
      if (!isScenarioName(requested)) return rejectUpgrade(socket, 400, 'Bad Request', 'unknown_scenario');

      wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, user, requested));
    },

    close(): void {
      for (const bot of bots) bot.dispose();
      for (const room of rooms) room.shutdown();
      for (const client of wss.clients) client.terminate();
      wss.close();
    },
  };
}
