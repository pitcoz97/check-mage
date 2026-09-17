/**
 * Unico punto del client che conosce la strategia di autenticazione del WebSocket.
 *
 * Oggi: JWT d'accesso come query param `?token=` (chess-server `middleware/auth.go:30-34`), l'unica
 * via praticabile dal browser, che non può impostare header sull'handshake. Se il server adotterà il
 * ticket monouso (BACKEND-REQUESTS P1-8), cambia solo questo file.
 *
 * Il resto della connessione (heartbeat, backoff, ciclo di vita) arriva allo Step 3.
 */
export function buildSocketUrl(wsBaseUrl: string, accessToken: string): string {
  const url = new URL(wsBaseUrl);
  url.searchParams.set('token', accessToken);
  return url.toString();
}
