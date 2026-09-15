import { WebSocket } from 'ws';

import {
  decodeServerMessage,
  encodeClientIntent,
  encodeCredentials,
  normalizeHttpError,
  normalizeLoginResponse,
  normalizeSpellCatalog,
  normalizeUserProfile,
  normalizeWsTicket,
  type AdapterWarning,
} from '../../src/api/adapter';
import type { UserProfile } from '../../src/api/types';
import type { HandCard, ManaState, Phase, Username } from '../../src/game/model';
import type { Spell } from '../../src/spells/schema';
import type { ClientIntent, DecodeFailure, ServerEvent } from '../../src/ws/protocol';

/**
 * Client di prova per lo script e2e. Parla col mock SOLO attraverso `src/api/adapter.ts`: se il mock e
 * l'adapter divergono, qui emergono decode failure o warning inattesi.
 *
 * Tiene un mini-stato derivato dagli eventi solo per pilotare la partita: non è il reducer del client.
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Rispetta i rate limit del server (auth 3/s, ws 1/s) invece di farsi rifiutare. */
export function createPacer() {
  let lastAuth = 0;
  let lastWs = 0;
  const wait = async (last: number, gap: number) => {
    const delta = Date.now() - last;
    if (delta < gap) await sleep(gap - delta);
    return Date.now();
  };
  return {
    auth: async () => {
      lastAuth = await wait(lastAuth, 400);
    },
    ws: async () => {
      lastWs = await wait(lastWs, 1100);
    },
  };
}
export type Pacer = ReturnType<typeof createPacer>;

export class E2EClient {
  token = '';
  profile: UserProfile | null = null;
  readonly events: ServerEvent[] = [];
  readonly failures: DecodeFailure[] = [];
  readonly warnings: AdapterWarning[] = [];
  readonly problems: string[] = [];

  hand: HandCard[] = [];
  phase: Phase | 'unknown' | null = null;
  activePlayer: Username | null = null;
  fen = '';
  mana: Record<Username, ManaState> = {};
  gameOver: Extract<ServerEvent, { type: 'game_over' }> | null = null;

  private ws: WebSocket | null = null;
  private listeners = new Set<() => void>();

  constructor(
    readonly httpUrl: string,
    readonly wsUrl: string,
    readonly username: string,
    private readonly pacer: Pacer,
  ) {}

  private async request(method: 'GET' | 'POST', path: string, body?: string): Promise<{ status: number; json: unknown }> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token !== '') headers['Authorization'] = `Bearer ${this.token}`;
    const init: RequestInit = body === undefined ? { method, headers } : { method, headers, body };
    const res = await fetch(`${this.httpUrl}${path}`, init);
    const text = await res.text();
    let json: unknown;
    try {
      json = text === '' ? null : JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, json };
  }

  async register(password: string): Promise<void> {
    await this.pacer.auth();
    const res = await this.request('POST', '/auth/register', encodeCredentials(this.username, password));
    if (res.status !== 201 && normalizeHttpError(res.status, res.json).code !== 'username_taken') {
      throw new Error(`register ${this.username}: ${res.status} ${JSON.stringify(res.json)}`);
    }
  }

  async login(password: string): Promise<void> {
    await this.pacer.auth();
    const res = await this.request('POST', '/auth/login', encodeCredentials(this.username, password));
    const session = normalizeLoginResponse(res.json);
    if (res.status !== 200 || !session.ok) throw new Error(`login ${this.username}: ${res.status}`);
    this.token = session.value.token;
    await this.refreshProfile();
  }

  async refreshProfile(): Promise<UserProfile> {
    const res = await this.request('GET', '/me');
    const profile = normalizeUserProfile(res.json);
    if (!profile.ok) throw new Error(`/me: ${profile.issues.join('; ')}`);
    this.warnings.push(...profile.warnings);
    this.profile = profile.value;
    return profile.value;
  }

  async get(path: string) {
    return this.request('GET', path);
  }

  async catalog(): Promise<readonly Spell[]> {
    const res = await this.request('GET', '/spells');
    const catalog = normalizeSpellCatalog(res.json);
    this.warnings.push(...catalog.warnings);
    return catalog.spells;
  }

  async connect(scenario?: string): Promise<void> {
    const res = await this.request('GET', '/ws/ticket');
    const ticket = normalizeWsTicket(res.json);
    if (!ticket.ok) throw new Error(`/ws/ticket: ${res.status}`);
    await this.pacer.ws();
    const url = new URL(this.wsUrl);
    url.searchParams.set('ticket', ticket.value.ticket);
    if (scenario !== undefined) url.searchParams.set('scenario', scenario);

    const ws = new WebSocket(url);
    this.ws = ws;
    ws.on('message', (data) => this.onFrame(data.toString()));
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
      ws.once('unexpected-response', (_req, response) => reject(new Error(`upgrade rifiutato: ${response.statusCode}`)));
    });
  }

  async disconnect(): Promise<void> {
    const ws = this.ws;
    if (ws === null) return;
    this.ws = null;
    await new Promise<void>((resolve) => {
      ws.once('close', () => resolve());
      ws.close();
    });
  }

  send(intent: ClientIntent): number {
    if (this.ws === null) throw new Error('socket non connesso');
    this.ws.send(encodeClientIntent(intent));
    return this.events.length;
  }

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
    for (const listener of [...this.listeners]) listener();
  }

  private apply(event: ServerEvent): void {
    switch (event.type) {
      case 'game_start':
        this.hand = [...(event.snapshot.hand ?? [])];
        this.phase = event.snapshot.phase;
        this.activePlayer = event.snapshot.activePlayer;
        this.fen = event.snapshot.fen;
        this.mana = { ...(event.snapshot.mana ?? {}) };
        break;
      case 'game_state':
        this.fen = event.fen;
        break;
      case 'phase_changed':
        this.phase = event.phase;
        this.activePlayer = event.activePlayer;
        break;
      case 'card_drawn':
        this.hand.push(event.card);
        break;
      case 'spell_cast':
        if (event.player === this.username) {
          const index = this.hand.findIndex((c) => c.spellId === event.spellId);
          if (index >= 0) this.hand.splice(index, 1);
        }
        break;
      case 'mana_changed':
        this.mana[event.player] = event.mana;
        break;
      case 'game_over':
        this.gameOver = event;
        break;
      default:
        break;
    }
  }

  get isMyTurn(): boolean {
    return this.activePlayer === this.username;
  }

  get myMana(): ManaState {
    return this.mana[this.username] ?? { current: 0, max: 0 };
  }

  /** Attende che il predicato sullo stato diventi vero (o la fine partita, se `orGameOver`). */
  until(predicate: () => boolean, label: string, timeoutMs = 15_000): Promise<void> {
    return this.waitFor(() => predicate(), label, timeoutMs);
  }

  /** Attende un evento arrivato dopo l'indice `from` che soddisfa il predicato. */
  async event<T extends ServerEvent>(from: number, predicate: (e: ServerEvent) => e is T, label: string, timeoutMs = 15_000): Promise<T> {
    let found: T | undefined;
    await this.waitFor(
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

  private waitFor(check: () => boolean, label: string, timeoutMs: number): Promise<void> {
    if (check()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        reject(new Error(`${this.username}: timeout in attesa di "${label}"`));
      }, timeoutMs);
      const listener = () => {
        if (!check()) return;
        clearTimeout(timer);
        this.listeners.delete(listener);
        resolve();
      };
      this.listeners.add(listener);
    });
  }
}

export function isType<K extends ServerEvent['type']>(type: K) {
  return (e: ServerEvent): e is Extract<ServerEvent, { type: K }> => e.type === type;
}
