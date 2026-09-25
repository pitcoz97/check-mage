import express, { type NextFunction, type Request, type Response } from 'express';

import type { AccessClaims, JwtService } from '../auth/jwt';
import type { TicketStore } from '../auth/tickets';
import type { MockConfig } from '../config';
import { HTTP, type ServerText } from '../serverTexts';
import { PASSWORD_POLICY, validateRegister, type User, type UserStore } from '../store/users';
import { clientKey, createRateLimiter } from './rateLimit';

/**
 * Porting di `api/router.go` e degli handler REST di chess-server.
 * Inviluppo `{success, data?, error?}` (`models/response.go:5-9`).
 */

export interface RestDeps {
  readonly config: MockConfig;
  readonly users: UserStore;
  readonly jwt: JwtService;
  readonly tickets: TicketStore;
  /** Catalogo grezzo di `spells.json`, servito da `GET /spells`. */
  readonly catalog: readonly SpellLike[];
}

interface SpellLike {
  readonly id: string;
  readonly mana_cost: number;
}

type AuthedRequest = Request & { claims?: AccessClaims };

function ok(res: Response, data: unknown, status = 200): void {
  res.status(status).json({ success: true, data });
}

function fail(res: Response, status: number, text: ServerText): void {
  res.status(status).json({ success: false, error: text.message });
}

/** `User` serializzato come `models/user.go:4-11` (`created_at` omesso se vuoto). */
function userJson(user: User, fields: { email: boolean; createdAt: boolean }) {
  return {
    id: user.id,
    username: user.username,
    ...(fields.email ? { email: user.email } : {}),
    elo: user.elo,
    ...(fields.createdAt ? { created_at: user.createdAt } : {}),
  };
}

/**
 * Controlli condivisi con l'upgrade WebSocket, che in Node non attraversa i middleware express.
 * In Go la catena di `/ws` è: limiter generale → limiter ws → `WSAuth` (`api/router.go:30,62`).
 */
export interface RequestGate {
  allow(bucket: 'general' | 'auth' | 'ws', key: string): boolean;
  /** Chiave del rate limit: IP senza porta (`middleware/ratelimit.go:101`). */
  keyOf(headers: Record<string, string | string[] | undefined>, remoteAddress: string | undefined): string;
  /** `middleware/auth.go:21-49`: header Bearer, altrimenti `?token=`; solo access token (B3). */
  authenticate(authorization: string | undefined, queryToken: string | null): AccessClaims | ServerText;
  /** `WSAuth` (`middleware/wsticket.go:78-94`): con `?ticket=` consuma il ticket, altrimenti `authenticate`. */
  authenticateSocket(authorization: string | undefined, query: URLSearchParams): AccessClaims | ServerText;
}

export function createRequestGate(config: MockConfig, jwt: JwtService, tickets: TicketStore): RequestGate {
  const limits = config.rateLimits;
  const limiters =
    limits === false
      ? null
      : { general: createRateLimiter(limits.general), auth: createRateLimiter(limits.auth), ws: createRateLimiter(limits.ws) };

  function authenticate(authorization: string | undefined, queryToken: string | null): AccessClaims | ServerText {
    let token: string | null = null;
    if (authorization?.startsWith('Bearer ') === true) token = authorization.slice('Bearer '.length);
    else if (queryToken !== null && queryToken !== '') token = queryToken;
    if (token === null) return HTTP.tokenMissing;
    return jwt.verifyAccess(token) ?? HTTP.tokenInvalid;
  }

  return {
    allow: (bucket, key) => limiters === null || limiters[bucket].allow(key),
    keyOf: (headers, remoteAddress) => clientKey(headers, remoteAddress, config.trustedProxies),
    authenticate,
    authenticateSocket(authorization, query) {
      const ticket = query.get('ticket');
      if (ticket === null || ticket === '') return authenticate(authorization, query.get('token'));
      const claims = tickets.consume(ticket);
      if (claims === null || claims.username === undefined) return HTTP.ticketInvalid;
      return { ...claims, username: claims.username };
    },
  };
}

