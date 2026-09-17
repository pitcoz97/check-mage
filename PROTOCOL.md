# WebSocket Protocol — Chess + Magic

Riferimento autoritativo del protocollo realtime del server. Le modifiche
rispetto al commit `7f817e5` sono riassunte in
[docs/SERVER-CHANGES.md](docs/SERVER-CHANGES.md).

## Connessione

- Endpoint: `GET /ws` (upgrade a WebSocket).
- Autenticazione, in **uno** dei tre modi:
  - **consigliato:** ticket monouso. `GET /ws/ticket` (con `Authorization: Bearer <access_token>`)
    risponde `{ticket, expires_in}`; poi si apre `/ws?ticket=<ticket>` entro
    `expires_in` secondi (30). Il ticket vale una sola volta.
  - header `Authorization: Bearer <access_token>`;
  - query param `?token=<access_token>` (supportato, ma il JWT finisce nei log).
- Solo gli **access token** sono accettati: un refresh token riceve 401.
- Appena due giocatori sono in coda viene creata una `Room`; il primo in coda è
  il **Bianco**, il secondo il **Nero**. L'identità dei giocatori arriva nel
  primo `game_state` (`white_player` / `black_player`).
- Se lo stesso utente apre una seconda connessione (in coda o in partita), la
  connessione nuova prende il posto di quella vecchia: la vecchia riceve un
  `error` con `code: "replaced_by_new_connection"` e viene chiusa con codice
  WebSocket **4001**.
- Heartbeat: il server manda un ping ogni ~54s e chiude la connessione se non
  riceve nulla (pong o messaggi) per 60s. I browser rispondono ai ping da soli.
- Dimensione massima di un messaggio in arrivo: 4096 byte.
- Rate limit: ~5 messaggi/secondo per client (oltre: `error` con `code: "rate_limited"`).

## Inviluppo messaggi

Ogni messaggio (in entrambe le direzioni) è JSON:

```json
{ "type": "<tipo>", "payload": { ... } }
```

`player`/`active_player` valgono `"white"` o `"black"`. I tempi (`*_time`) sono
in **millisecondi**. Le caselle sono in notazione algebrica (`"e4"`); le mosse
in **UCI** (`"e2e4"`, promozione `"e7e8q"`).

## Fasi del turno

