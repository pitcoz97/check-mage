# BACKEND-REQUESTS

Registro vivo delle modifiche da chiedere al server Go. Si applica allo Step 7.
Ogni voce indica cosa serve, perché, il contratto proposto, la priorità e lo stato.
I riferimenti `G*`/`A*`/`M*` rimandano a `ASSUMPTIONS.md`.

Priorità: **P0** senza questa il client non funziona · **P1** senza questa la UX è degradata ·
**P2** serve una conferma o un miglioramento.
Stati: `aperta` · `accettata` · `applicata` · `rifiutata`.

---

## P0-1 — Ticket monouso per l'autenticazione WebSocket
- **Stato:** aperta
- **Perché:** l'API WebSocket del browser non permette header custom; oggi `/ws` vuole
  `Authorization: Bearer`, quindi il client web non si connette mai (briefing §3.5).
- **Contratto proposto:**
  ```jsonc
  // GET /ws/ticket   (Authorization: Bearer <jwt>)
  200 { "ticket": "b5f1…", "expires_in": 45 }   // opaco, monouso, TTL 30–60s, in memoria
  // GET /ws?ticket=b5f1…   → upgrade; ticket consumato; 401 se scaduto/usato/ignoto
  ```
- **Nota:** il JWT non deve mai comparire in un URL.

## P0-2 — CORS per sviluppo e Capacitor
- **Stato:** aperta
- **Perché:** senza queste origini la build web in dev e quella Android non riescono a chiamare le API.
- **Contratto proposto:** `go-chi/cors` con `AllowedOrigins: ["http://localhost:5173",
  "capacitor://localhost", "http://localhost"]`, `AllowedHeaders: ["Authorization", "Content-Type"]`,
  metodi `GET, POST, OPTIONS`.

## P0-3 — `pieces[]` con `piece_id` in `game_state`
- **Stato:** aperta
- **Perché:** gli effetti viaggiano per `piece_id` ma la FEN non ha identificativi (G1).
- **Contratto proposto:**
  ```jsonc
  { "type": "game_state", "payload": {
      "board": { "fen": "…", "moves": ["e2e4"], "turn": "black", "status": "active" },
      "white_time": 598000, "black_time": 600000,
      "pieces": [ { "piece_id": "pc_12", "square": "e4", "type": "p", "color": "white",
                    "effects": [ { "kind": "freeze", "remaining_turns": 2 } ] } ] } }
  ```

## P0-4 — Id d'istanza per le carte in mano
- **Stato:** aperta
- **Perché:** più copie della stessa magia in mano; inoltre `card_drawn` oggi non dice quale magia è (G2).
- **Contratto proposto:**
  ```jsonc
  { "type": "card_drawn", "payload": { "card_id": "c_31", "spell_id": "ice_age" } }
  { "type": "cast_spell", "payload": { "spell_id": "ice_age", "card_id": "c_31", "targets": ["d7"] } }
  ```
  `card_id` nel cast è opzionale lato server finché il client non lo invia (oggi non lo invia).

## P1-1 — `GET /spells`
- **Stato:** aperta
- **Perché:** il catalogo non va duplicato nel client (§5.1, G10).
- **Contratto proposto:**
  ```jsonc
  // GET /spells  (pubblico o protetto)
  200 [ { "id": "ice_age", "name": "Ice Age", "mana_cost": 3, "phases": ["main1","main2"],
          "target_type": "enemy_piece",
          "effects": [ { "kind": "freeze_piece", "params": { "turns": 2 } } ] } ]
  ```

## P1-2 — Stato completo del layer magie in `game_start` e alla riconnessione
- **Stato:** aperta
- **Perché:** senza, la mano è vuota dopo un reconnect e la partita è ingiocabile (G4, G5).
- **Contratto proposto:**
  ```jsonc
  { "type": "game_start", "payload": {
      "room_id": "room-1-2", "white": "mario", "black": "luigi", "fen": "…", "moves": [],
      "white_time": 600000, "black_time": 600000,
      "time_control": { "initial_ms": 600000, "increment_ms": 0 },
      "pieces": [ /* come P0-3 */ ],
      "phase": "draw", "active_player": "mario", "turn_number": 1,
      "hand": [ { "card_id": "c_1", "spell_id": "shield" } ],      // solo la mano del destinatario
      "hand_sizes": { "mario": 4, "luigi": 4 },
      "deck_sizes": { "mario": 36, "luigi": 36 },
      "mana": { "mario": { "current": 1, "max": 1 }, "luigi": { "current": 1, "max": 1 } } } }
  ```
  Alla riconnessione entro `RECONNECT_TIMEOUT` va rimandato lo stesso messaggio.

