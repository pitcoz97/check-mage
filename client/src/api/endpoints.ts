import {
  encodeLogin,
  encodeRefresh,
  encodeRegister,
  normalizeAccount,
  normalizeLeaderboard,
  normalizeLogin,
  normalizePasswordPolicy,
  normalizePublicProfile,
  normalizeRegistration,
  normalizeSpellCatalog,
  normalizeTokenPair,
  normalizeWsTicket,
  type HttpOutcome,
  type Normalized,
} from './adapter';
import type { HttpClient } from './http';
import type { Spell } from '../spells/schema';
import type {
  AuthSession,
  CredentialPolicy,
  HttpErrorInfo,
  LeaderboardEntry,
  PublicProfile,
  Registration,
  TokenPair,
  UserAccount,
  WsTicket,
} from './types';

/** Esito di una chiamata: dato già normalizzato dall'adapter, oppure errore con codice. */
export type ApiResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: HttpErrorInfo };

function toResult<T>(outcome: HttpOutcome, normalize: (data: unknown) => Normalized<T>): ApiResult<T> {
  if (!outcome.ok) return { ok: false, error: outcome.error };
  const normalized = normalize(outcome.data);
  return normalized.ok
    ? { ok: true, value: normalized.value }
    : { ok: false, error: { status: 200, code: 'invalid_response' } };
}

/** Il catalogo non fallisce mai: le voci invalide vengono scartate dall'adapter (G10). */
function normalizeCatalogList(data: unknown): Normalized<readonly Spell[]> {
  const catalog = normalizeSpellCatalog(data);
  return { ok: true, value: catalog.spells, warnings: catalog.warnings };
}

/** Endpoint REST usati dal client (chess-server `api/router.go`). */
export function createApi(http: HttpClient) {
  return {
    async register(username: string, email: string, password: string): Promise<ApiResult<Registration>> {
      return toResult(await http.request('POST', '/auth/register', { body: encodeRegister(username, email, password) }), normalizeRegistration);
    },

    async login(email: string, password: string): Promise<ApiResult<AuthSession>> {
      return toResult(await http.request('POST', '/auth/login', { body: encodeLogin(email, password) }), normalizeLogin);
    },

    /** Mai con `auth: true`: il refresh non deve innescare a sua volta la gestione del 401. */
    async refreshTokens(refreshToken: string): Promise<ApiResult<TokenPair>> {
      return toResult(await http.request('POST', '/auth/refresh', { body: encodeRefresh(refreshToken) }), normalizeTokenPair);
    },

    async fetchAccount(): Promise<ApiResult<UserAccount>> {
      return toResult(await http.request('GET', '/me', { auth: true }), normalizeAccount);
    },

    async fetchPublicProfile(userId: string): Promise<ApiResult<PublicProfile>> {
      return toResult(await http.request('GET', `/users/${encodeURIComponent(userId)}`), normalizePublicProfile);
    },

    /** Primi dieci per ELO (`handlers/stats.go:14-51`). Pubblico: niente posizione propria né stagione (P2-20). */
    async fetchLeaderboard(): Promise<ApiResult<readonly LeaderboardEntry[]>> {
      return toResult(await http.request('GET', '/leaderboard'), normalizeLeaderboard);
    },

    /** Requisiti di registrazione (`handlers/catalog.go:24-30`). Pubblico. */
    async fetchPasswordPolicy(): Promise<ApiResult<CredentialPolicy>> {
      return toResult(await http.request('GET', '/auth/password-policy'), normalizePasswordPolicy);
    },

    /** Catalogo delle magie (`handlers/catalog.go:13-20`). Pubblico. */
    async fetchSpellCatalog(): Promise<ApiResult<readonly Spell[]>> {
      return toResult(await http.request('GET', '/spells'), normalizeCatalogList);
    },

    /**
     * Ticket monouso per aprire il WebSocket (`handlers/ws.go:23-42`). Autenticato: un 401 passa dal refresh
     * condiviso di `http.ts`. Va chiesto a ogni apertura, anche nelle riconnessioni.
     */
    async fetchWsTicket(): Promise<ApiResult<WsTicket>> {
      return toResult(await http.request('GET', '/ws/ticket', { auth: true }), normalizeWsTicket);
    },
  };
}

export type Api = ReturnType<typeof createApi>;