Sequenza fissa per turno: `draw → main1 → move → main2 → end_turn` (poi il turno
passa all'avversario). Il server **auto-avanza** le fasi che non richiedono
input, quindi il client può ricevere più `phase_changed` in sequenza. `draw`
viene notificata al cambio di turno; `end_turn` non viene mai notificata.

| Fase | Auto-avanza? | Azioni client |
|------|-------------|---------------|
| `draw` | sempre (la pesca avviene comunque) | — |
| `main1` | se il giocatore non può castare nulla | `cast_spell`, `pass_phase` |
| `move` | mai | `move` (obbligatoria) |
| `main2` | se il giocatore non può castare nulla | `cast_spell`, `pass_phase` |
| `end_turn` | transizione server-side | — |

`resign` / `draw_offer` sono ammessi in qualunque momento della partita. Dopo
una mossa valida la fase avanza da sola (il client non manda `pass_phase`).

## Client → Server

| `type` | `payload` | Note |
|--------|-----------|------|
| `move` | `{ "move": "e2e4" }` | solo in fase `move` |
| `pass_phase` | _(nessuno)_ | solo in `main1`/`main2` |
| `cast_spell` | `{ "spell_id": "...", "targets": ["e7"] }` | `main1`/`main2`; `targets` secondo il tipo (0/1/2 caselle) |
| `resign` | _(nessuno)_ | |
| `draw_offer` | _(nessuno)_ | una sola offerta pendente per volta |
| `draw_accepted` | _(nessuno)_ | in risposta a `draw_offer` |
| `draw_declined` | _(nessuno)_ | in risposta a `draw_offer` |

Dopo `game_over` ogni azione riceve `error` con `code: "game_over"`.

## Server → Client

| `type` | `payload` | Destinatario |
|--------|-----------|--------------|
| `game_state` | vedi sotto | entrambi (pubblico) |
| `timer_update` | `{ white_time, black_time, turn }` | entrambi, ~1/s (`turn` = giocatore attivo, di chi scorre il tempo) |
| `phase_changed` | `{ phase, active_player, turn_number }` | entrambi |
| `hand` | `{ hand:[id...], mana, max_mana, deck_size }` | **solo proprietario** |
| `card_drawn` | `{ card_id, deck_size }` | **solo chi pesca** |
| `hand_size_changed` | `{ player, size }` | entrambi |
| `mana_changed` | `{ player, current, max }` | entrambi |
| `spell_cast` | `{ player, spell_id, targets, effects_applied:[...] }` | entrambi |
| `effect_expired` | scadenza: `{ square, effect_kind, piece_id }`; scudo consumato: `{ square, effect_kind: "shield", reason: "shield_absorbed" }` | entrambi |
| `game_over` | `{ result, reason, winner? }` | entrambi |
| `draw_offer` | `{ from }` | avversario |
| `draw_offer_sent` | `{ message }` | offerente |
| `draw_declined` | `{ message, reason }` — `reason`: `"declined"` (rifiutata) o `"move_played"` (decaduta: l'avversario ha mosso) | offerente |
| `opponent_disconnected` | `{ message }` | avversario |
| `opponent_reconnected` | `{ message }` | avversario |
| `error` | `{ message, code, details? }` | mittente |

I campi `message` sono testo in italiano per il debug: il client deve basarsi
su `type`, `code` e `reason`.

### `game_state` (stato pubblico)

Arriva all'avvio della partita, dopo ogni mossa, dopo ogni magia che modifica la
scacchiera, alla riconnessione (con `reconnected: true`) e subito **prima** di
`game_over` (con lo `status` finale).

```json
{
  "board": { "fen": "...", "moves": ["e2e4", "0000"], "turn": "white", "status": "active" },
  "white_player": { "id": 42, "username": "mario" },
  "black_player": { "id": 7, "username": "luigi" },
  "time_control": { "base_ms": 600000, "increment_ms": 5000 },
  "white_time": 600000, "black_time": 600000,
  "phase": "main1", "active_player": "white", "turn_number": 1,
  "white_mana": 1, "white_max_mana": 1, "black_mana": 1, "black_max_mana": 1,
  "white_hand_size": 4, "black_hand_size": 4,
  "white_deck_size": 36, "black_deck_size": 36,
  "active_effects": [ { "square": "e7", "effects": [ { "kind": "freeze", "remaining_turns": 2, "source_spell_id": "frostbolt" } ] } ],
  "reconnected": true
}
```

- La **FEN è la fonte di verità** della scacchiera (aggiornata sia dalle mosse
  sia dalle magie che editano la board). Il client non ricalcola lo stato.
- `board.moves` contiene le mosse UCI; `"0000"` indica una mossa consumata senza
  spostare pezzi (cattura assorbita da uno scudo). Le magie non compaiono nella
  lista, quindi `moves` non basta a ricostruire la posizione.
- `board.status`: `active`, `checkmate`, `stalemate`, `draw`, `resigned`,
  `timeout`, `abandoned`. Tutti i valori diversi da `active` sono terminali.
- `active_effects` è ordinato per casella.

### `game_over`

`result`: `1-0`, `0-1`, `1/2-1/2`. `winner` (username) è presente solo se c'è un
vincitore.

| `reason` | `board.status` |
|----------|----------------|
| `checkmate` | `checkmate` |
| `stalemate` | `stalemate` |
| `draw` (50 mosse, materiale insufficiente, tripla ripetizione) | `draw` |
| `agreement` | `draw` |
| `resign` | `resigned` |
| `timeout` | `timeout` |
| `abandonment` | `abandoned` |

Viene inviato **una sola volta** per partita.

### `effects_applied` (in `spell_cast`)

Lista di oggetti `{ kind, ... }` con campi specifici per effetto:
`noop` → nessun campo; `destroy_piece` → `target`, `piece_destroyed`;
`freeze_piece`/`shield_piece` → `target`, `remaining_turns`; `move_piece` →
`from`, `to`; `draw_card` → `count`; `gain_mana` → `amount`, `mana`.

### `error`

```json
{ "message": "mana insufficiente: servono 4, hai 1", "code": "insufficient_mana", "details": { "needed": 4, "available": 1 } }
```

| `code` | Quando | `details` |
|--------|--------|-----------|
| `invalid_payload` | JSON o payload malformato | — |
| `unknown_message_type` | `type` non gestito | `type` |
| `rate_limited` | troppi messaggi | — |
| `game_over` | azione su una partita conclusa | — |
| `replaced_by_new_connection` | un'altra connessione dello stesso utente ha preso il posto di questa | — |
| `not_your_turn` | azione fuori turno | — |
| `wrong_phase` | mossa, pass o magia nella fase sbagliata | `phase` |
| `illegal_move` | mossa illegale | `move` |
| `piece_frozen` | il pezzo da muovere è congelato | `square` |
| `unknown_spell` | `spell_id` inesistente | `spell_id` |
| `card_not_in_hand` | carta non in mano | `spell_id` |
| `insufficient_mana` | mana insufficiente | `needed`, `available` |
| `invalid_target_count` | numero di bersagli errato | `expected`, `received` |
| `invalid_target` | casella non valida o vuota, pezzo del colore sbagliato, re non distruggibile, destinazione occupata | — |
| `illegal_position` | la magia lascerebbe un re sotto scacco in modo illegale | `king` |
| `draw_offer_pending` | c'è già un'offerta di patta | — |
| `no_draw_offer` | risposta senza offerta pendente | — |
| `own_draw_offer` | risposta alla propria offerta | — |
| `internal_error` | errore imprevisto | — |

Un `code` sconosciuto va trattato come errore generico.

## Anti-cheat

- Il client vede **solo la propria mano** (`hand`/`card_drawn`); dell'avversario
  conosce solo dimensione mano/mazzo e mana.
- Il server è autoritativo: applica lui gli effetti e li comunica; il client li
  visualizza soltanto.

## Regole magiche rilevanti per il client

- **freeze**: un pezzo congelato non può muoversi (`error` `piece_frozen`).
- **shield**: assorbe una cattura, anche **en passant**. Il pezzo sopravvive ma
  l'attaccante consuma comunque la mossa (`"0000"` in `board.moves`); arriva
  `effect_expired` con `reason: "shield_absorbed"` e `square` = casella del pezzo
  protetto. Eccezione: se la cattura è l'unico modo in cui l'attaccante esce
  dallo scacco, lo scudo **si rompe** e la cattura avviene normalmente (il pezzo
  sparisce con il suo scudo, senza `effect_expired`).
- Gli effetti persistenti seguono il **pezzo** (non la casella) e durano
  `remaining_turns` turni del proprietario.
- **Magie che modificano la scacchiera** (Disintegrate, Teleport) sono rifiutate
  con `illegal_position` se lasciano sotto scacco il re di chi **non** ha il
  tratto. In pratica:
  - in `main1` (il tratto è di chi lancia) non possono dare scacco
    all'avversario;
  - in `main2` (il tratto è dell'avversario) possono dare scacco, e se è matto
    la partita finisce al cambio di turno;
  - Teleport non può mai lasciare sotto scacco il re di chi lancia.
- **Teleport** sposta un pezzo proprio su una casella vuota senza regole di
  movimento: un re su g1 non arrocca, un pedone in diagonale non cattura en
  passant.
- **Disintegrate** non può bersagliare il re.
- Una magia non cambia mai il tratto e non fa avanzare la fase (l'auto-avanzamento
  scatta solo se, dopo il cast, non resta nulla di castabile).

## Catalogo magie (set MVP)

Disponibile anche via `GET /spells` (`data: [{ id, name, mana_cost, phases, target_type, effects:[{kind, params?}] }]`).

| ID | Nome | Costo | Target | Effetto |
|----|------|-------|--------|---------|
| `spark`/`jolt`/`pulse`/`surge`/`nova` | — | 1/2/2/3/5 | none | `noop` (placeholder) |
| `disintegrate` | Disintegrate | 4 | enemy_piece | distrugge un pezzo nemico |
| `frostbolt` | Frost Bolt | 2 | enemy_piece | congela un pezzo nemico (2 turni) |
| `aegis` | Aegis | 3 | own_piece | scudo su un pezzo proprio (2 turni) |
| `insight` | Insight | 1 | none | pesca 1 carta |
| `channel` | Channel | 0 | none | +2 mana questo turno |
| `teleport` | Teleport | 3 | piece_move | sposta un pezzo proprio su casella vuota |

Mazzo: 40 carte (in Fase 1 identico per i due giocatori).

## Limiti noti

- Le partite in corso sono persistite in Postgres: un riavvio del server non le
  perde e i giocatori possono riconnettersi (le room ripristinate restano
  dormienti finché qualcuno non si riconnette).
- Il rilevamento di matto/stallo considera legali anche le mosse dei pezzi
  congelati: se le uniche mosse legali sono di pezzi congelati, la partita non
  finisce e il giocatore può solo attendere il timeout o abbandonare.
- Il PGN salvato nel DB usa mosse UCI numerate (non SAN) e non registra le magie.
