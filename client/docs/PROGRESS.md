# PROGRESS

> Punto di ripartenza, non diario. Massimo una pagina. Leggilo prima di tutto il resto.

## Step corrente
**Step 1 — Scheletro: COMPLETO, in attesa di review.** Non iniziare lo Step 2 senza approvazione.
Codice del server: `C:\Projects\chess-server` (sola lettura, commit `7f817e5`, qui non eseguibile).

## Completo
- **Step 0 / 0-bis:** contratto sul codice Go (`adapter.ts`, `protocol.ts`, `connection.ts`), mock come porting
  di Go con contratti `current`/`proposed`, `ASSUMPTIONS.md` e `BACKEND-REQUESTS.md` (P0-5, B1–B15).
- **Step 1:**
  - Vite 8, React 19, React Router 8, Tailwind 4, tsconfig divisi (app/node/mock);
  - `src/design/tokens.css` come unica fonte dei colori, tema Tailwind senza palette di default,
    test `tests/no-hardcoded-colors.test.ts`, font self-hosted (`CREDITS.md`), `Button` e `Panel`;
  - i18n con react-i18next, chiavi tipizzate dall'italiano; lint `i18next/no-literal-string`; `LanguageSwitch`
    con persistenza tramite `src/lib/storage.ts`;
  - rotte `/lobby`, `/profile`, `/login`, `/register`, `/match`, 404; layout `AppShell`, `AuthLayout` e `MatchLayout`
    (desktop e portrait) con regioni segnaposto.
- **Verifica:**
  - typecheck, lint e build puliti; 183 test verdi;
  - prova in negativo: colore, stringa JSX e chiave i18n inesistente vengono rifiutati;
  - nel Browser pane a 1280, 375 e 360px: niente scroll orizzontale, token applicati, lingua persistente, console pulita.
  - Gli screenshot e il Tab reale non sono stati possibili perché la finestra era nascosta: il focus è verificato solo leggendo il CSS.

## Prossima azione concreta
Review dello Step 1. Dopo l'approvazione, Plan Mode per lo **Step 2** (client REST tipizzato, login via email e
registrazione, sessione persistente, refresh single-flight su 401, profilo da `/me` + `/users/{id}`, guardie di rotta).

## Decisioni prese
- **React 19 + React Router 8** invece del React 18 del briefing (§4): versioni correnti; Router 8 richiede React ≥ 19.2.
- react-i18next tipizzato; italiano di default senza auto-detect; font self-hosted.
- Il colore del giocatore non si deduce: serve P0-5 al server. WebSocket con `?token=`. Il mock replica i bug del server.

## Decisioni aperte
- Portare P0-5 e B1 al server.
- Capacitor 6 (briefing) o 8 (corrente) → Step 6. `appId` → Step 6. Testo di flavour → Step 5. Licenza del progetto → prima dello Step 4.

## Da ricordare negli Step successivi
- **Step 2:** login via email, refresh single-flight su 401, `env.ts` per gli URL.
- **Step 3:** chiudere il socket prima di riaprirlo (B2), ignorare gli eventi dopo `game_over` (B1), < 5 msg/s.
- **Step 4:** riallineare la mossa ottimista al `game_state` (scudo che assorbe la cattura).
- **Step 5:** `phase_changed` a raffica, auto-avanzamento dopo un cast, targeting di `piece_move`, rotta `/dev/cards`.

## Note d'ambiente
- La shell dello strumento non vede Node nel PATH: prima dei comandi npm va ricaricato il PATH di Machine e User.
- `.claude/launch.json` definisce `dev` (5173) e `mock` (8080) per il Browser pane.
- Identità git locale del repo: Riccardo Picozzi <riccardo.picozzi97@gmail.com>.
