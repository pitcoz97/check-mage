/**
 * Utilità per i test (e per le anteprime di sviluppo, `/dev/match` e `/dev/home`): server REST finto nell’inviluppo di chess-server e
 * storage in memoria.
 * Nessun modulo della build di produzione lo importa, quindi non entra nel bundle.
 */
import { createWebStorage, type KeyValueStorage } from '../lib/storage';

export type Handler = (init: RequestInit | undefined) => Response | Promise<Response>;

export const data = (payload: unknown, status = 200) => new Response(JSON.stringify({ success: true, data: payload }), { status });
export const fail = (status: number, error: string) => new Response(JSON.stringify({ success: false, error }), { status });

export const ACCOUNT = { id: 7, username: 'mario', email: 'mario@test.it', elo: 1234, created_at: '2026-01-15T10:00:00Z' };
export const LOGIN = {
  tokens: { access_token: 'a1', refresh_token: 'r1' },
  user: { id: 7, username: 'mario', email: 'mario@test.it', elo: 1234 },
};

/** `fetch` finto: le chiavi sono `METODO /path`. Una rotta assente simula il server irraggiungibile. */
export function fakeServer(routes: Record<string, Handler>) {
  const hits: string[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${new URL(String(url)).pathname}`;
    hits.push(key);
    const handler = routes[key];
    if (handler === undefined) throw new TypeError('fetch failed');
    return handler(init);
  }) as typeof fetch;
  return { hits, fetchImpl, routes };
}

export function memoryStorage(): { storage: KeyValueStorage; map: Map<string, string> } {
  const map = new Map<string, string>();
  const backend: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
  return { map, storage: createWebStorage(() => backend as Storage) };
}
