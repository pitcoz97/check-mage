# BACKEND-REQUESTS

Registro vivo delle modifiche da chiedere al server Go (`C:\Projects\chess-server`, commit `7f817e5`).
Riferimenti `file.go:riga` relativi a `internal/`. Il client **non** aggira nessuna di queste voci.

Priorità:
- **P0**: senza, il client non funziona o i dati si corrompono;
- **P1**: UX degradata o rischio di sicurezza;
- **P2**: miglioramento o conferma.

Stati: `aperta` · `accettata` · `applicata` · `rifiutata` · `risolta nel codice` · `non più necessaria`.

Gli id delle voci nate allo Step 0 sono stati mantenuti; le voci `Bn` sono bug trovati leggendo il codice.

---

## Aperte

### P0-5 — Identità dei giocatori nella partita
- **Stato:** aperta
- **Perché:** il server non comunica mai al client il suo colore, né nome e id dell'avversario
  (`game/manager.go:88-95` ha `game_start` commentato; `active_player` e `player` sono colori).
  Senza questo dato il client non sa orientare la scacchiera né capire quando è il suo turno.
- **Contratto proposto (preferito):** aggiungere a `publicState` (`game/room.go:1101`), così vale
  sia all'avvio sia alla riconnessione:
  ```jsonc
  "white_player": { "id": 42, "username": "mario" },
  "black_player": { "id": 7,  "username": "luigi" }
  ```
- **Alternativa:** scommentare `game_start {room_id, white, black, fen}`, inviarlo **prima** di
  `broadcastState` in `NewRoom` e ripeterlo in `Reconnect`.
- **Nel mock:** contratto `proposed` (opzione preferita).

### B1 — Dopo resign, timeout o abbandono la partita resta `active`
- **Stato:** aperta · **Priorità:** P0 (corrompe i dati)
- **Perché:** `handleResign` (`game/room.go:1122`), il timeout (`game/room.go:1060`) e l'abbandono
  (`game/room.go:875`) chiamano `endGame` senza impostare `Board.Status`. Un giocatore che chiude il socket
  dopo il `game_over`, come chiede la documentazione per rimettersi in coda, fa partire `Leave`
  (`game/room.go:858` controlla solo `status == active`). Dopo 30s `endGame` gira **una seconda volta**:
  secondo `game_over`, `SaveGame` duplicato ed **ELO aggiornato due volte**.
- **Fix proposto:** impostare uno status terminale (es. `"resigned"`/`"timeout"`/`"abandoned"`, oppure un
  flag `ended`) dentro `endGame`, e rendere `endGame` idempotente.
- **Nel client:** ignora qualunque evento di partita dopo il primo `game_over` (Step 3).

### B2 — Il socket vecchio che si chiude dopo `Reconnect` fa perdere per abbandono
- **Stato:** aperta · **Priorità:** P1
- **Perché:** se un utente si ricollega mentre la connessione precedente è ancora aperta (secondo tab, rete
  che cambia), `Reconnect` sostituisce il client (`game/room.go:902-906`). Quando il vecchio `ReadPump`
  termina, il suo defer chiama `Room.Leave(vecchioClient)` (`game/client.go:49-51`), che avvia il timer
  d'abbandono per lo **stesso** `UserID`. Dopo 30s il giocatore, pur connesso, perde.
- **Fix proposto:** in `Leave`, ignorare un client che non è più quello registrato nella room
  (confronto per puntatore, non per `UserID`).
- **Nel client:** chiudere del tutto il socket vecchio prima di aprirne uno nuovo (Step 3).

### B3 — Un refresh token viene accettato come access token
- **Stato:** aperta · **Priorità:** P1 (sicurezza)
- **Perché:** `middleware/auth.go:44-61` non controlla il claim `type`: un refresh token (30 giorni) apre `/me`,
  `/users/{id}/games` e `/ws`.
- **Fix proposto:** rifiutare i token con `type != "access"`.

### B4 — `HandleMessage` non verifica che la partita sia finita
- **Stato:** aperta · **Priorità:** P1
- **Perché:** `game/room.go:268` smista mosse e magie anche dopo `endGame`. Il client conserva `client.Room`
  finché il socket resta aperto, e per resign/timeout/abbandono lo status resta `active` (B1).
