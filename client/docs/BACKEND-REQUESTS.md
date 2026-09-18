# BACKEND-REQUESTS

Registro vivo delle modifiche da chiedere al server Go (`C:\Projects\chess-server`).
Il client **non** aggira nessuna di queste voci.

**Riferimento del codice:** branch `fix/backend-requests` (commit `62475c9`), costruito su `7f817e5`. Non è ancora
unito in `main`. Riepilogo lato server in `chess-server/docs/SERVER-CHANGES.md`.
I riferimenti `file.go:riga` sono relativi a `internal/` e puntano a quel branch, salvo dove è indicato `7f817e5`.

Priorità:
- **P0**: senza, il client non funziona o i dati si corrompono;
- **P1**: UX degradata o rischio di sicurezza;
- **P2**: miglioramento o conferma.

Stati: `aperta` · `accettata` · `applicata` · `applicata in parte` · `rifiutata` · `risolta nel codice` · `non più necessaria`.

Gli id delle voci nate allo Step 0 sono stati mantenuti; le voci `Bn` sono bug trovati leggendo il codice.

---

## Aperte

### P1-3 (REST) — Codici d'errore anche nella REST
- **Stato:** applicata in parte. Il WebSocket ha `code` e `details` (`game/client.go:126`, `gameerr/gameerr.go`);
  la REST risponde ancora `{success:false, error:"testo"}` (`models/response.go:5`).
- **Perché:** il client continua a riconoscere i testi italiani della REST (ASSUMPTIONS C4), compresi quelli nuovi:
  `"Ticket non valido o scaduto"` (`middleware/wsticket.go:88`), `"Risorsa non trovata"` e
  `"Metodo non consentito"` (`api/router.go:33-34`).
- **Contratto proposto:** `{ "success": false, "error": "…", "code": "invalid_credentials" }`, con i codici di
  `HTTP_ERROR_CODES` in `src/api/types.ts`.

### B7 (resto) — PGN in SAN
- **Stato:** applicata in parte. La mossa assorbita è `0000` in `board.moves` (`game/room.go:37,488`) e `--` nel PGN
  (`game/room.go:1176-1188`): la numerazione non si sfasa più. Il PGN resta in UCI e non registra le magie.
- **Priorità:** P2. Serve solo se lo storico partite (fuori scope v1) dovrà mostrare la notazione standard.
- **Nel client:** lo storico della partita in corso si costruisce dagli eventi, non dal PGN.

### B16 — Matto e stallo contano come legali le mosse dei pezzi congelati
- **Stato:** aperta · **Priorità:** P2 (segnalata dal server in `SERVER-CHANGES.md` §7)
- **Perché:** `engine.SF.GetGameStatus` (`game/room.go:519`) valuta la FEN senza conoscere il freeze
  (`game/room.go:455`). Se un giocatore ha solo mosse di pezzi congelati, la partita non finisce: può solo
  abbandonare o aspettare il timeout.
- **Fix proposto:** escludere le mosse dei pezzi congelati dal controllo di fine partita, oppure trattare
  "nessuna mossa eseguibile" come passaggio forzato della fase `move`.
- **Nel client:** nessun aggiramento. Allo Step 5 la UI deve rendere evidente che si può solo abbandonare
  (nessuna mossa evidenziabile, resa sempre disponibile).

### P2-1 — Scelta del time control
- **Stato:** aperta, **da decidere insieme** (risposta del server: servono più code di matchmaking; vanno scelte
  le cadenze e la UI della lobby).
- **Perché:** coda unica con time control fisso 10' + 5" (`config/config.go`, `game/manager.go:31`).

### P2-11 — Refresh token in cookie `HttpOnly`
- **Stato:** aperta, **sospesa** (risposta del server: prima va deciso il dominio di produzione; con un cookie servono
  CORS con credenziali e origini esplicite, niente `http://*`, e protezione CSRF su `/auth/refresh`).
- **Perché:** entrambi i token arrivano nel body (`handlers/auth.go`), quindi il client web li conserva in
  `localStorage`, esposto a un eventuale XSS (ASSUMPTIONS C7).
- **Contratto proposto:** `POST /auth/login` e `POST /auth/refresh` impostano
  `Set-Cookie: refresh_token=…; HttpOnly; Secure; SameSite=Strict; Path=/auth`, e `/auth/refresh` legge il cookie.
  L'access token resta nel body e il client lo tiene solo in memoria. Serve anche un `POST /auth/logout` che cancelli
  il cookie. Su Capacitor il body resta necessario: il cookie va affiancato, non sostituito.

---

## Applicate in `fix/backend-requests`

