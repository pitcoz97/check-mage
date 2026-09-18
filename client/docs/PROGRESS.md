# PROGRESS

> Punto di ripartenza, non diario. Massimo una pagina. Leggilo prima di tutto il resto.

## Step corrente
**Step 2-bis — Riallineamento a `fix/backend-requests`: COMPLETO, in attesa di review.** Non iniziare lo Step 3 senza approvazione.
Server: `C:\Projects\chess-server` (sola lettura, qui non eseguibile), branch `fix/backend-requests` (`62475c9`).
Riepilogo lato server in `chess-server/docs/SERVER-CHANGES.md`.

## Completo
- **Step 0 / 0-bis:** contratto sul codice Go, mock come porting di Go.
- **Step 1:** Vite 8, React 19, Router 8, Tailwind 4 legato ai token, i18n tipizzato, layout shell.
- **Step 2:** client REST con un solo refresh condiviso, sessione persistente, guardie, login/registrazione, profilo.
- **Step 2-bis:**
  - **mock:** un solo contratto, quello nuovo;
    - ticket monouso, limiti per IP con `TRUSTED_PROXIES`, `/spells`, `/auth/password-policy`, 404/405 JSON;
    - errori `{message, code, details}`, fine partita unica con status terminali, `game_state` prima di `game_over`;
    - chiusura 4001, scudo/en passant/`0000`, `illegal_position`, `relocate`, patta decaduta, orologio in tempo reale, heartbeat;
  - **adapter:** `code`/`details` (via la tabella dei testi WS), giocatori, `time_control`, `PlayedMove`, `draw_declined.reason`,
    `normalizeWsTicket`, `normalizePasswordPolicy`;
  - **client:** `connection.ts` con `?ticket=` (`resolveSocketUrl`); `endpoints.ts` con ticket, policy e catalogo;
    registrazione con requisiti da `/auth/password-policy`.
- **Verifica:**
  - typecheck, lint e build puliti; 219 test verdi; e2e 10/10 (nuovo scenario `replaced`), zero warning inattesi;
  - nel browser contro il mock: policy e `/spells` serviti, requisiti dalla policy, 404 JSON.
  - Registrazione, ticket e upgrade nel browser non li ho provati: niente account creati né password digitate; li copre l'e2e.

## Prossima azione concreta
Review dello Step 2-bis. Poi Plan Mode per lo **Step 3** (ciclo di vita del WebSocket, `applyServerEvent`).

## Decisioni prese
- React 19 + Router 8, i18n tipizzato, font self-hosted. Login automatico dopo la registrazione.
- Token in `localStorage` sul web (C7). Username inviato ripulito (C8). Il colore non si deduce: arriva da `game_state`.
- Mock e adapter seguono solo il contratto nuovo; nessuna variante `7f817e5`.

## Decisioni aperte
- Merge di `fix/backend-requests` in `main` e deploy (lato server). P2-1 (cadenze, UI lobby) da decidere insieme.
  P2-11 sospesa finché non si decide il dominio di produzione.
- Capacitor 6 o 8, `appId` → Step 6. Flavour text → Step 5 (`/spells` non lo espone). Licenza → prima dello Step 4.

## Da ricordare negli Step successivi
- **Step 3:**
  - `resolveSocketUrl` a ogni apertura (il ticket vale una volta);
  - chiusura **4001**: niente riconnessione automatica, stato "partita aperta altrove" con "Riprendi qui";
  - socket morto se non arriva nulla per qualche secondo in partita (C10), senza ping applicativi;
  - backoff ≥ 1s con jitter (upgrade 1/s burst 3 per IP, condiviso tra schede); < 5 msg/s;
  - ignorare gli eventi dopo `game_over` come difesa;
  - riconnessione dopo un riavvio del server.
- **Step 4:**
  - colore da `players` confrontato con `/me`;
  - `absorbed` nello storico; mossa ottimista riallineata al `game_state` (scudo che assorbe o si rompe);
  - posizione finale dal `game_state` prima di `game_over`;
  - patta: chi ha ricevuto l'offerta la scarta dopo la propria mossa;
  - incremento da `timeControl`.
- **Step 5:**
  - catalogo da `fetchSpellCatalog`, riserva `fallback.json`; 5 carte `noop`;
  - messaggi per `illegal_position` e gli altri codici, con `details`;
  - B16: con solo pezzi congelati resta la resa;
  - rotta `/dev/cards`.
- **Step 6:** in background oltre 60s il socket cade e dopo 30s scatta l'abbandono: alla ripresa, subito un nuovo ticket.
- **Step 7:** verifica a runtime sulla VM (C1, C4, C9, C10, G4, G6, G10, A15, scudo/en passant, patta decaduta).

## Note d'ambiente
- La shell dello strumento non vede Node nel PATH: prima dei comandi npm va ricaricato il PATH di Machine e User.
- `.env` locale da `.env.example` (ignorato da git; tolto `MOCK_CONTRACT`). `.claude/launch.json`: `dev` (5173), `mock` (8080).
- Identità git locale del repo: Riccardo Picozzi <riccardo.picozzi97@gmail.com>.
