import express, { type NextFunction, type Request, type Response } from 'express';

import type { JwtService } from '../auth/jwt';
import type { TicketStore } from '../auth/tickets';
import type { MockConfig } from '../config';
import { publicUser, userProfile, validatePassword, validateUsername, type User, type UserStore } from '../store/users';
import { createRateLimiter } from './rateLimit';

export interface RestDeps {
  readonly config: MockConfig;
  readonly users: UserStore;
  readonly jwt: JwtService;
  readonly tickets: TicketStore;
  readonly catalog: unknown;
}

type AuthedRequest = Request & { user?: User };

function clientIp(req: Request): string {
  return req.socket.remoteAddress ?? 'unknown';
}

function fail(res: Response, status: number, error: string): void {
  res.status(status).json({ error });
}

export function createRestApp(deps: RestDeps) {
  const { config, users, jwt, tickets } = deps;
  const app = express();
  app.disable('x-powered-by');

  // --- CORS (P0-2) ---------------------------------------------------------------------------------
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin !== undefined && config.corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // --- Rate limit per IP -----------------------------------------------------------------------------
  if (config.rateLimits !== false) {
    const general = createRateLimiter(config.rateLimits.general);
    const auth = createRateLimiter(config.rateLimits.auth);
    app.use((req, res, next) => {
      const limiter = req.path.startsWith('/auth/') ? auth : general;
      if (!limiter.take(clientIp(req))) {
        fail(res, 429, 'rate_limited');
        return;
      }
      next();
    });
  }

  app.use(express.json({ limit: '32kb' }));

  function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
    const claims = token === null ? null : jwt.verify(token);
    const user = claims === null ? undefined : users.findById(Number(claims.sub));
    if (user === undefined) {
      fail(res, 401, 'unauthorized');
      return;
    }
    req.user = user;
    next();
  }

  function authedUser(req: AuthedRequest): User {
    if (req.user === undefined) throw new Error('requireAuth mancante');
    return req.user;
  }

  // --- Pubblici --------------------------------------------------------------------------------------
  app.get('/status', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.post('/auth/register', (req, res) => {
    const body: unknown = req.body;
    const { username, password } = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
    if (!validateUsername(username)) return fail(res, 400, 'invalid_username');
    if (!validatePassword(password)) return fail(res, 400, 'invalid_password');
    if (users.findByUsername(username) !== undefined) return fail(res, 409, 'username_taken');
    const user = users.create(username, password);
    res.status(201).json(publicUser(user));
  });

  app.post('/auth/login', (req, res) => {
    const body: unknown = req.body;
    const { username, password } = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
    const user = typeof username === 'string' ? users.findByUsername(username) : undefined;
    if (user === undefined || typeof password !== 'string' || !users.checkPassword(user, password)) {
      return fail(res, 401, 'invalid_credentials');
    }
    res.json({ token: jwt.issue(String(user.id), user.username), user: publicUser(user) });
  });

  app.get('/leaderboard', (_req, res) => {
    res.json(users.leaderboard(10).map(publicUser));
  });

  // G10: nel mock l'endpoint esiste. Il fallback su 404 si prova staccandolo.
  app.get('/spells', (_req, res) => {
    res.json(deps.catalog);
  });

  // --- Protetti --------------------------------------------------------------------------------------
  app.get('/me', requireAuth, (req: AuthedRequest, res) => {
    res.json(userProfile(authedUser(req)));
  });

  app.get('/users/:id', requireAuth, (req: AuthedRequest, res) => {
    const user = users.findById(Number(req.params['id']));
    if (user === undefined) return fail(res, 404, 'not_found');
    res.json(userProfile(user));
  });

  app.get('/users/:id/games', requireAuth, (req: AuthedRequest, res) => {
    const user = users.findById(Number(req.params['id']));
    if (user === undefined) return fail(res, 404, 'not_found');
    res.json(
      users.gamesOf(user.id).map(({ id, room_id, white, black, result, reason, ended_at }) => ({
        id,
        room_id,
        white,
        black,
        result,
        reason,
        ended_at,
      })),
    );
  });

  // P0-1: ticket monouso per l'upgrade WebSocket.
  app.get('/ws/ticket', requireAuth, (req: AuthedRequest, res) => {
    res.json({ ticket: tickets.issue(String(authedUser(req).id)), expires_in: tickets.ttlSeconds });
  });

  // --- Fallback ------------------------------------------------------------------------------------
  app.use((_req, res) => {
    fail(res, 404, 'not_found');
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status =
      typeof err === 'object' && err !== null && 'status' in err && typeof err.status === 'number' ? err.status : 500;
    fail(res, status, status === 400 ? 'invalid_body' : 'internal_error');
  });

  return app;
}