Da verificare a runtime allo Step 7: il server le ha testate senza Stockfish né PostgreSQL. Dallo Step 2-bis il mock
le replica tutte (`mock-server/`, test in `room.test.ts`, `rest.test.ts` e nell'e2e).

| Id | Voce | Cosa fa ora il server | Rif. |
|---|---|---|---|
| P0-5 | Identità dei giocatori | `game_state.white_player` / `black_player` `{id, username}`, anche alla riconnessione. `game_start` non esiste. | `game/room.go:1365-1366` |
| B1 | Partita `active` dopo resign/timeout/abbandono | Status terminali `resigned`/`timeout`/`abandoned`; `finishLocked` chiude una sola volta (un `game_over`, un salvataggio, ELO una volta). | `game/room.go:25-33,1209-1237` |
| B2 | Il socket vecchio fa perdere per abbandono | `Leave` ignora le connessioni sostituite; `Reconnect` chiude la vecchia con `error` `replaced_by_new_connection` e poi con il codice 4001. | `game/room.go:1042,1116-1120`, `game/client.go:28,142` |
| B3 | Refresh token accettato come access token | Solo `type == "access"`, solo HS256, claim `user_id`/`username` obbligatori. | `middleware/auth.go:56-73` |
| B4 | Azioni dopo la fine | `error` `game_over` su mossa, pass, cast, resa e patta. | `game/room.go:360,426,576,627,1391` |
| B5 | Teleport crea posizioni illegali | `illegal_position` (costo zero) se una magia lascia sotto scacco il re di chi non ha il tratto; vale anche per Disintegrate. | `game/room.go:725-733,766,832` |
| B6 | `time_control` fisso | Salvato come `"10+5"` dalla configurazione. | `game/room.go:1191` |
| B8 | Liste `null` | `[]`. | `handlers/stats.go:37,97` |
| B9 | CORS `capacitor://localhost` | Origini da `CORS_ALLOWED_ORIGINS`; il default include `capacitor://localhost`. | `config/config.go:74`, `api/router.go:23` |
| B10 | Stesso utente in coda due volte | La connessione nuova sostituisce la vecchia (4001); "Sei già in coda" non esiste più. `LeaveQueue` confronta la connessione. | `game/manager.go:50-64,106` |
| B11 | Scudo ed en passant | Lo scudo blocca anche l'en passant; `effect_expired.square` è il pedone protetto. **Nuovo:** se la cattura era l'unico modo di uscire dallo scacco, lo scudo si rompe e la cattura avviene, senza `effect_expired`. | `game/room.go:413-421,467-473` |
| B12 | 404 testuale, refresh senza limiter | 404/405 in JSON; `/auth/refresh` con il limite auth. | `api/router.go:33-34,44` |
| B13 | Teleport del re su g1/c1/g8/c8 | `Tracker.Relocate` senza semantica scacchistica. | `effects/tracker.go:105`, `game/room.go:838` |
| B14 | Teleport diagonale di un pedone | Come B13. | `effects/tracker.go:105` |
| B15 | Rate limit per connessione | Chiave = IP senza porta; `X-Forwarded-For`/`X-Real-IP` solo da `TRUSTED_PROXIES`. | `middleware/ratelimit.go:101` (`getIP`, `isTrustedProxy`) |
| P1-8 | Ticket monouso per il WebSocket | `GET /ws/ticket` → `{ticket, expires_in: 30}`; `/ws?ticket=…` monouso. `?token=` e Bearer restano validi. | `middleware/wsticket.go`, `handlers/ws.go:23`, `api/router.go:58,62` |
| P1-1 | `GET /spells` | `data: [Spell]` con i tag JSON di `Spell`, ordinato per `mana_cost` e poi `id`. | `handlers/catalog.go:13`, `spells/spells.go:172` |
| P1-3 (WS) | Codici d'errore | `error` = `{message, code, details?}`, 19 codici. | `gameerr/gameerr.go`, `game/client.go:126` |
| P2-9 | `time_control` in `game_state` | `{base_ms, increment_ms}`. | `game/room.go:1367-1370` |
| P2-10 | Password policy | `GET /auth/password-policy`. Non include la regola dell'email. | `handlers/catalog.go:24`, `validation/validation.go:47` |

## Chiuse prima di `fix/backend-requests` (rif. `7f817e5`)

| Id | Voce | Stato | Rif. |
|---|---|---|---|
| P0-2 | CORS per lo sviluppo | risolta nel codice | `api/router.go:20` |
| P0-3 | `pieces[]` con `piece_id` | non più necessaria: `active_effects` per casella basta | `game/room.go:1117` |
| P0-4 | Id d'istanza delle carte | non più necessaria: basta lo `spell_id` per il cast | `match/match.go:318` |
| P1-2 | Stato completo alla riconnessione | risolta nel codice (`game_state` + `hand`) | `game/room.go:922-928` |
| P1-5 | Dimensione dei mazzi | risolta nel codice (`*_deck_size`) | `game/room.go:1115-1116` |
| P1-6 | Notifica di rientro dell'avversario | risolta nel codice | `game/room.go:933` |
| P2-2 | Fireball/Teleport | risolta: Disintegrate non colpisce il re, Teleport non cambia il tratto | `effects/effects.go:196`, `game/room.go:669` |
| P2-3 | Regole non documentate | risolta: regole lette dal codice (ASSUMPTIONS §5) | — |
| P2-4 | Notifica del rifiuto di patta | risolta nel codice | `game/room.go:1206` |
| P2-5 | Numero di bersagli | risolta: `piece_move` = 2 | `spells/spells.go:37` |
| P1-7 | Orologio sul tratto scacchistico (dalla doc) | risolta nel codice | `game/room.go:1055` |
