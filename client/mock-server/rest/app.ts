import express, { type NextFunction, type Request, type Response } from 'express';

import type { JwtClaims, JwtService } from '../auth/jwt';
import type { MockConfig } from '../config';
import { HTTP, type ServerText } from '../serverTexts';
import { validateRegister, type User, type UserStore } from '../store/users';
import { clientKey, createRateLimiter } from './rateLimit';

/**
 * Porting di `api/router.go` e degli handler REST di chess-server.
 * Inviluppo `{success, data?, error?}` (`models/response.go:5-9`).
 */

export interface RestDeps {
  readonly config: MockConfig;
  readonly users: UserStore;
  readonly jwt: JwtService;
  readonly catalog: unknown;
}

type AuthedRequest = Request & { claims?: JwtClaims };

function keyOf(req: Request): string {
  return clientKey(req.headers, req.socket.remoteAddress, req.socket.remotePort);
}

function ok(res: Response, data: unknown, status = 200): void {
  // `omitempty` su un'interfaccia che contiene una slice nil produce `"data": null` (B8).
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
 * In Go la catena di `/ws` è: limiter generale → Auth → limiter ws (`api/router.go:27,46,51`).
 */
export interface RequestGate {
  allow(bucket: 'general' | 'auth' | 'ws', key: string): boolean;
  /** `middleware/auth.go:21-63`: header Bearer, altrimenti `?token=`. Nessun controllo su `type` (B3). */
  authenticate(authorization: string | undefined, queryToken: string | null): JwtClaims | ServerText;
}

export function createRequestGate(config: MockConfig, jwt: JwtService): RequestGate {
  const limits = config.rateLimits;
  const limiters =
    limits === false
      ? null
      : { general: createRateLimiter(limits.general), auth: createRateLimiter(limits.auth), ws: createRateLimiter(limits.ws) };
  return {
    allow: (bucket, key) => limiters === null || limiters[bucket].allow(key),
    authenticate(authorization, queryToken) {
      let token: string | null = null;
      if (authorization?.startsWith('Bearer ') === true) token = authorization.slice('Bearer '.length);
      else if (queryToken !== null && queryToken !== '') token = queryToken;
      if (token === null) return HTTP.tokenMissing;
      return jwt.verify(token) ?? HTTP.tokenInvalid;
    },
  };
}

export function createRestApp(deps: RestDeps, gate: RequestGate) {
  const { config, users, jwt } = deps;
  const app = express();
  app.disable('x-powered-by');
  app.disable('etag');

  // --- CORS: go-chi/cors con AllowedOrigins `http://*`, `https://*` (`api/router.go:18-26`) ---------
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowed = origin !== undefined && /^https?:\/\/.+/.test(origin);
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

  // --- Rate limit generale su tutte le rotte (`api/router.go:27`) ---------------------------------
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

  app.get('/leaderboard', (_req, res) => {
    const top = users.leaderboard();
    ok(res, top.length === 0 ? null : top.map((u, i) => ({ rank: i + 1, id: u.id, username: u.username, elo: u.elo })));
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

  // handlers/auth.go:187-269 (niente limiter auth: B12)
  app.post('/auth/refresh', readJson, (req, res) => {
    const body = decodeBody(req);
    if (body === null) return fail(res, 400, HTTP.invalidBody);
    const claims = jwt.verify(str(body['refresh_token']));
    if (claims === null) return fail(res, 401, HTTP.refreshInvalid);
    if (claims.type !== 'refresh') return fail(res, 401, HTTP.notRefreshToken);
    const user = users.findById(claims.user_id);
    if (user === undefined) return fail(res, 401, HTTP.userNotFound);
    ok(res, { access_token: jwt.issueAccess(user.id, user.username), refresh_token: jwt.issueRefresh(user.id) });
  });

  // P1-1: esiste solo nel contratto `proposed`.
  if (config.contract === 'proposed') app.get('/spells', (_req, res) => ok(res, deps.catalog));

  // --- Protette ------------------------------------------------------------------------------------
  // handlers/auth.go:272-296
  app.get('/me', requireAuth, (req: AuthedRequest, res) => {
    const user = req.claims === undefined ? undefined : users.findById(req.claims.user_id);
    if (user === undefined) return fail(res, 500, HTTP.profileError);
    ok(res, userJson(user, { email: true, createdAt: true }));
  });

  // handlers/stats.go:54-108
  app.get('/users/:id/games', requireAuth, (req, res) => {
    const id = Number(req.params['id']);
    if (!Number.isInteger(id)) return fail(res, 400, HTTP.invalidId);
    const rows = users.gamesOf(id);
    const name = (userId: number) => users.findById(userId)?.username ?? '';
    ok(
      res,
      rows.length === 0
        ? null
        : rows.map((g) => ({
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

  // --- Default di chi: 404 in testo semplice (B12) -------------------------------------------------
  app.use((_req, res) => {
    res.status(404).type('text/plain').send('404 page not found\n');
  });

  return app;
}
