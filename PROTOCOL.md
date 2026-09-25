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
| `cast_spell` | `{ "spell_id": "...", "targets": ["e7"], "choice": { "piece": "knight" } }` | `main1`/`main2`; `targets` = una casella per ogni elemento di `targets` della magia, nello stesso ordine; `choice` solo per `promote_piece` e per `revive_piece` con più tipi possibili |
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
| `graveyard_changed` | `{ player, graveyard: ["pawn", …] }`: il cimitero di un giocatore, in ordine | entrambi |
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
  "active_effects": [ { "square": "e7", "effects": [ { "kind": "freeze", "remaining_turns": 1, "source_spell_id": "frost", "caster": "white" } ] } ],
  "white_graveyard": ["pawn"], "black_graveyard": [],
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
`destroy_piece` → `target`, `piece_destroyed`; `freeze_piece`/`shield_piece` →
`target`, `remaining_turns`; `move_piece` → `from`, `to` (anche per il movimento
relativo, dove il client manda solo il pezzo); `summon_pawn` → `target`, `piece`;
`draw_card` → `count` (carte davvero pescate); `gain_mana` → `amount`, `mana`;
`freeze_all`/`shield_area` → `targets` (case colpite), `remaining_turns`;
`swap_pieces` → `targets` (le due case); `transform_piece`/`promote_piece`/
`revive_piece` → `target`, `piece` (il tipo risultante); `restore_castling_rights`
→ nessun campo (arriva il `game_state` con la FEN nuova).

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
| `invalid_target` | un bersaglio non rispetta il suo `TargetSpec` o l'effetto | `index`, `reason`, `square` |
| `illegal_position` | la magia darebbe scacco o lascerebbe sotto scacco il re di chi lancia | `king` |
| `limit_reached` | la magia ha già raggiunto i cast ammessi in questo turno | `spell_id`, `per_turn` |
| `no_effect` | la magia non avrebbe effetto | `reason` |
| `invalid_choice` | `choice` mancante o non ammessa | `reason` |
| `draw_offer_pending` | c'è già un'offerta di patta | — |
| `no_draw_offer` | risposta senza offerta pendente | — |
| `own_draw_offer` | risposta alla propria offerta | — |
| `internal_error` | errore imprevisto | — |

Un `code` sconosciuto va trattato come errore generico.

Valori di `reason` per `invalid_target`: `off_board`, `duplicate`, `not_empty`,
`no_piece`, `wrong_owner`, `king`, `piece_kind`, `missing_effect`, `too_far`,
`rank`, `max_pawns`, `promotion`, `pawn_rank`. Un valore sconosciuto va trattato
come bersaglio non valido generico.

`no_effect` (la magia non avrebbe effetto, cast rifiutato a costo zero) ha
`reason` ∈ `no_pieces`, `empty_graveyard`, `no_castling`; `invalid_choice` ha
`reason` ∈ `missing`, `not_allowed`.

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
- Gli effetti persistenti seguono il **pezzo** (non la casella). La durata conta
  i turni dell'**avversario di chi lancia** (`caster`): `remaining_turns` scende
  alla fine di ciascuno di quei turni. `freeze` 1 blocca il prossimo turno del
  pezzo colpito; `shield` 1 protegge durante il prossimo turno avversario e
  sparisce all'inizio del turno dopo. `remaining_turns` 0 = fino alla fine del
  turno di chi lancia; -1 = permanente.
- **Bersagli.** Ogni magia dichiara in `targets` una lista di `TargetSpec`
  (vedi sotto); il cast manda una casella per elemento, nello stesso ordine. Le
  caselle devono essere distinte e il re non è mai un bersaglio (salvo un
  `own_piece` che lo elenca esplicitamente in `pieces`).
- **Niente scacco da magia**, in `main1` come in `main2`: una magia che tocca la
  scacchiera è rifiutata con `illegal_position` se dà scacco al re avversario o
  lascia sotto scacco il re di chi lancia (se lo era già, la magia deve
  risolvere lo scacco). Se il re avversario era già sotto scacco per la mossa del
  turno, la magia è ammessa. Il matto arriva solo da una mossa.
- **Senza mosse giocabili**: se tutte le mosse legali del giocatore di turno sono
  di pezzi congelati, valgono le regole degli scacchi: re sotto scacco = matto,
  altrimenti stallo. Si verifica dopo ogni mossa, a ogni cambio di turno e dopo
  una magia in `main1` che cambia la scacchiera (un Patto di sangue può lasciare
  senza mosse chi lo lancia).
- **move_piece** sposta un pezzo proprio su una casella vuota senza regole di
  movimento: un re su g1 non arrocca, un pedone in diagonale non cattura en
  passant. Con `relative: "forward"` il client manda solo il pezzo e il server
  calcola l'arrivo (`squares` passi in avanti per chi lancia); con
  `no_promotion` non si arriva all'ultima traversa.
- Una magia che toglie o sposta il pedone appena spinto di due azzera la casella
  en passant della FEN.
