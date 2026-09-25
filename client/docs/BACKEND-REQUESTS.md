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
- **Stato:** non più necessaria (2026-09-25, decisione di prodotto durante il redesign: il gioco resta a cadenza
  unica). Prima: da decidere insieme, perché servivano più code di matchmaking.
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

### P2-12 — Esporre la finestra di rientro
- **Stato:** aperta · **Priorità:** P2
- **Perché:** il banner di riconnessione mostra i secondi residui per rientrare, ma `RECONNECT_TIMEOUT` (`config/config.go:68`)
  non arriva al client, che assume 30s (ASSUMPTIONS C12).
- **Contratto proposto:** `reconnect_timeout_ms` in `game_state` (o in `GET /status`).

### P2-13 — Sapere se c'è una partita in corso senza aprire il socket
- **Stato:** aperta · **Priorità:** P2
- **Perché:** aprire `/ws` senza partita mette l'utente in coda (`game/manager.go:31-101`). Dopo un ricaricamento il client
  ricorda da sé la partita aperta (ASSUMPTIONS C11), ma non può saperlo da un altro dispositivo.
- **Contratto proposto:** `GET /me/match` (Bearer) → `{room_id, color}` oppure `data: null`.

### P2-14 — Stato di gioco dopo il cambio di turno
- **Stato:** aperta · **Priorità:** P2
- **Perché:** `tickEffectsOnNewTurn` (`game/room.go:858-866`) decrementa `remaining_turns` al rollover, ma dopo un `pass_phase` o
  un cast che chiude il turno non parte un `game_state`: il client mostra il valore vecchio fino alla mossa successiva
  (ASSUMPTIONS C13). Emerso dal confronto reducer/server nell'e2e.
- **Stessa causa, secondo effetto (ASSUMPTIONS C15):** al rollover si pesca, e la dimensione del mazzo **avversario**
  non arriva da nessun evento — `card_drawn` va solo a chi pesca e `hand_size_changed` porta la mano, non il mazzo.
  Emerso dalla suite di verifica del contratto (`npm run verify:server`).
- **Contratto proposto:** `game_state` anche quando il rollover decrementa degli effetti, oppure un evento `effects_ticked`
  con `active_effects`.

### P2-15 — Testo della carta nel catalogo
- **Stato:** aperta · **Priorità:** P2
- **Perché:** `GET /spells` porta solo dati di gioco (`spells/spells.go:61-74`). Il testo di regole della carta il client
  lo **genera** dai parametri degli effetti, quindi resta sempre allineato al bilanciamento; ma non esiste un posto dove
  mettere il testo di ambientazione, che è contenuto di gioco e non deve vivere nel client (rischio di invecchiare a
  ogni modifica del catalogo).
- **Contratto proposto:** campi facoltativi per magia: `description` (testo di regole scritto a mano, se un giorno
  servisse più preciso di quello generato) e `flavor` (ambientazione). Il client li mostra se ci sono, altrimenti
  continua a generare il testo dagli effetti.
- **Estensione (redesign):** la carta del nuovo design ha una cornice e un rombo per **rarità** (comune, rara, mitica)
  e una riga del **tipo** ("Magia · Protezione"). Sono contenuto di gioco: il client non li assegna per singola magia.
  Campi facoltativi proposti: `rarity` (`"common" | "rare" | "mythic"`) e `type` (stringa-codice, es. `"protection"`,
  che il client traduce). Finché mancano, ogni carta è disegnata come comune e la riga del tipo si ricava dal kind
  del primo effetto.

### P2-17 — Tetto del mana nel `game_state`
- **Stato:** aperta · **Priorità:** P2
- **Perché:** la barra del mana del redesign disegna tutti i cristalli fino al tetto, distinguendo quelli non ancora
  sbloccati. Il tetto è `MaxManaCap = 10` (`spells/spells.go:22`) ma non arriva al client, che lo assume (ASSUMPTIONS C16).