- **Fix proposto:** rifiutare le azioni di gioco quando la partita è conclusa.

### B5 — Teleport può creare posizioni illegali
- **Stato:** aperta · **Priorità:** P1
- **Perché:** `move_piece` controlla solo il re di chi lancia (`game/room.go:652`). Se in `main1` Teleport dà
  scacco all'avversario, quando chi ha lanciato arriva in fase `move` ha il tratto con il re avversario
  sotto attacco: la posizione è illegale e il comportamento di `IsMoveLegal`/perft di Stockfish non è definito
  (potrebbe permettere di catturare il re).
- **Fix proposto:** rifiutare il Teleport se lascia **uno qualsiasi** dei due re sotto scacco mentre il tratto
  è di chi lancia, oppure dichiararlo un'azione che dà scacco e gestirla esplicitamente.

### B13 — Teleport del re su g1/c1/g8/c8 sposta la torre nel Tracker
- **Stato:** aperta · **Priorità:** P2
- **Perché:** `game/room.go:658` usa `Tracker.MovePiece`, che interpreta un re arrivato su una casella
  d'arrocco come arrocco (`effects/tracker.go:92-94`) e sposta l'identità della torre. La FEN però non cambia:
  gli effetti della torre finiscono sulla casella sbagliata.
- **Fix proposto:** un `Tracker.Relocate(from, to)` senza semantica scacchistica per `move_piece`.

### B14 — Teleport diagonale di un pedone cancella l'identità di un altro pezzo
- **Stato:** aperta · **Priorità:** P2
- **Perché:** lo stesso `MovePiece` tratta un pedone mosso in diagonale su una casella vuota come en passant
  (`effects/tracker.go:77-81`) e rimuove l'identità del pezzo in `to[0]+from[1]`. Gli effetti successivi su quel
  pezzo falliscono con "nessun pezzo da … in X", perché la FEN ha il pezzo ma il Tracker no.
- **Fix proposto:** come B13.

### B6 — `time_control` salvato fisso
- **Stato:** aperta · **Priorità:** P2
- **Perché:** `game/room.go:1003` salva sempre `"10+0"`, ma la partita è 10' + 5" (`config/config.go:61-62`).

### B7 — PGN non standard e incompleto
- **Stato:** aperta · **Priorità:** P2
- **Perché:** `Room.PGN` (`game/room.go:963`) numera mosse UCI, non SAN. Le catture assorbite dallo scudo
  cambiano il tratto senza essere registrate in `Board.Moves` (`game/room.go:356-362`), quindi la numerazione si sfasa.
- **Fix proposto:** registrare una mossa nulla (`--` o `0000`) e, se serve un PGN vero, convertire in SAN.

### B8 — Liste vuote serializzate come `null`
- **Stato:** aperta · **Priorità:** P2
- **Perché:** `handlers/stats.go:37,97` dichiarano slice nil: senza risultati `data` è `null`, non `[]`.
- **Nel client:** l'adapter tratta `null` come lista vuota.

### B9 — CORS non ammette `capacitor://localhost`
- **Stato:** aperta · **Priorità:** P2 (blocca solo iOS)
- **Perché:** `api/router.go:20` ammette `http://*` e `https://*`. Android con `androidScheme: 'https'` va bene;
  iOS usa `capacitor://localhost`.
- **Fix proposto:** aggiungere `capacitor://localhost`.

### B10 — Stesso utente in coda da due connessioni
- **Stato:** aperta · **Priorità:** P2
- **Perché:** la seconda connessione riceve "Sei già in coda" ma resta aperta e inutile (`game/manager.go:59-62`).
  Quando si chiude, `LeaveQueue` confronta per `UserID` e rimuove dalla coda **la prima** (`game/manager.go:103`).
- **Fix proposto:** chiudere la connessione duplicata, oppure sostituire quella in coda.

### B11 — Lo scudo non blocca la cattura en passant
- **Stato:** aperta · **Priorità:** P2 (conferma di design)
- **Perché:** `game/room.go:346` controlla lo scudo solo sulla casella d'arrivo. Documentato come limite noto.

