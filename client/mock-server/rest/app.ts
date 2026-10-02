import express, { type NextFunction, type Request, type Response } from 'express';

import type { AccessClaims, JwtService } from '../auth/jwt';
import type { TicketStore } from '../auth/tickets';
import type { MockConfig } from '../config';
import { HTTP, type ServerText } from '../serverTexts';
import type { ChallengePlayer, ChallengeStore } from '../store/challenges';
import type { CollectionSpell, CollectionStore } from '../store/collection';
import type { DeckResult, DeckStore } from '../store/decks';
import type { PresenceStore } from '../store/presence';
import { PASSWORD_POLICY, validateRegister, type User, type UserStore } from '../store/users';
import type { FriendsApi, Outcome } from './friends';
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
  readonly catalog: readonly CollectionSpell[];
  readonly collections: CollectionStore;
  readonly decks: DeckStore;
  readonly presence: PresenceStore;
  readonly challenges: ChallengeStore;
  /** Chi è in partita: lo sa il gateway (`GameManager.InMatch`, `PlayingIDs`). */
  readonly matches: { inMatch(userId: number): boolean; playingIds(): number[] };
  /** Amicizie, richieste, ricerca e blocchi (`rest/friends.ts`). */
  readonly friendsApi: FriendsApi;
}

type AuthedRequest = Request & { claims?: AccessClaims };

function ok(res: Response, data: unknown, status = 200): void {
  res.status(status).json({ success: true, data });
}

function fail(res: Response, status: number, text: ServerText): void {
  res.status(status).json({ success: false, error: text.message });
}

/** `handlers.TermsVersion` (P2): la versione corrente di Informativa e Termini. */
export const TERMS_VERSION = 1;

/** L'account come in `GET /me` e nel login (`accountView`, `handlers/privacy.go`). */
function accountJson(user: User) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    elo: user.elo,
    created_at: user.createdAt,
    terms_version: user.termsVersion,
    terms_current: TERMS_VERSION,
    ...(user.termsAcceptedAt === null ? {} : { terms_accepted_at: user.termsAcceptedAt }),
    hide_presence: user.hidePresence,
  };
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
  { pattern: /^\/me$/, methods: ['GET', 'DELETE'] },
  { pattern: /^\/me\/(terms|privacy|export)$/, methods: ['GET', 'POST', 'PUT'] },
  { pattern: /^\/me\/collection$/, methods: ['GET'] },
  { pattern: /^\/me\/decks$/, methods: ['GET', 'POST'] },
  { pattern: /^\/me\/decks\/[^/]+$/, methods: ['PUT', 'DELETE'] },
  { pattern: /^\/me\/decks\/[^/]+\/activate$/, methods: ['POST'] },
  { pattern: /^\/me\/friends$/, methods: ['GET'] },
  { pattern: /^\/me\/friends\/requests$/, methods: ['POST'] },
  { pattern: /^\/me\/friends\/requests\/[^/]+$/, methods: ['DELETE'] },
  { pattern: /^\/me\/friends\/requests\/[^/]+\/accept$/, methods: ['POST'] },
  { pattern: /^\/me\/friends\/[^/]+$/, methods: ['DELETE'] },
  { pattern: /^\/me\/blocks$/, methods: ['GET', 'POST'] },
  { pattern: /^\/me\/blocks\/[^/]+$/, methods: ['DELETE'] },
  { pattern: /^\/me\/presence$/, methods: ['POST'] },
  { pattern: /^\/me\/challenges$/, methods: ['POST'] },
  { pattern: /^\/me\/challenges\/[^/]+$/, methods: ['DELETE'] },
  { pattern: /^\/ws(\/ticket)?$/, methods: ['GET'] },
];

/** `AllowedOrigins` di default: `https://*`, `http://*`, `capacitor://localhost` (`config/config.go:74-75`). */
function isAllowedOrigin(origin: string): boolean {
  return /^https?:\/\/.+/.test(origin) || origin === 'capacitor://localhost';
}