- **Contratto proposto:** `max_mana_cap` in `game_state` (o in `GET /status`).

### P2-18 — Magie nello stato di rientro
- **Stato:** aperta · **Priorità:** P2
- **Perché:** lo storico del redesign mostra anche le magie lanciate ("Scudo Runico → e4"). Il client le ricava dagli
  eventi `spell_cast` della sessione, ma al rientro il server manda solo lo stato pubblico con le mosse UCI
  (`game/room.go:1135-1137`, `Moves` in `match/match.go:71`): le magie lanciate prima della disconnessione si perdono.
- **Contratto proposto:** `spells_cast` nello stato pubblico: lista ordinata di
  `{spell_id, caster_color, targets, move_index}`, dove `move_index` è il numero di mosse già giocate al momento del
  lancio (per intercalarle nello storico).

### P2-19 — Variazione dell'ELO a fine partita
- **Stato:** aperta · **Priorità:** P2
- **Perché:** il redesign mostra la variazione dell'ELO ("▲ 18"). Il server la calcola e la salva
  (`db/db.go:78-85`) ma non la comunica: `game_over` non la porta. Il client la omette.
- **Contratto proposto:** `elo_change: {white, black}` (o `elo_before`/`elo_after`) in `game_over`, oppure l'ultima
  variazione in `GET /me`.

### P2-20 — Classifica: posizione propria e stagione
- **Stato:** aperta · **Priorità:** P2
- **Perché:** `GET /leaderboard` restituisce i primi 10 (`handlers/stats.go:14-40`). Il redesign mostra anche la
  posizione dell'utente quando è fuori dai primi 10, e una stagione. Il client omette entrambe.
- **Contratto proposto:** `GET /leaderboard` (Bearer facoltativo) con `me: {rank, elo}`; la stagione solo se il gioco
  ne avrà una (decisione di prodotto).

### P2-21 — Funzioni del design mostrate come «Presto»
- **Stato:** aperta, **da decidere insieme** (decisione di prodotto prima che di contratto) · **Priorità:** P2
- **Perché:** il redesign mostra funzioni che il server non ha. Nel client sono visibili ma disattivate, senza dati
  finti: modalità **amichevole** e **contro bot** (oggi una sola coda classificata, `game/manager.go:31`; Stockfish è
  usato solo per le regole, `game/room.go:446`), **mazzi** e deckbuilding (un solo mazzo condiviso; fuori scope v1
  nel briefing), **collezione**, **amici** e sfida diretta, **notifiche**, **chat** di partita.
- **Nel client:** nessun aggiramento. Le **cadenze** del design non sono incluse: per decisione di prodotto il gioco
  resterà a cadenza unica (vedi P2-1).

### P2-16 — Origini ammesse sull'handshake del WebSocket
- **Stato:** aperta · **Priorità:** P2
- **Perché:** oggi l'upgrader accetta qualunque origine (`handlers/ws.go:16-18`, `CheckOrigin` restituisce `true` con
  il commento "In prod controlla origine"). Va benissimo adesso, ma quando il controllo verrà acceso l'elenco deve
  includere le stesse origini del CORS REST, **compresa quella della WebView Android** (`https://localhost`) e,
  in sviluppo, `http://localhost:5173`. Con il solo dominio del sito web, la build Android smetterebbe di collegarsi.
- **Contratto proposto:** `CheckOrigin` che legge la stessa lista di `AllowedOrigins` usata dal CORS
  (`config/config.go:74-75`), invece di una lista separata.

---

## Applicate in `fix/backend-requests`

**Verificate a runtime il 23 settembre 2026** contro il server reale (`npm run verify:server`, esito in
`ASSUMPTIONS.md` §6): 47 voci, nessuna divergenza. Dallo Step 2-bis il mock le replica tutte (`mock-server/`, test in
`room.test.ts`, `rest.test.ts` e nell'e2e).

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
