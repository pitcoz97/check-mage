import type { ApiResult } from '../api/endpoints';
import type { HttpErrorInfo, WsTicket } from '../api/types';

/**
 * Unico punto del client che conosce la strategia di autenticazione del WebSocket.
 *
 * Ticket monouso (chess-server `middleware/wsticket.go`): `GET /ws/ticket` con il Bearer, poi `/ws?ticket=…`
 * entro 30 secondi. Un ticket vale una volta sola, quindi se ne chiede uno nuovo a ogni apertura, riconnessioni
 * comprese; uno usato o scaduto riceve 401 all'upgrade. Così il JWT non finisce nell'URL né nei log di accesso.
 *
 * Il resto della connessione (heartbeat, backoff, ciclo di vita) arriva allo Step 3.
 */

export function buildSocketUrl(wsBaseUrl: string, ticket: string): string {
  const url = new URL(wsBaseUrl);
  url.searchParams.set('ticket', ticket);
  return url.toString();
}

export interface TicketSource {
  fetchWsTicket(): Promise<ApiResult<WsTicket>>;
}

export type SocketUrlResult = { readonly ok: true; readonly url: string } | { readonly ok: false; readonly error: HttpErrorInfo };

/** Chiede un ticket nuovo e costruisce l'URL di apertura. Un 401 sul ticket passa dal refresh di `http.ts`. */
export async function resolveSocketUrl(source: TicketSource, wsBaseUrl: string): Promise<SocketUrlResult> {
  const ticket = await source.fetchWsTicket();
  return ticket.ok ? { ok: true, url: buildSocketUrl(wsBaseUrl, ticket.value.ticket) } : { ok: false, error: ticket.error };
}