/** Rotte registrate, per distinguere 404 da 405 come `chi` (`api/router.go:33-34`). */
const ROUTES: readonly { readonly pattern: RegExp; readonly methods: readonly string[] }[] = [
  { pattern: /^\/status$/, methods: ['GET'] },
  { pattern: /^\/auth\/(register|login|refresh)$/, methods: ['POST'] },
  { pattern: /^\/auth\/password-policy$/, methods: ['GET'] },
  { pattern: /^\/leaderboard$/, methods: ['GET'] },
  { pattern: /^\/users\/[^/]+$/, methods: ['GET'] },
  { pattern: /^\/users\/[^/]+\/games$/, methods: ['GET'] },
  { pattern: /^\/spells$/, methods: ['GET'] },
  { pattern: /^\/me$/, methods: ['GET'] },
  { pattern: /^\/ws(\/ticket)?$/, methods: ['GET'] },
];

/** `AllowedOrigins` di default: `https://*`, `http://*`, `capacitor://localhost` (`config/config.go:74-75`). */
function isAllowedOrigin(origin: string): boolean {
  return /^https?:\/\/.+/.test(origin) || origin === 'capacitor://localhost';
}

export function createRestApp(deps: RestDeps, gate: RequestGate) {
  const { users, jwt, tickets } = deps;
  const app = express();
  app.disable('x-powered-by');
  app.disable('etag');
  const keyOf = (req: Request) => gate.keyOf(req.headers, req.socket.remoteAddress);

  // --- CORS: go-chi/cors (`api/router.go:20-29`) ----------------------------------------------------
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowed = origin !== undefined && isAllowedOrigin(origin);
    if (allowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS' && req.headers['access-control-request-method'] !== undefined) {
      if (allowed) {
        res.setHeader('Access-Control-Allow-Methods', req.headers['access-control-request-method']);
        res.setHeader('Access-Control-Allow-Headers', 'Accept, Authorization, Content-Type');
        res.setHeader('Access-Control-Max-Age', '300');
      }
      res.status(200).end();
      return;
    }
    next();
  });

  // --- Rate limit generale su tutte le rotte (`api/router.go:30`) ---------------------------------
  const limiter = (bucket: 'general' | 'auth') => (req: Request, res: Response, next: NextFunction) => {
    if (!gate.allow(bucket, keyOf(req))) return fail(res, 429, HTTP.tooManyRequests);
    next();
  };
  app.use(limiter('general'));

  function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
    const queryToken = typeof req.query['token'] === 'string' ? req.query['token'] : null;
    const outcome = gate.authenticate(req.headers.authorization, queryToken);
    if ('message' in outcome) return fail(res, 401, outcome);
    req.claims = outcome;
    next();
  }

  /** Il body JSON si decodifica a mano per replicare `json.NewDecoder(r.Body).Decode`. */
  const readJson = express.text({ type: () => true, limit: '64kb' });
  function decodeBody(req: Request): Record<string, unknown> | null {
    const raw: unknown = req.body;
    if (typeof raw !== 'string') return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  const str = (value: unknown) => (typeof value === 'string' ? value : '');

  // --- Pubbliche -----------------------------------------------------------------------------------
  app.get('/status', (_req, res) => ok(res, { status: 'ok', version: '0.1.0' })); // handlers/status.go

  // handlers/auth.go:18-87
  app.post('/auth/register', limiter('auth'), readJson, (req, res) => {
    const body = decodeBody(req);
    if (body === null) return fail(res, 400, HTTP.invalidBody);
    const [username, email, password] = [str(body['username']), str(body['email']), str(body['password'])];
    if (username === '' || email === '' || password === '') return fail(res, 400, HTTP.missingFields);
    const invalid = validateRegister(username, email, password);
    if (invalid !== null) return fail(res, 400, invalid);
    const user = users.insert(username, email, password);
    if (user === null) return fail(res, 409, HTTP.taken);
    ok(res, { user_id: user.id });
  });

  // handlers/auth.go:90-159
  app.post('/auth/login', limiter('auth'), readJson, (req, res) => {
    const body = decodeBody(req);
    if (body === null) return fail(res, 400, HTTP.invalidBody);
    const user = users.findByEmail(str(body['email']));
    if (user === undefined || !users.checkPassword(user, str(body['password']))) return fail(res, 401, HTTP.badCredentials);
    ok(res, {
      tokens: { access_token: jwt.issueAccess(user.id, user.username), refresh_token: jwt.issueRefresh(user.id) },
      user: userJson(user, { email: true, createdAt: false }),
    });
  });

  // handlers/auth.go:187-269, nel gruppo con il limiter auth (`api/router.go:44`)
  app.post('/auth/refresh', limiter('auth'), readJson, (req, res) => {
    const body = decodeBody(req);
    if (body === null) return fail(res, 400, HTTP.invalidBody);
    const claims = jwt.verify(str(body['refresh_token']));
    if (claims === null) return fail(res, 401, HTTP.refreshInvalid);
    if (claims.type !== 'refresh') return fail(res, 401, HTTP.notRefreshToken);
    const user = users.findById(claims.user_id);
    if (user === undefined) return fail(res, 401, HTTP.userNotFound);
    ok(res, { access_token: jwt.issueAccess(user.id, user.username), refresh_token: jwt.issueRefresh(user.id) });
  });

  // handlers/catalog.go:24-30
  app.get('/auth/password-policy', (_req, res) => ok(res, PASSWORD_POLICY));

  // handlers/stats.go:14-51: `[]` se vuota (B8)
  app.get('/leaderboard', (_req, res) => {
    ok(
      res,
      users.leaderboard().map((u, i) => ({ rank: i + 1, id: u.id, username: u.username, elo: u.elo })),
    );
  });

  // handlers/stats.go:111-161 (pubblica)
  app.get('/users/:id', (req, res) => {
    const id = Number(req.params['id']);
    if (!Number.isInteger(id)) return fail(res, 400, HTTP.invalidId);
    const user = users.findById(id);
    if (user === undefined) return fail(res, 404, HTTP.userNotFound);
    const s = users.statsOf(id);
    ok(res, { user: userJson(user, { email: false, createdAt: true }), stats: { ...s, total: s.wins + s.losses + s.draws } });
  });

  // handlers/catalog.go:13-20 + `spells.List` (`spells/spells.go:172-184`): per costo, poi per id
  app.get('/spells', (_req, res) => {
    ok(
      res,
      [...deps.catalog].sort((a, b) => a.mana_cost - b.mana_cost || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    );
  });

  // --- Protette ------------------------------------------------------------------------------------
  // handlers/auth.go:272-296
  app.get('/me', requireAuth, (req: AuthedRequest, res) => {
    const user = req.claims === undefined ? undefined : users.findById(req.claims.user_id);
    if (user === undefined) return fail(res, 500, HTTP.profileError);
    ok(res, userJson(user, { email: true, createdAt: true }));
  });

  // handlers/stats.go:54-108: `[]` se vuota (B8)
  app.get('/users/:id/games', requireAuth, (req, res) => {
    const id = Number(req.params['id']);
    if (!Number.isInteger(id)) return fail(res, 400, HTTP.invalidId);
    const name = (userId: number) => users.findById(userId)?.username ?? '';
    ok(
      res,
      users.gamesOf(id).map((g) => ({
        id: g.id,
        white: name(g.whiteId),
        black: name(g.blackId),
        result: g.result,
        time_control: g.timeControl,
        pgn: g.pgn,
        played_at: g.playedAt,
      })),
    );
  });

  // handlers/ws.go:23-42: ticket monouso per `/ws?ticket=`
  app.get('/ws/ticket', requireAuth, (req: AuthedRequest, res) => {
    if (req.claims === undefined) return fail(res, 500, HTTP.ticketGeneration);
    ok(res, { ticket: tickets.issue(req.claims), expires_in: Math.round(tickets.ttlMs / 1000) });
  });

  // --- Rotte inesistenti e metodi errati in JSON (`api/router.go:33-34`) -------------------------
  // Un GET /ws senza upgrade arriva qui: gorilla risponderebbe 400 dopo l'autenticazione, dettaglio non replicato.
  app.use((req, res) => {
    const known = ROUTES.find((route) => route.pattern.test(req.path));
    if (known !== undefined && !known.methods.includes(req.method)) return fail(res, 405, HTTP.methodNotAllowed);
    fail(res, 404, HTTP.notFound);
  });

  return app;
}
