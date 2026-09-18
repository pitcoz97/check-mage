# PROGRESS

> Punto di ripartenza, non diario. Massimo una pagina. Leggilo prima di tutto il resto.

## Step corrente
**Step 2 — Auth e profilo: COMPLETO, in attesa di review.** Non iniziare altri Step senza approvazione.
Server: `C:\Projects\chess-server` (sola lettura, qui non eseguibile), branch **`fix/backend-requests`** (`62475c9`),
che applica quasi tutte le nostre richieste (vedi `chess-server/docs/SERVER-CHANGES.md`). Il client è ancora allineato a `7f817e5`.

## Completo
- **Step 0 / 0-bis:** contratto sul codice Go (`adapter.ts`, `protocol.ts`, `connection.ts`), mock come porting di Go.
- **Step 1:** Vite 8, React 19, Router 8, Tailwind 4 legato ai token, i18n tipizzato, layout shell.
- **Step 2:** client REST con un solo refresh condiviso, sessione persistente, guardie, login/registrazione, profilo.
  Verifica: typecheck, lint, build puliti; 216 test verdi; prove a mano nel browser contro il mock.
- **Piani riallineati al server nuovo:** `BACKEND-REQUESTS.md` (applicate/aperte), `ASSUMPTIONS.md` (contratto bersaglio in §2, regole R1–R12).

## Prossima azione concreta
Review dello Step 2. Poi Plan Mode per lo **Step 2-bis — Riallineamento a `fix/backend-requests`** (proposto, prima dello Step 3):
- **mock:** porting del branch nuovo (R1–R12), `GET /ws/ticket`, `/spells`, `/auth/password-policy`, errori con `code`,
  chiusura 4001, status terminali, `game_state` prima di `game_over`. Rate limit per IP: limiti configurabili per i test;
- **adapter/protocol:** `code`/`details` al posto dei testi WS (testi solo come riserva); `white_player`/`black_player`;
  `time_control`; status nuovi; `draw_declined.reason`; `0000`; nuovi testi REST; normalizzatore della policy;
- **Register:** requisiti da `/auth/password-policy`, con la policy attuale come riserva (C9);
- **test:** error-texts, catalog-sync contro `/spells`, e2e su tutti gli scenari.

## Decisioni prese
React 19 + Router 8, i18n tipizzato, font self-hosted. Login automatico dopo la registrazione. Token in `localStorage`
sul web (C7). Username inviato ripulito (C8). Il colore del giocatore non si deduce mai: arriva da `game_state`.

## Decisioni aperte
- Contratto del mock: tenere `7f817e5` come variante `legacy` o solo il branch nuovo? Consiglio: solo il nuovo.
- Merge di `fix/backend-requests` in `main` e deploy (lato server). P2-1 (cadenze e UI lobby) da decidere insieme.
  P2-11 sospesa finché non si decide il dominio di produzione.
- Capacitor 6 o 8, `appId` → Step 6. Flavour text → Step 5 (`/spells` non lo espone). Licenza → prima dello Step 4.

## Da ricordare negli Step successivi
- **Step 3:**
  - ticket da `GET /ws/ticket` (passa da `http.ts`, quindi dal refresh) a ogni apertura, uso entro 30s;
    un 401 sull'upgrade = ticket scaduto → un solo nuovo ticket;
  - chiusura **4001**: niente riconnessione automatica, stato "partita aperta altrove" con "Riprendi qui";
  - socket morto se nessun messaggio per qualche secondo in partita (C10), senza ping applicativi;
  - backoff ≥ 1s con jitter (upgrade 1/s burst 3 per IP, condiviso tra schede); < 5 msg/s;
  - ignorare gli eventi dopo `game_over` (difesa; il server ora risponde `error` `game_over`);
  - riconnessione dopo un riavvio del server.
- **Step 4:**
  - colore da `white_player`/`black_player` confrontati con `/me`;
  - `0000` in `moves` = mossa assorbita: niente chess.js, voce "assorbita" nello storico;
  - mossa ottimista riallineata al `game_state` (scudo che assorbe, oppure si rompe se la cattura para lo scacco);
  - posizione finale dal `game_state` che precede `game_over`; 7 `reason` di fine;
  - offerta di patta chiusa su `draw_declined` (entrambe le `reason`); chi l'ha ricevuta la scarta dopo la propria mossa;
  - incremento visibile da `time_control`.
- **Step 5:**
  - catalogo da `/spells`, fallback locale; 5 carte `noop` (24 su 40 nel mazzo);
  - `illegal_position` (Teleport/Disintegrate in main1 che danno scacco) gestito come rifiuto localizzato;
  - messaggi d'errore con `details`;
  - B16: con solo pezzi congelati resta la resa;
  - rotta `/dev/cards`.
- **Step 6:** CORS di Capacitor già ok. In background oltre 60s il server chiude il socket e dopo 30s scatta l'abbandono:
  alla ripresa, riconnettersi subito con un nuovo ticket.
- **Step 7:** verifica a runtime sulla VM con due client (C1, C2, C3, C4, G4, G6, G10, A15, scudo/en passant,
  patta decaduta); `TRUSTED_PROXIES` se c'è un reverse proxy.

## Note d'ambiente
- La shell dello strumento non vede Node nel PATH: prima dei comandi npm va ricaricato il PATH di Machine e User.
- `.env` locale creato da `.env.example` (ignorato da git). `.claude/launch.json` ha `dev` (5173) e `mock` (8080).
- Identità git locale del repo: Riccardo Picozzi <riccardo.picozzi97@gmail.com>.
