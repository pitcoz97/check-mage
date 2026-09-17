import { z } from 'zod';
import { createStore, type StoreApi } from 'zustand/vanilla';

import { createApi, type Api } from '../api/endpoints';
import { createHttpClient, type RefreshResult } from '../api/http';
import type { HttpErrorInfo, TokenPair, UserAccount } from '../api/types';
import { STORAGE_KEYS, type KeyValueStorage } from '../lib/storage';

/**
 * Sessione del client: token persistiti, account corrente, ciclo di vita dell'autenticazione.
 *
 * Sul web i token stanno in `localStorage` via `storage.ts` (ASSUMPTIONS C7): serve per sopravvivere alla
 * chiusura della tab. Su mobile, allo Step 6, la stessa interfaccia userà `@capacitor/preferences`.
 */

export type AuthStatus = 'checking' | 'authenticated' | 'anonymous' | 'unreachable';

export type LoginOutcome = { readonly ok: true } | { readonly ok: false; readonly error: HttpErrorInfo };

export type RegisterOutcome =
  | { readonly ok: true }
  /** La registrazione è stata rifiutata: gli errori vanno sotto i campi del form. */
  | { readonly ok: false; readonly stage: 'register'; readonly error: HttpErrorInfo }
  /** Account creato ma login automatico fallito: si passa al form di login con l'email compilata. */
  | { readonly ok: false; readonly stage: 'login'; readonly error: HttpErrorInfo };

export interface AuthState {
  readonly status: AuthStatus;
  readonly account: UserAccount | null;
  readonly notice: 'session_expired' | null;
  bootstrap(): Promise<void>;
  login(email: string, password: string): Promise<LoginOutcome>;
  register(username: string, email: string, password: string): Promise<RegisterOutcome>;
  logout(): Promise<void>;
  clearNotice(): void;
}

export interface Auth {
  readonly store: StoreApi<AuthState>;
  readonly api: Api;
}

const storedSessionSchema = z.object({ accessToken: z.string().min(1), refreshToken: z.string().min(1) });

export function createAuth(deps: { baseUrl: string; storage: KeyValueStorage; fetchImpl?: typeof fetch }): Auth {
  const { storage } = deps;
  /** Copia in memoria dei token: evita letture asincrone dallo storage a ogni richiesta. */
  let tokens: TokenPair | null = null;
  let bootstrapping: Promise<void> | null = null;

  async function saveTokens(next: TokenPair | null): Promise<void> {
    tokens = next;
    if (next === null) await storage.remove(STORAGE_KEYS.session);
    else await storage.set(STORAGE_KEYS.session, JSON.stringify(next));
  }

  async function loadTokens(): Promise<TokenPair | null> {
    const raw = await storage.get(STORAGE_KEYS.session);
    if (raw === null) return null;
    try {
      const parsed = storedSessionSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    } catch {
      // valore corrotto: si scarta sotto
    }
    await storage.remove(STORAGE_KEYS.session);
    return null;
  }

  const http = createHttpClient({
    baseUrl: deps.baseUrl,
    ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
    session: {
      getAccessToken: () => tokens?.accessToken ?? null,
      refresh: () => refresh(),
      expire: () => expire(),
    },
  });
  const api = createApi(http);

  async function refresh(): Promise<RefreshResult> {
    if (tokens === null) return 'rejected';
    const result = await api.refreshTokens(tokens.refreshToken);
    if (result.ok) {
      await saveTokens(result.value);
      return 'refreshed';
    }
    return result.error.code === 'network_error' || result.error.code === 'rate_limited' ? 'unreachable' : 'rejected';
  }

  /** Idempotente: più richieste che scoprono la scadenza producono un solo logout. */
  async function expire(): Promise<void> {
    if (tokens === null && store.getState().status !== 'authenticated') return;
    await saveTokens(null);
    store.setState({ status: 'anonymous', account: null, notice: 'session_expired' });
  }

  const store: StoreApi<AuthState> = createStore<AuthState>()((set, get) => ({
    status: 'checking',
    account: null,
    notice: null,

    bootstrap() {
      bootstrapping ??= (async () => {
        set({ status: 'checking' });
        tokens = await loadTokens();
        if (tokens === null) {
          set({ status: 'anonymous', account: null });
          return;
        }
        const me = await api.fetchAccount();
        if (me.ok) {
          set({ status: 'authenticated', account: me.value });
        } else if (me.error.code === 'network_error' || me.error.code === 'rate_limited') {
          // Server irraggiungibile: la sessione resta salvata, si potrà riprovare.
          set({ status: 'unreachable' });
        } else if (get().status !== 'anonymous') {
          await expire();
        }
      })().finally(() => {
        bootstrapping = null;
      });
      return bootstrapping;
    },

    async login(email, password) {
      set({ notice: null });
      const result = await api.login(email, password);
      if (!result.ok) return { ok: false, error: result.error };
      await saveTokens(result.value.tokens);
      set({ status: 'authenticated', account: result.value.user });
      return { ok: true };
    },

    async register(username, email, password) {
      const created = await api.register(username, email, password);
      if (!created.ok) return { ok: false, stage: 'register', error: created.error };
      const logged = await get().login(email, password);
      return logged.ok ? { ok: true } : { ok: false, stage: 'login', error: logged.error };
    },

    async logout() {
      await saveTokens(null);
      set({ status: 'anonymous', account: null, notice: null });
    },

    clearNotice() {
      set({ notice: null });
    },
  }));

  return { store, api };
}