export function createRestApp(deps: RestDeps, gate: RequestGate) {
  const { users, jwt, tickets } = deps;
  const { collections, decks, presence, challenges, matches, friendsApi } = deps;
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
    // Consenso: termini accettati e almeno 14 anni (P1).
    if (body['accept_terms'] !== true || body['age_confirmed'] !== true) return fail(res, 400, HTTP.consentRequired);
    const invalid = validateRegister(username, email, password);
    if (invalid !== null) return fail(res, 400, invalid);
    const user = users.insert(username, email, password, TERMS_VERSION);
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
      user: accountJson(user),
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

  /** Risposta di un'operazione delle amicizie (`rest/friends.ts`). */
  const answer = (res: Response, outcome: Outcome) => (outcome.ok ? ok(res, outcome.data, outcome.status) : fail(res, outcome.status, outcome.error));
  const pathUser = (req: Request) => (/^\d+$/.test(String(req.params['id'])) ? Number(req.params['id']) : 0);

  // handlers/friendships.go: ricerca per nome (A5). Prima di `/users/:id`, come la rotta statica di chi.
  app.get('/users/search', requireAuth, (req: AuthedRequest, res) => {
    if (req.claims === undefined) return fail(res, 500, HTTP.dbError);
    answer(res, friendsApi.search(req.claims.user_id, req.query['q']));
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
    if (user === undefined) return fail(res, 404, HTTP.accountAbsent);
    ok(res, accountJson(user));
  });

  // handlers/privacy.go (P2): riaccettazione della versione corrente
  app.post('/me/terms', requireAuth, readJson, (req: AuthedRequest, res) => {
    const user = req.claims === undefined ? undefined : users.findById(req.claims.user_id);
    if (user === undefined) return fail(res, 404, HTTP.accountAbsent);
    const body = decodeBody(req);
    if (body === null) return fail(res, 400, HTTP.invalidBody);
    if (body['version'] !== TERMS_VERSION) return fail(res, 409, HTTP.termsVersion);
    user.termsVersion = TERMS_VERSION;
    user.termsAcceptedAt = new Date().toISOString();
    ok(res, accountJson(user));
  });

  // handlers/privacy.go (P6): stato online nascosto
  app.put('/me/privacy', requireAuth, readJson, (req: AuthedRequest, res) => {
    const user = req.claims === undefined ? undefined : users.findById(req.claims.user_id);
    if (user === undefined) return fail(res, 404, HTTP.accountAbsent);
    const hide = decodeBody(req)?.['hide_presence'];
    if (typeof hide !== 'boolean') return fail(res, 400, HTTP.invalidBody);
    user.hidePresence = hide;
    ok(res, accountJson(user));
  });

  // handlers/privacy.go (P3): cancellazione dell'account, con la password e fuori dalle partite
  app.delete('/me', requireAuth, readJson, (req: AuthedRequest, res) => {
    const user = req.claims === undefined ? undefined : users.findById(req.claims.user_id);
    if (user === undefined) return fail(res, 404, HTTP.accountAbsent);
    const password = decodeBody(req)?.['password'];
    if (typeof password !== 'string' || password === '') return fail(res, 400, HTTP.invalidBody);
    if (!users.checkPassword(user, password)) return fail(res, 403, HTTP.wrongPassword);
    if (matches.inMatch(user.id)) return fail(res, 409, HTTP.challengeSelfBusy);
    decks.removeUser(user.id);
    collections.removeUser(user.id);
    friendsApi.forgetUser(user.id);
    challenges.closeOf(user.id);
    presence.forget(user.id);
    users.anonymize(user.id);
    res.status(200).json({ success: true });
  });

  // handlers/privacy.go (P5): tutti i dati dell'utente
  app.get('/me/export', requireAuth, (req: AuthedRequest, res) => {
    const user = req.claims === undefined ? undefined : users.findById(req.claims.user_id);
    if (user === undefined) return fail(res, 404, HTTP.accountAbsent);
    const saved = collections.saved(user.id);
    const deckList = decks.list(user.id);
    const name = (id: number) => users.findAny(id)?.username ?? '';
    ok(res, {
      exported_at: new Date().toISOString(),
      account: accountJson(user),
      collection: [...saved].filter(([, copies]) => copies > 0).map(([spell_id, copies]) => ({ spell_id, copies })),
      decks: deckList.ok ? deckList.data.decks : [],
      games: users.allGamesOf(user.id).map((g) => ({
        id: g.id,
        white: name(g.whiteId),
        black: name(g.blackId),
        result: g.result,
        time_control: g.timeControl,
        pgn: g.pgn,
        played_at: g.playedAt,
        rated: g.rated,
      })),
      friends: { ...friendsApi.list(user.id), others: [] },
      blocked: friendsApi.blockList(user.id),
    });
  });

  // handlers/collection.go: set iniziale alla prima lettura (db/collection.go)
  app.get('/me/collection', requireAuth, (req: AuthedRequest, res) => {
    if (req.claims === undefined) return fail(res, 500, HTTP.collectionError);
    ok(res, collections.load(req.claims.user_id));
  });

  // handlers/decks.go (D1–D6)
  const reply = <T>(res: Response, result: DeckResult<T>) => (result.ok ? ok(res, result.data, result.status) : fail(res, result.status, result.error));
  const deckId = (req: Request) => (/^-?\d+$/.test(String(req.params['id'])) ? Number(req.params['id']) : Number.NaN);
  app.get('/me/decks', requireAuth, (req: AuthedRequest, res) => {
    if (req.claims === undefined) return fail(res, 500, HTTP.dbError);
    reply(res, decks.list(req.claims.user_id));
  });
  app.post('/me/decks', requireAuth, readJson, (req: AuthedRequest, res) => {
    if (req.claims === undefined) return fail(res, 500, HTTP.dbError);
    reply(res, decks.create(req.claims.user_id, decodeBody(req)));
  });
  app.put('/me/decks/:id', requireAuth, readJson, (req: AuthedRequest, res) => {
    if (req.claims === undefined) return fail(res, 500, HTTP.dbError);
    const id = deckId(req);
    if (Number.isNaN(id)) return fail(res, 404, HTTP.deckNotFound);
    reply(res, decks.update(req.claims.user_id, id, decodeBody(req)));
  });
  app.delete('/me/decks/:id', requireAuth, (req: AuthedRequest, res) => {
    if (req.claims === undefined) return fail(res, 500, HTTP.dbError);
    const id = deckId(req);
    if (Number.isNaN(id)) return fail(res, 404, HTTP.deckNotFound);
    reply(res, decks.remove(req.claims.user_id, id));
  });
  app.post('/me/decks/:id/activate', requireAuth, (req: AuthedRequest, res) => {
    if (req.claims === undefined) return fail(res, 500, HTTP.dbError);
    const id = deckId(req);
    if (Number.isNaN(id)) return fail(res, 404, HTTP.deckNotFound);
    reply(res, decks.activate(req.claims.user_id, id));
  });

  // handlers/friends.go e friendships.go (F1–F3, A1–A10): amici veri, altri giocatori (con `allFriends`), richieste
  app.get('/me/friends', requireAuth, (req: AuthedRequest, res) => {
    if (req.claims === undefined) return fail(res, 500, HTTP.dbError);
    answer(res, friendsApi.listed(req.claims.user_id));
  });
  app.post('/me/friends/requests', requireAuth, readJson, (req: AuthedRequest, res) => {
    if (req.claims === undefined) return fail(res, 500, HTTP.dbError);
    answer(res, friendsApi.request(req.claims.user_id, decodeBody(req)?.['to']));
  });
  app.post('/me/friends/requests/:id/accept', requireAuth, (req: AuthedRequest, res) => {
    if (req.claims === undefined) return fail(res, 500, HTTP.dbError);
    answer(res, friendsApi.accept(req.claims.user_id, pathUser(req)));
  });
  app.delete('/me/friends/requests/:id', requireAuth, (req: AuthedRequest, res) => {
    if (req.claims === undefined) return fail(res, 500, HTTP.dbError);
    answer(res, friendsApi.deleteLink(req.claims.user_id, pathUser(req), 'pending'));
  });
  app.delete('/me/friends/:id', requireAuth, (req: AuthedRequest, res) => {
    if (req.claims === undefined) return fail(res, 500, HTTP.dbError);
    answer(res, friendsApi.deleteLink(req.claims.user_id, pathUser(req), 'accepted'));
  });
  app.get('/me/blocks', requireAuth, (req: AuthedRequest, res) => {
    if (req.claims === undefined) return fail(res, 500, HTTP.dbError);
    answer(res, friendsApi.blocks(req.claims.user_id));
  });
  app.post('/me/blocks', requireAuth, readJson, (req: AuthedRequest, res) => {
    if (req.claims === undefined) return fail(res, 500, HTTP.dbError);
    answer(res, friendsApi.block(req.claims.user_id, decodeBody(req)?.['user_id']));
  });
  app.delete('/me/blocks/:id', requireAuth, (req: AuthedRequest, res) => {
    if (req.claims === undefined) return fail(res, 500, HTTP.dbError);
    answer(res, friendsApi.unblock(req.claims.user_id, pathUser(req)));
  });

  // handlers/challenges.go: il segnale di presenza porta le sfide ricevute (F2)
  app.post('/me/presence', requireAuth, (req: AuthedRequest, res) => {
    if (req.claims === undefined) return fail(res, 500, HTTP.dbError);
    presence.touch(req.claims.user_id);
    ok(res, { incoming: challenges.incoming(req.claims.user_id), friend_requests: friendsApi.incomingCount(req.claims.user_id) });
  });

  const player = (u: User): ChallengePlayer => ({ id: u.id, username: u.username, elo: u.elo });
  app.post('/me/challenges', requireAuth, readJson, (req: AuthedRequest, res) => {
    if (req.claims === undefined) return fail(res, 500, HTTP.dbError);
    const self = req.claims.user_id;
    const body = decodeBody(req);
    const to = body?.['to'];
    if (typeof to !== 'number' || !Number.isInteger(to) || to <= 0) return fail(res, 400, HTTP.invalidBody);
    if (to === self) return fail(res, 400, HTTP.challengeSelf);
    if (!friendsApi.isFriend(self, to)) return fail(res, 404, HTTP.challengeNoPlayer);
    const target = users.findById(to);
    if (target === undefined) return fail(res, 404, HTTP.challengeNoPlayer);
    const me = users.findById(self);
    if (me === undefined) return fail(res, 500, HTTP.dbError);
    if (matches.inMatch(self)) return fail(res, 409, HTTP.challengeSelfBusy);
    // Stato nascosto (P6): appare offline, anche se è in partita.
    if (target.hidePresence) return fail(res, 409, HTTP.challengeOffline);
    if (matches.inMatch(to)) return fail(res, 409, HTTP.challengeTargetBusy);
    if (!presence.online(to)) return fail(res, 409, HTTP.challengeOffline);
    const ch = challenges.create(player(me), player(target));
    presence.touch(self);
    ok(res, challenges.view(ch), 201);
  });

  // Chi sfida annulla, lo sfidato rifiuta (F6)
  app.delete('/me/challenges/:id', requireAuth, (req: AuthedRequest, res) => {
    if (req.claims === undefined) return fail(res, 500, HTTP.dbError);
    const ch = challenges.get(String(req.params['id']));
    const self = req.claims.user_id;
    if (ch === undefined || (self !== ch.from.id && self !== ch.to.id)) return fail(res, 404, HTTP.challengeNotFound);
    challenges.close(ch, self === ch.from.id ? 'challenge_unavailable' : 'challenge_declined');
    res.status(200).json({ success: true });
  });

  // handlers/stats.go:54-108: `[]` se vuota (B8)
  app.get('/users/:id/games', requireAuth, (req, res) => {
    const id = Number(req.params['id']);
    if (!Number.isInteger(id)) return fail(res, 400, HTTP.invalidId);
    const name = (userId: number) => users.findAny(userId)?.username ?? '';
    const deleted = (userId: number) => users.findAny(userId)?.deleted === true;
    ok(
      res,
      users.gamesOf(id).map((g) => ({
        id: g.id,
        white_id: g.whiteId,
        black_id: g.blackId,
        white: name(g.whiteId),
        black: name(g.blackId),
        result: g.result,
        time_control: g.timeControl,
        pgn: g.pgn,
        played_at: g.playedAt,
        rated: g.rated,
        white_deleted: deleted(g.whiteId),
        black_deleted: deleted(g.blackId),
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
