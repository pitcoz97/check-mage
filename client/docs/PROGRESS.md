# PROGRESS

> Punto di ripartenza, non diario. Massimo una pagina. Leggilo prima di tutto il resto.

## Step corrente
**Step 2 — Auth e profilo: COMPLETO, in attesa di review.** Non iniziare lo Step 3 senza approvazione.
Codice del server: `C:\Projects\chess-server` (sola lettura, commit `7f817e5`, qui non eseguibile).

## Completo
- **Step 0 / 0-bis:** contratto sul codice Go (`adapter.ts`, `protocol.ts`, `connection.ts`), mock come porting di Go.
- **Step 1:** Vite 8, React 19, Router 8, Tailwind 4 legato ai token, i18n tipizzato, layout shell.
- **Step 2:**
  - `src/api/http.ts`: 401 → un refresh condiviso → un retry → scadenza;
  - `src/api/endpoints.ts`;
  - `src/store/authStore.ts`: Zustand, sessione in `storage.ts`, bootstrap con `GET /me`, stati `checking`/`authenticated`/`anonymous`/`unreachable`;
  - guardie `SessionGate`/`RequireAuth`/`GuestOnly`;
  - login via email; registrazione con requisiti live da `CREDENTIAL_POLICY` e login automatico;
  - profilo (`/me` + `/users/{id}`), profilo compatto in lobby, logout.
- **Verifica:**
  - typecheck, lint e build puliti; 216 test verdi, compreso `tests/auth-flow.test.ts` contro il mock
    (tab riaperta, access scaduto con un solo refresh, logout senza loop);
  - a mano nel browser contro il mock: registrazione, reload, refresh dopo scadenza (due richieste concorrenti,
    un solo refresh), token manomessi → login con avviso, errori tradotti, 360px senza overflow.

## Prossima azione concreta
Review dello Step 2. Dopo l'approvazione, Plan Mode per lo **Step 3** (`connection.ts` con `?token=`, heartbeat,
riconnessione con backoff, `applyServerEvent` nel matchStore, test del reducer su tutte le sequenze del mock).

## Decisioni prese
- React 19 + Router 8 (deviazione dal briefing §4). react-i18next tipizzato, font self-hosted.
- Dopo la registrazione: login automatico; se fallisce, login con email compilata.
- Token in `localStorage` sul web (ASSUMPTIONS C7, richiesta P2-11 per un cookie `HttpOnly`). Username inviato già ripulito (C8).
- Il colore del giocatore non si deduce: serve P0-5. WebSocket con `?token=`. Il mock replica i bug del server.

## Decisioni aperte
- Portare P0-5 e B1 al server.
- Capacitor 6 o 8 → Step 6. `appId` → Step 6. Testo di flavour → Step 5. Licenza del progetto → prima dello Step 4.

## Da ricordare negli Step successivi
- **Step 3:**
  - chiudere il socket prima di riaprirlo (B2); ignorare gli eventi dopo `game_over` (B1); < 5 msg/s;
  - riconnessione anche dopo un riavvio del server;
  - un 401 sull'upgrade `/ws` passa dal refresh dello store: un solo tentativo.
- **Step 4:** riallineare la mossa ottimista al `game_state` (scudo che assorbe la cattura).
- **Step 5:** `phase_changed` a raffica, auto-avanzamento dopo un cast, targeting di `piece_move`, rotta `/dev/cards`.

## Note d'ambiente
- La shell dello strumento non vede Node nel PATH: prima dei comandi npm va ricaricato il PATH di Machine e User.
- `.env` locale creato da `.env.example` (ignorato da git). `.claude/launch.json` ha `dev` (5173) e `mock` (8080).
- In dev lo StrictMode monta due volte gli effetti: il profilo fa due fetch (la prima risposta viene scartata).
- Identità git locale del repo: Riccardo Picozzi <riccardo.picozzi97@gmail.com>.