- **Limiti per turno** (`limits.per_turn`): oltre il limite il cast è rifiutato
  con `limit_reached`; il conteggio riparte all'inizio di ogni turno del
  giocatore. Una carta al limite non tiene aperta la fase main.
- Una magia non cambia mai il tratto e non fa avanzare la fase (l'auto-avanzamento
  scatta solo se, dopo il cast, non resta nulla di castabile).

## Catalogo magie

Il catalogo segue `docs/BRIEFING-MAGIE.md` e cresce per step: oggi contiene le 18
magie degli Step 1 e 2. Disponibile via `GET /spells`:

```json
{ "id": "blink", "name": "Blink", "mana_cost": 4, "phases": ["main1", "main2"],
  "targets": [ { "type": "own_piece", "pieces": ["knight", "bishop"] },
               { "type": "square", "empty_square": true, "max_distance": 2 } ],
  "effects": [ { "kind": "move_piece", "params": { "no_check": true } } ],
  "tags": ["arcano"], "rarity": "common" }
```

`TargetSpec`: `type` ∈ `square`/`own_piece`/`enemy_piece`; opzionali `pieces`
(ammessi; assente = tutti tranne il re), `require_effect` (stato richiesto, es.
`freeze`), `empty_square`, `max_distance` (Chebyshev dal bersaglio precedente),
`own_ranks` e `min_rank` (traverse relative a chi lancia, 1 = la sua prima).
`targets` vuoto = nessun bersaglio. `rarity` ∈ `common`/`legendary`; `limits`
(opzionale) = `{ "per_turn": n }`.

| ID | Nome | Costo | Bersagli | Effetto |
|----|------|-------|----------|---------|
| `frost` | Brina | 1 | pedone nemico | `freeze_piece` 1 |
| `ice_chain` | Catena di ghiaccio | 3 | cavallo o alfiere nemico | `freeze_piece` 1 |
| `shatter` | Frantumare | 4 | pezzo nemico congelato, non regina | `destroy_piece` |
| `blood_pact` | Patto di sangue | 0 | proprio pedone | `destroy_piece` + `gain_mana` 2 (cap 10), 1 per turno |
| `blink` | Blink | 4 | proprio pezzo minore + casa vuota entro 2 | `move_piece` |
| `shield` | Scudo | 2 | proprio pezzo, non regina né re | `shield_piece` 1 |
| `royal_shield` | Scudo reale | 4 | propria regina | `shield_piece` 1 |
| `forced_march` | Marcia forzata | 1 | proprio pedone | `move_piece` avanti di 1, senza cattura né promozione |
| `conscription` | Leva militare | 4 | casa vuota della propria 2ª traversa | `summon_pawn` (massimo 8 pedoni) |
| `eternal_winter` | Inverno eterno (leggendaria) | 7 | — | `freeze_all` sui pedoni nemici, 1 |
| `recall` | Richiamo | 3 | casa vuota della propria 2ª traversa | `revive_piece` di un pedone |
| `resurrection` | Resurrezione (leggendaria) | 8 | casa vuota della propria 1ª traversa | `revive_piece` di cavallo, alfiere o torre (`choice`) |
| `swap` | Scambio | 3 | due propri pezzi, non il re | `swap_pieces` |
| `metamorphosis` | Metamorfosi | 5 | proprio cavallo o alfiere | `transform_piece` cavallo ↔ alfiere |
| `royal_guard` | Guardia reale | 3 | — | `shield_area` ai propri pezzi attorno al re, 1 |
| `divine_castling` | Arrocco divino | 4, solo main1 | — | `restore_castling_rights` |
| `phalanx` | Falange | 3 | — | `shield_area` ai propri pedoni con un pedone accanto sulla traversa, 1 |
| `early_promotion` | Promozione anticipata (leggendaria) | 6 | proprio pedone dalla 6ª traversa | `promote_piece` (`choice`) |

**Cimitero.** Ogni pezzo tolto dalla scacchiera (cattura, anche en passant, o
magia) va nel cimitero del proprietario con il tipo che aveva; la cattura
assorbita da uno scudo no. Richiamo e Resurrezione ne tolgono la prima
occorrenza del tipo riportato, che torna con un id nuovo e senza effetti.
**Scambio** non può portare un pedone sulla 1ª o sull'8ª traversa (`pawn_rank`).
**Arrocco divino** ripristina il diritto solo dove re e torre sono sulle case
iniziali; arroccare attraverso case attaccate resta vietato.

Mazzo: 40 carte, identico per i due giocatori. Finché il catalogo non è
completo la ricetta supera i limiti di copie della rarità (2 comuni, 1
leggendaria), che valgono per la ricetta finale.

## Limiti noti

- Le partite in corso sono persistite in Postgres: un riavvio del server non le
  perde e i giocatori possono riconnettersi (le room ripristinate restano
  dormienti finché qualcuno non si riconnette).
- Il PGN salvato nel DB usa mosse UCI numerate (non SAN) e non registra le magie.