### B12 — Incoerenze minori di rate limit e 404
- **Stato:** aperta · **Priorità:** P2
- **Perché:** le rotte inesistenti rispondono `404 page not found` in testo semplice invece dell'inviluppo JSON
  (`api/router.go`). `POST /auth/refresh` non ha il limiter delle rotte auth (`api/router.go:42`).

### B15 — Il rate limit per IP in realtà vale per connessione
- **Stato:** aperta · **Priorità:** P1 (protezione dal brute force inefficace)
- **Perché:** `getIP` (`middleware/ratelimit.go:96-105`) restituisce `r.RemoteAddr`, che in Go è `ip:porta`.
  Ogni nuova connessione TCP ha quindi un limiter nuovo: il limite auth 3/s si aggira aprendo connessioni.
- **Fix proposto:** `net.SplitHostPort(r.RemoteAddr)` e usare solo l'host; fidarsi di `X-Forwarded-For` solo dietro un proxy noto.
- **Nel mock:** replicato (chiave `indirizzo:porta`).

### P0-1 → P1-8 — Ticket monouso per il WebSocket
- **Stato:** aperta · **Priorità:** P1 (declassata: oggi `?token=` funziona, `middleware/auth.go:30`)
- **Perché:** con `?token=` il JWT finisce nei log di accesso (`api/router.go:16`, `middleware.Logger`) e nella
  cronologia. Un ticket opaco monouso lo evita.
- **Contratto proposto:** `GET /ws/ticket` → `{ticket, expires_in}`; `GET /ws?ticket=…`.
  Nel client cambierebbe solo `src/ws/connection.ts`.

### P1-1 — `GET /spells`
- **Stato:** aperta
- **Perché:** il catalogo (`spells/spells.go:83-95`) è duplicato in `src/spells/fallback.json` e andrà
  ribilanciato spesso.
- **Contratto proposto:** `GET /spells` → `{success:true, data:[Spell…]}`, con `Spell` serializzato dai tag JSON
  già presenti (`id, name, mana_cost, phases, target_type, effects[{kind, params?}]`).

### P1-3 — Codici d'errore macchina-leggibili
- **Stato:** aperta
- **Perché:** `error` è solo `{message}` in italiano (`game/client.go:82`), e la REST risponde `{error: "testo"}`.
  Il client deve riconoscere i testi, che è fragile (ASSUMPTIONS C4).
- **Contratto proposto:** `{ "message": "…", "code": "insufficient_mana", "details": { "needed": 3, "available": 1 } }`.
  Codici: quelli di `src/api/adapter.ts` §3b.

### P2-1 — Scelta del time control
- **Stato:** aperta
- **Perché:** coda unica con time control fisso (`game/manager.go:73`). L'annullamento della coda esiste già:
  basta chiudere il socket (`game/manager.go:99`).

### P2-9 — `time_control` in `game_state`
- **Stato:** aperta
- **Perché:** l'incremento non è visibile al client (`game/room.go:1101`).
- **Contratto proposto:** `"time_control": { "base_ms": 600000, "increment_ms": 5000 }`.

### P2-10 — Password policy esposta
- **Stato:** aperta (era P1-4)
- **Perché:** il client replica `validation/validation.go` per mostrare i requisiti prima del submit.
  Se cambiano sul server, il client va aggiornato a mano.
- **Contratto proposto:** `GET /auth/password-policy`.

### P2-11 — Refresh token in cookie `HttpOnly`
- **Stato:** aperta
- **Perché:** oggi entrambi i token arrivano nel body (`handlers/auth.go:149-158`, `262-268`), quindi il client web
  deve conservarli in `localStorage`, esposto a un eventuale XSS (ASSUMPTIONS C7).
- **Contratto proposto:** `POST /auth/login` e `POST /auth/refresh` impostano
  `Set-Cookie: refresh_token=…; HttpOnly; Secure; SameSite=Strict; Path=/auth`, e `/auth/refresh` legge il cookie.
  L'access token resta nel body e il client lo tiene solo in memoria. Serve anche un `POST /auth/logout` che cancelli
  il cookie. Su Capacitor il body resta necessario: il cookie va affiancato, non sostituito.

---

## Chiuse

| Id | Voce | Stato | Rif. |
|---|---|---|---|
| P0-2 | CORS per lo sviluppo | risolta nel codice (resta B9 per iOS) | `api/router.go:20` |
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