## P1-3 — `error` strutturato con codice macchina-leggibile
- **Stato:** aperta
- **Perché:** servono toast specifici e il rollback dell'azione giusta (G6, G7).
- **Contratto proposto:**
  ```jsonc
  { "type": "error", "payload": { "code": "insufficient_mana", "message": "…",
                                  "rejected": "cast_spell" } }   // "rejected": type del messaggio rifiutato
  ```
  Codici suggeriti: quelli di M11 in `ASSUMPTIONS.md`.

## P1-4 — Contratto auth documentato + password policy esposta
- **Stato:** aperta
- **Perché:** body e risposte di `/auth/*` non sono documentati, e i requisiti password vanno mostrati
  prima del submit senza hardcodarli nel client (A11, A12).
- **Contratto proposto:**
  ```jsonc
  // GET /auth/password-policy
  200 { "username": { "min": 3, "max": 20, "pattern": "^[A-Za-z0-9_]+$" },
        "password": { "min": 8, "max": 72 } }
  // POST /auth/login → 200 { "token": "…", "user": { "id": 1, "username": "mario", "elo": 1200 } }
  // errori: { "error": "<codice>" }
  ```

## P1-5 — Aggiornamento della dimensione dei mazzi
- **Stato:** aperta
- **Perché:** §2 chiede di mostrare la dimensione dei mazzi, ma nessun messaggio la aggiorna (A14).
- **Contratto proposto:** `{ "type": "hand_size_changed", "payload": { "player": "luigi", "size": 5, "deck_size": 31 } }`.

## P1-6 — Notifica di riconnessione dell'avversario
- **Stato:** aperta
- **Perché:** dopo `opponent_disconnected` il client non sa quando togliere il banner (A16).
- **Contratto proposto:**
  `{ "type": "opponent_reconnected", "payload": {} }`; `opponent_disconnected` con
  `{ "reconnect_deadline_ms": 30000 }` per mostrare il tempo residuo (§8).

## P2-1 — Scelta del time control e annullamento della coda
- **Stato:** aperta
- **Perché:** oggi `/ws` mette in coda e basta (G9).
- **Contratto proposto:** `{ "type": "queue_join", "payload": { "time_control": "10+0" } }`,
  `{ "type": "queue_leave", "payload": {} }`, server → `{ "type": "queue_status", "payload": { "state": "searching" } }`.

## P2-2 — Conferme su Fireball e Teleport
- **Stato:** aperta
- **Perché:** §3.4. Fireball non deve poter bersagliare il re; Teleport non deve far avanzare la fase.
- **Richiesta:** confermare entrambi i comportamenti lato Go. Se non valgono, sono bug del server.

## P2-3 — Conferma delle regole di gioco non documentate
- **Stato:** aperta
- **Perché:** il mock implementa M1–M12 per essere severo; se il server fa diversamente, il mock va allineato.
- **Richiesta:** confermare o correggere M1–M12, e lo spazio dei `kind` di stato dei pezzi (A18).

## P2-5 — Numero e natura dei bersagli nel catalogo
- **Stato:** aperta
- **Perché:** `target_type` descrive un solo bersaglio, ma Teleport ne richiede due (A19). Il client non
  deve dedurlo dall'id della magia.
- **Contratto proposto:** in ogni effetto, un campo che dichiara i bersagli aggiuntivi, es.
  `{ "kind": "move_piece", "params": {}, "extra_targets": ["legal_empty_square"] }`, oppure a livello di magia
  `"targets": [{ "type": "own_piece" }, { "type": "legal_empty_square" }]`.

## P2-4 — Notifica del rifiuto di patta
- **Stato:** aperta
- **Perché:** chi offre patta non sa se l'offerta è stata rifiutata (A17).
- **Contratto proposto:** server → offerente `{ "type": "draw_declined", "payload": { "by": "luigi" } }`.
