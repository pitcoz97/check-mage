import {
  encodeLogin,
  encodeRefresh,
  encodeRegister,
  normalizeAccount,
  normalizeLogin,
  normalizePublicProfile,
  normalizeRegistration,
  normalizeTokenPair,
  type HttpOutcome,
  type Normalized,
} from './adapter';
import type { HttpClient } from './http';
import type { AuthSession, HttpErrorInfo, PublicProfile, Registration, TokenPair, UserAccount } from './types';

/** Esito di una chiamata: dato già normalizzato dall'adapter, oppure errore con codice. */
export type ApiResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: HttpErrorInfo };

function toResult<T>(outcome: HttpOutcome, normalize: (data: unknown) => Normalized<T>): ApiResult<T> {
  if (!outcome.ok) return { ok: false, error: outcome.error };
  const normalized = normalize(outcome.data);
  return normalized.ok
    ? { ok: true, value: normalized.value }
    : { ok: false, error: { status: 200, code: 'invalid_response' } };
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
  };
}

export type Api = ReturnType<typeof createApi>;
