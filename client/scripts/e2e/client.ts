import { Chess } from 'chess.js';
import { WebSocket } from 'ws';

import {
  decodeServerMessage,
  encodeClientIntent,
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
import fallbackCatalog from '../../src/spells/fallback.json';
import type { Spell } from '../../src/spells/schema';
import { resolveSocketUrl } from '../../src/ws/connection';
import type { ClientIntent, DecodeFailure, ServerEvent } from '../../src/ws/protocol';

/**
 * Client di prova per lo script e2e. Parla col mock SOLO attraverso `src/api/adapter.ts` e
 * `src/ws/connection.ts`: se il mock (porting di chess-server) e l'adapter divergono, qui emergono
 * decode failure o warning inattesi.
 *
 * Tiene un mini-stato derivato dagli eventi solo per pilotare la partita: non è il reducer del client.
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Rispetta il rate limit auth (3/s, burst 5, per IP: condiviso da tutti i client dello script) invece di farsi rifiutare. */
export function createPacer() {
  let last = 0;
  return {
    auth: async () => {
      const delta = Date.now() - last;
      if (delta < 400) await sleep(400 - delta);
      last = Date.now();
    },
  };
}
export type Pacer = ReturnType<typeof createPacer>;

export class E2EClient {
  tokens: TokenPair | null = null;
  account: UserAccount | null = null;
  /** Colore: da `white_player`/`black_player` di `game_state`, confrontati con l'id dell'account. */
  color: Color | null = null;
  /** Codice dell'ultima chiusura del socket (4001 = connessione sostituita). */
  closeCode: number | null = null;
  readonly events: ServerEvent[] = [];
  readonly failures: DecodeFailure[] = [];
  readonly warnings: AdapterWarning[] = [];
  readonly problems: string[] = [];

  state: PublicGameState | null = null;
  hand: HandCard[] = [];
  phase: Phase | 'unknown' | null = null;
  activePlayer: Color | 'unknown' | null = null;
  gameOver: Extract<ServerEvent, { type: 'game_over' }> | null = null;
  connected = false;

  private ws: WebSocket | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    readonly httpUrl: string,
    readonly wsUrl: string,
    readonly username: string,
    readonly email: string,
    private readonly pacer: Pacer,
  ) {}

  private async request(method: 'GET' | 'POST', path: string, body?: string) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.tokens !== null) headers['Authorization'] = `Bearer ${this.tokens.accessToken}`;
    const res = await fetch(`${this.httpUrl}${path}`, body === undefined ? { method, headers } : { method, headers, body });
    const outcome = interpretHttpResponse(res.status, await res.text());
    this.warnings.push(...outcome.warnings);
    return outcome;
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

  /** Stesso utente, stessa sessione, connessione distinta: come una seconda scheda del browser. */
  twin(): E2EClient {
    const other = new E2EClient(this.httpUrl, this.wsUrl, this.username, this.email, this.pacer);
    other.tokens = this.tokens;
    other.account = this.account;
    return other;
  }

  /** Ticket monouso a ogni apertura, via `src/ws/connection.ts`. */
  async connect(scenario?: string): Promise<void> {
    if (this.tokens === null) throw new Error('connect senza sessione');
    const resolved = await resolveSocketUrl(
      {
        fetchWsTicket: async () => {
          const res = await this.request('GET', '/ws/ticket');
          if (!res.ok) return { ok: false, error: res.error };
          const ticket = normalizeWsTicket(res.data);
          return ticket.ok ? { ok: true, value: ticket.value } : { ok: false, error: { status: 200, code: 'invalid_response' } };
        },
      },
      this.wsUrl,
    );
    if (!resolved.ok) throw new Error(`ticket: ${JSON.stringify(resolved.error)}`);
    const url = new URL(resolved.url);
    if (scenario !== undefined) url.searchParams.set('scenario', scenario);
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.on('message', (data) => this.onFrame(data.toString()));
    this.closeCode = null;
    ws.on('close', (code) => {
      this.connected = false;
      this.closeCode = code;
      this.notify();
    });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
      ws.once('unexpected-response', (_req, response) => reject(new Error(`upgrade rifiutato: ${response.statusCode}`)));
    });
    this.connected = true;
  }

  /** Chiude del tutto il socket prima di restituire. */
  async disconnect(): Promise<void> {
    const ws = this.ws;
    this.ws = null;
    if (ws === null || ws.readyState === ws.CLOSED) return;
    await new Promise<void>((resolve) => {
      ws.once('close', () => resolve());
      ws.close();
    });
  }

  /**
   * Invia rispettando il limite del server di 5 messaggi/s (`handlers/ws.go:60`): oltre, il messaggio viene
   * scartato con un `error`. Restituisce l'indice da cui attendere la risposta.
   */
  send(intent: ClientIntent): number {
    if (this.ws === null) throw new Error('socket non connesso');
    const ws = this.ws;
    const now = Date.now();
    const at = Math.max(now, this.nextSendAt);
    this.nextSendAt = at + 220;
    const frame = encodeClientIntent(intent);
    if (at === now) ws.send(frame);
    else setTimeout(() => ws.readyState === ws.OPEN && ws.send(frame), at - now);
    return this.events.length;
  }

  private nextSendAt = 0;

  private onFrame(raw: string): void {
    let result;
    try {
      result = decodeServerMessage(raw);
    } catch (error) {
      this.problems.push(`l'adapter ha lanciato un'eccezione: ${String(error)}`);
      return;
    }
    if (!result.ok) {
      this.failures.push(result.failure);
    } else {
      this.warnings.push(...result.warnings);
      this.apply(result.event);
      this.events.push(result.event);
    }
    this.notify();
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }

  private apply(event: ServerEvent): void {
    // Dopo il primo game_over gli eventi di partita si ignorano: difesa, il server ora ne manda uno solo (B1).
    if (this.gameOver !== null && event.type !== 'game_over' && event.type !== 'error') return;
    switch (event.type) {
      case 'game_state':
        this.state = event.state;
        this.phase = event.state.phase;
        this.activePlayer = event.state.activePlayer;
        if (event.state.players !== null && this.account !== null) {
          const { white, black } = event.state.players;
          const me = this.account.id;
          this.color = white.id === me ? 'white' : black.id === me ? 'black' : null;
        }
        break;
      case 'hand':
        this.hand = [...event.hand.cards];
        break;
      case 'card_drawn':
        this.hand.push(event.card);
        break;
      case 'phase_changed':
        this.phase = event.phase;
        this.activePlayer = event.activePlayer;
        break;
      case 'spell_cast':
        if (event.player === this.color) {
          const index = this.hand.findIndex((c) => c.spellId === event.spellId);
          if (index >= 0) this.hand.splice(index, 1);
        }
        break;
      case 'game_over':
        this.gameOver ??= event;
        break;
      default:
        break;
    }
  }

  get isMyTurn(): boolean {
    return this.color !== null && this.activePlayer === this.color;
  }

  /** Mana attuale del giocatore, dall'ultimo `mana_changed` o `game_state`. */
  get myMana(): number {
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i];
      if (e?.type === 'mana_changed' && e.player === this.color) return e.mana.current;
      if (e?.type === 'game_state' && this.color !== null) return e.state.mana[this.color].current;
    }
    return 0;
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
            `${this.username}: timeout in attesa di "${label}" — fase ${String(this.phase)}, attivo ${String(this.activePlayer)}, colore ${String(this.color)}, ultimi eventi: ${recent}`,
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
