import { interpretHttpResponse, type HttpOutcome } from './adapter';

/**
 * Client REST: trasporto, Bearer e gestione del 401. L'interpretazione delle risposte è dell'adapter.
 *
 * Regola sul 401 (BACKEND-REQUESTS, briefing §3.1): un solo refresh condiviso da tutte le richieste in
 * corso, un solo retry, poi la sessione scade. Il refresh non passa da qui, quindi un loop è impossibile.
 */

export type RefreshResult = 'refreshed' | 'rejected' | 'unreachable';

/** Porta verso la sessione, implementata dall'auth store (niente import circolari). */
export interface SessionPort {
  getAccessToken(): string | null;
  refresh(): Promise<RefreshResult>;
  expire(): void | Promise<void>;
}

export interface RequestOptions {
  readonly body?: string;
  /** Richiede il Bearer e attiva la gestione del 401. */
  readonly auth?: boolean;
}

export interface HttpClient {
  request(method: 'GET' | 'POST', path: string, options?: RequestOptions): Promise<HttpOutcome>;
}

export interface HttpClientDeps {
  readonly baseUrl: string;
  readonly session: SessionPort;
  readonly fetchImpl?: typeof fetch;
}

const NETWORK_ERROR: HttpOutcome = { ok: false, error: { status: 0, code: 'network_error' }, warnings: [] };

export function createHttpClient({ baseUrl, session, fetchImpl = (...args) => fetch(...args) }: HttpClientDeps): HttpClient {
  let refreshing: Promise<RefreshResult> | null = null;

  async function send(method: string, path: string, body: string | undefined, token: string | null): Promise<HttpOutcome> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token !== null) headers['Authorization'] = `Bearer ${token}`;
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, body === undefined ? { method, headers } : { method, headers, body });
      return interpretHttpResponse(response.status, await response.text());
    } catch {
      return NETWORK_ERROR;
    }
  }

  /** Un solo refresh alla volta: chi arriva mentre è in corso attende lo stesso esito. */
  function refreshOnce(): Promise<RefreshResult> {
    if (refreshing === null) {
      refreshing = session.refresh().then(async (result) => {
        if (result === 'rejected') await session.expire();
        return result;
      });
      void refreshing.finally(() => {
        refreshing = null;
      });
    }
    return refreshing;
  }

  return {
    async request(method, path, options = {}) {
      const auth = options.auth === true;
      const first = await send(method, path, options.body, auth ? session.getAccessToken() : null);
      if (!auth || first.ok || first.error.status !== 401) return first;

      const refreshed = await refreshOnce();
      if (refreshed === 'unreachable') return NETWORK_ERROR;
      if (refreshed === 'rejected') return first;

      const retry = await send(method, path, options.body, session.getAccessToken());
      if (!retry.ok && retry.error.status === 401) await session.expire();
      return retry;
    },
  };
}
