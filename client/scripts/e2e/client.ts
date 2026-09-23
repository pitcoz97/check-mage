import { Chess } from 'chess.js';

import {
  encodeLogin,
  encodeRefresh,
  encodeRegister,
  interpretHttpResponse,
  normalizeAccount,
  normalizeGameHistory,
  normalizeLogin,
  normalizePublicProfile,
  normalizeRegistration,
  normalizeSpellCatalog,
  normalizeTokenPair,
  normalizeWsTicket,
  type AdapterWarning,
  type Normalized,
} from '../../src/api/adapter';
import type { GameHistoryEntry, PublicProfile, TokenPair, UserAccount } from '../../src/api/types';
import type { Color, HandCard, Phase, PublicGameState, Square } from '../../src/game/model';
import { createLogger } from '../../src/lib/log';
import fallbackCatalog from '../../src/spells/fallback.json';
import type { Spell } from '../../src/spells/schema';
import { createMatchStore, type GameOutcome, type MatchState, type MatchStoreState } from '../../src/store/matchStore';
import { createConnection, type Connection, type ConnectionStatus } from '../../src/ws/connection';
import { routeFrame } from '../../src/ws/dispatch';
import type { ClientIntent, DecodeFailure, ServerEvent } from '../../src/ws/protocol';
import type { StoreApi } from 'zustand/vanilla';

/**
 * Client di prova per lo script e2e. Usa lo stack vero del client: REST tramite `src/api/adapter.ts`, WebSocket
 * tramite `src/ws/connection.ts` (ticket, riconnessione, heartbeat), `src/ws/dispatch.ts` e il reducer di
 * `src/store/matchStore.ts`. Così ogni scenario del mock è anche una sequenza di eventi per il reducer.
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const silent = createLogger(() => undefined);

/**
 * Rispetta i limiti per IP invece di farsi rifiutare: auth 3/s (burst 5) e, contro un server vero, l'upgrade del
 * WebSocket, che è **1/s con burst 3** (`middleware/ratelimit.go:158`). Il quarto handshake ravvicinato riceve 429.
 * Contro il mock la distanza fra gli upgrade è zero: i suoi limiti sono rilassati apposta.
 */
export function createPacer(options: { wsSpacingMs?: number } = {}) {
  const wsSpacing = options.wsSpacingMs ?? 0;
  let lastAuth = 0;
  let lastWs = 0;
  return {
    auth: async () => {
      const delta = Date.now() - lastAuth;
      if (delta < 400) await sleep(400 - delta);
      lastAuth = Date.now();
    },
    ws: async () => {
      if (wsSpacing === 0) return;
      const delta = Date.now() - lastWs;
      if (delta < wsSpacing) await sleep(wsSpacing - delta);
      lastWs = Date.now();
    },
  };
}
export type Pacer = ReturnType<typeof createPacer>;

/**
 * Fotografia dello stato accumulato dal reducer, confrontabile con quella ricostruita dal server al rientro.
 * Esclusi gli orologi (scorrono), i turni residui degli effetti e la dimensione del mazzo **avversario**: il server
 * li aggiorna al cambio di turno senza comunicarlo, perché lì non manda `game_state` (ASSUMPTIONS C13 e C15,
 * BACKEND-REQUESTS P2-14). Il proprio mazzo invece arriva in `card_drawn` e resta esatto.
 */
function snapshotOf(state: MatchState) {
  const game = state.game;
  return {
    color: state.myColor,
    hand: state.hand.map((c) => c.spellId).sort(),
    myDeckSize: state.myDeckSize,
    phase: game?.phase,
    activePlayer: game?.activePlayer,
    turnNumber: game?.turnNumber,
    fen: game?.fen,
    moves: game?.moves,
    mana: game?.mana,
    handSizes: game?.handSizes,
    effects: [...(game?.activeEffects ?? [])]
      .map((e) => ({ square: e.square, kinds: e.effects.map((x) => `${x.kind}:${String(x.sourceSpellId)}`).sort() }))
      .sort((a, b) => a.square.localeCompare(b.square)),
  };
}

export class E2EClient {
  tokens: TokenPair | null = null;
  account: UserAccount | null = null;
  readonly events: ServerEvent[] = [];
  readonly failures: DecodeFailure[] = [];
  readonly warnings: AdapterWarning[] = [];
  readonly problems: string[] = [];
  /** Stati della connessione attraversati, in ordine. */
  readonly statusHistory: ConnectionStatus['kind'][] = [];

  private store: StoreApi<MatchStoreState> | null = null;
  private connection: Connection | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    readonly httpUrl: string,
    readonly wsUrl: string,
    readonly username: string,
    readonly email: string,
    private readonly pacer: Pacer,
  ) {}

  // --- REST ----------------------------------------------------------------------------------------

  private async request(method: 'GET' | 'POST', path: string, body?: string) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.tokens !== null) headers['Authorization'] = `Bearer ${this.tokens.accessToken}`;
    const res = await fetch(`${this.httpUrl}${path}`, body === undefined ? { method, headers } : { method, headers, body });
    const outcome = interpretHttpResponse(res.status, await res.text());
    this.warnings.push(...outcome.warnings);
    return outcome;
  }

  /**
   * Richiesta grezza, senza passare dall'adapter: serve ai controlli sull'involucro delle risposte, su 404/405 e
   * su header di autorizzazione diversi da quello della sessione (`authorization: null` = nessun header).
   */
  async raw(
    method: 'GET' | 'POST',
    path: string,
    options: { body?: string; authorization?: string | null } = {},
  ): Promise<{ status: number; body: string }> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = options.authorization === undefined ? (this.tokens?.accessToken ?? null) : options.authorization;
    if (token !== null && token !== '') headers['Authorization'] = `Bearer ${token}`;
    const init = options.body === undefined ? { method, headers } : { method, headers, body: options.body };
    const res = await fetch(`${this.httpUrl}${path}`, init);
    return { status: res.status, body: await res.text() };
  }

  private unwrap<T>(label: string, normalized: Normalized<T>): T {
    if (!normalized.ok) throw new Error(`${label}: ${normalized.issues.join('; ')}`);
    this.warnings.push(...normalized.warnings);
    return normalized.value;
  }

  async register(password: string): Promise<void> {
    await this.pacer.auth();
    const res = await this.request('POST', '/auth/register', encodeRegister(this.username, this.email, password));
    if (res.ok) this.unwrap('register', normalizeRegistration(res.data));
    else if (res.error.code !== 'username_or_email_taken') throw new Error(`register: ${JSON.stringify(res.error)}`);
  }

  async login(password: string): Promise<void> {
    await this.pacer.auth();
    const res = await this.request('POST', '/auth/login', encodeLogin(this.email, password));
    if (!res.ok) throw new Error(`login: ${JSON.stringify(res.error)}`);
    const session = this.unwrap('login', normalizeLogin(res.data));
    this.tokens = session.tokens;
    this.account = session.user;
  }

  async refresh(): Promise<void> {
    if (this.tokens === null) throw new Error('refresh senza sessione');
    await this.pacer.auth();
    const res = await this.request('POST', '/auth/refresh', encodeRefresh(this.tokens.refreshToken));
    if (!res.ok) throw new Error(`refresh: ${JSON.stringify(res.error)}`);
    this.tokens = this.unwrap('refresh', normalizeTokenPair(res.data));
  }

  async me(): Promise<UserAccount> {
    const res = await this.request('GET', '/me');
    if (!res.ok) throw new Error(`/me: ${JSON.stringify(res.error)}`);
    return this.unwrap('/me', normalizeAccount(res.data));
  }

  async profile(id: string): Promise<PublicProfile> {
    const res = await this.request('GET', `/users/${id}`);
    if (!res.ok) throw new Error(`/users: ${JSON.stringify(res.error)}`);
    return this.unwrap('/users', normalizePublicProfile(res.data));
  }

  async games(id: string): Promise<readonly GameHistoryEntry[]> {
    const res = await this.request('GET', `/users/${id}/games`);
    if (!res.ok) throw new Error(`/games: ${JSON.stringify(res.error)}`);
    return this.unwrap('/games', normalizeGameHistory(res.data));
  }

  /** `/spells`; il fallback locale solo se il server non risponde (ASSUMPTIONS G10). */
  async catalog(): Promise<{ spells: readonly Spell[]; source: 'server' | 'fallback' }> {
    const res = await this.request('GET', '/spells');
    const normalized = normalizeSpellCatalog(res.ok ? res.data : fallbackCatalog);
    this.warnings.push(...normalized.warnings);
    return { spells: normalized.spells, source: res.ok ? 'server' : 'fallback' };
  }

  // --- WebSocket: lo stack del client --------------------------------------------------------------

  /** Stesso utente, stessa sessione, connessione distinta: come una seconda scheda del browser. */
  twin(): E2EClient {
    const other = new E2EClient(this.httpUrl, this.wsUrl, this.username, this.email, this.pacer);
    other.tokens = this.tokens;
    other.account = this.account;
    return other;
  }

  private matchState(): MatchStoreState | null {
    return this.store?.getState() ?? null;
  }

  /** Apre (o riapre) la connessione e attende che il socket sia aperto. `scenario` vale solo alla prima apertura. */
  async connect(scenario?: string): Promise<void> {
    if (this.tokens === null || this.account === null) throw new Error('connect senza sessione');
    if (this.store === null) {
      this.store = createMatchStore(this.account.id);
      this.store.subscribe(() => this.notify());
    }
    if (this.connection === null) {
      const store = this.store;
      this.connection = createConnection({
        wsBaseUrl: this.wsUrl,
        tickets: {
          fetchWsTicket: async () => {
            const res = await this.request('GET', '/ws/ticket');
            if (!res.ok) return { ok: false, error: res.error };
            const ticket = normalizeWsTicket(res.data);
            return ticket.ok ? { ok: true, value: ticket.value } : { ok: false, error: { status: 200, code: 'invalid_response' } };
          },
        },
        onFrame: (raw) => this.onFrame(raw, store),
        log: silent,
        ...(scenario === undefined ? {} : { extraParams: { scenario } }),
      });
      this.connection.subscribe((status) => {
        this.statusHistory.push(status.kind);
        // In partita il silenzio vuol dire socket morto (C10), come nella sessione del client.
        this.connection?.expectTraffic(store.getState().lifecycle === 'playing');
        this.notify();
      });
      store.subscribe((next, previous) => {
        if (next.lifecycle !== previous.lifecycle) this.connection?.expectTraffic(next.lifecycle === 'playing');
      });
    }
    await this.pacer.ws();
    this.connection.open();
    await this.until(() => this.connected, 'apertura del socket');
  }

  /** Chiusura voluta della connessione (il server vede una disconnessione). */
  async disconnect(): Promise<void> {
    this.connection?.close();
    await sleep(50);
  }

  private onFrame(raw: string, store: StoreApi<MatchStoreState>): void {
    try {
      const result = routeFrame(raw, { dispatch: (event) => this.record(event, store) }, silent);
      if (result.ok) this.warnings.push(...result.warnings);
      else this.failures.push(result.failure);
    } catch (error) {
      this.problems.push(`dispatch o reducer hanno lanciato un'eccezione: ${String(error)}`);
    }
  }

  private record(event: ServerEvent, store: StoreApi<MatchStoreState>): void {
    this.events.push(event);
    store.getState().dispatch(event);
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }

  /** Invia tramite la connessione (che distanzia gli invii). Restituisce l'indice da cui attendere la risposta. */
  send(intent: ClientIntent): number {
    if (this.connection === null || !this.connection.send(intent)) throw new Error(`${this.username}: socket non aperto per ${intent.type}`);
    return this.events.length;
  }

  // --- Stato letto dal reducer ---------------------------------------------------------------------

  get state(): PublicGameState | null {
    return this.matchState()?.game ?? null;
  }
  get hand(): readonly HandCard[] {
    return this.matchState()?.hand ?? [];
  }
  get phase(): Phase | 'unknown' | null {
    return this.state?.phase ?? null;
  }
  get activePlayer(): Color | 'unknown' | null {
    return this.state?.activePlayer ?? null;
  }
  /** Da `white_player`/`black_player` confrontati con l'id dell'account, nel reducer. */
  get color(): Color | null {
    return this.matchState()?.myColor ?? null;
  }
  get gameOver(): GameOutcome | null {
    return this.matchState()?.outcome ?? null;
  }
  get connected(): boolean {
    return this.connection?.getStatus().kind === 'open';
  }
  get replaced(): boolean {
    return this.connection?.getStatus().kind === 'replaced';
  }
  get isMyTurn(): boolean {
    return this.color !== null && this.activePlayer === this.color;
  }
  get myMana(): number {
    return this.color === null ? 0 : (this.state?.mana[this.color].current ?? 0);
  }

  /**
   * Controllo del reducer sulle sequenze reali: lo stato accumulato evento per evento deve coincidere con quello che
   * il server ricostruisce al rientro (`game_state` + `hand`). Restituisce le differenze trovate.
   */
  async verifySnapshot(): Promise<string[]> {
    await sleep(300); // quiete: nessun evento in volo
    const store = this.store;
    if (store === null) return ['nessuna partita'];
    const before = snapshotOf(store.getState());
    await this.disconnect();
    const from = this.events.length;
    await this.connect();
    await this.event(from, isType('hand'), 'hand al rientro');
    const after = snapshotOf(store.getState());
    return (Object.keys(before) as (keyof typeof before)[])
      .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
      .map((key) => `${key}: reducer ${JSON.stringify(before[key])} ≠ server ${JSON.stringify(after[key])}`);
  }

  /** Prima mossa legale non tentata e non bloccata da un congelamento (lo stato degli effetti arriva dal server). */
  pickMove(avoid: ReadonlySet<string>): string | null {
    if (this.state === null) return null;
    const frozen = new Set<Square>(
      this.state.activeEffects.filter((s) => s.effects.some((e) => e.kind === 'freeze')).map((s) => s.square),
    );
    const move = new Chess(this.state.fen, { skipValidation: true })
      .moves({ verbose: true })
      .find((m) => !avoid.has(m.lan) && !frozen.has(m.from as Square));
    return move?.lan ?? null;
  }

  until(predicate: () => boolean, label: string, timeoutMs = 15_000): Promise<void> {
    if (predicate()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        const recent = this.events
          .filter((e) => e.type !== 'timer_update')
          .slice(-12)
          .map((e) => (e.type === 'error' ? `error(${String(e.error.code)})` : e.type === 'phase_changed' ? `phase(${e.phase},${e.activePlayer})` : e.type))
          .join(' ');
        reject(
          new Error(
            `${this.username}: timeout in attesa di "${label}" — fase ${String(this.phase)}, attivo ${String(this.activePlayer)}, colore ${String(this.color)}, connessione ${String(this.connection?.getStatus().kind)}, ultimi eventi: ${recent}`,
          ),
        );
      }, timeoutMs);
      const listener = () => {
        if (!predicate()) return;
        clearTimeout(timer);
        this.listeners.delete(listener);
        resolve();
      };
      this.listeners.add(listener);
    });
  }

  async event<T extends ServerEvent>(from: number, predicate: (e: ServerEvent) => e is T, label: string, timeoutMs = 15_000): Promise<T> {
    let found: T | undefined;
    await this.until(
      () => {
        found = this.events.slice(from).find(predicate);
        return found !== undefined;
      },
      label,
      timeoutMs,
    );
    if (found === undefined) throw new Error(label);
    return found;
  }
}

export function isType<K extends ServerEvent['type']>(type: K) {
  return (e: ServerEvent): e is Extract<ServerEvent, { type: K }> => e.type === type;
}
