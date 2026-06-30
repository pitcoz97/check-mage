# Frontend di test — Funzionalità da implementare

Checklist completa delle funzionalità che il client di test ("Chess server web frontend")
deve avere per esercitare **tutto** il server, incluse le modifiche **scacchi + magie**
(Step 1–3 della roadmap in `update.md`).

Spunta `[x]` man mano che implementi. Le sezioni 🆕 sono le novità magia.

---

## 0. Configurazione & connessione

- [ ] Base URL configurabile (default server: `http://localhost:8080`)
- [ ] WebSocket su `ws://localhost:8080/ws`
- [ ] Time control di default lato server: **10 min + 5s** di incremento (solo informativo, lo gestisce il server)
- [ ] Timeout di riconnessione lato server: **30s** (se non ti riconnetti entro, perdi)
- [ ] Tutte le risposte HTTP hanno forma `{ "success": bool, "data"?: ..., "error"?: string }`

---

## 1. Autenticazione (REST)

| Metodo | Endpoint | Body | Risposta |
|---|---|---|---|
| POST | `/auth/register` | `{username, email, password}` | `data: {user_id}` |
| POST | `/auth/login` | `{email, password}` | `data: {tokens:{access_token, refresh_token}, user}` |
| POST | `/auth/refresh` | `{refresh_token}` | `data: {access_token, refresh_token}` |
| GET | `/me` (🔒 JWT) | — | profilo utente |
| GET | `/status` | — | health del server |
| GET | `/leaderboard` | — | classifica ELO |
| GET | `/users/{id}` | — | profilo pubblico |
| GET | `/users/{id}/games` (🔒 JWT) | — | storico partite |

- [ ] **Registrazione** con validazione lato client coerente col server:
  - username 3–20 caratteri, solo `a-z A-Z 0-9 _`
  - email valida
  - password 8–72 caratteri con **almeno** una maiuscola, una minuscola, una cifra
- [ ] **Login** → salva `access_token` e `refresh_token`
- [ ] **Refresh automatico**: l'access token scade dopo **24h**; usa `/auth/refresh` quando ricevi 401
- [ ] Gestione errori auth (409 username/email in uso, 401 credenziali non valide)

---

## 2. Connessione WebSocket

- [ ] Connessione a `/ws` con JWT in **uno** dei due modi:
  - header `Authorization: Bearer <access_token>` **oppure**
  - query param `?token=<access_token>` (necessario nei browser, che non possono settare header custom sul WS)
- [ ] Inviluppo messaggi: ogni messaggio è `{"type": "<tipo>", "payload": { ... }}`
- [ ] Parsing di tutti i tipi server→client (vedi §8)
- [ ] Reagire a `error` (`{message}`) mostrandolo all'utente
- [ ] Rate limit: max ~5 msg/sec per client — non spammare

---

## 3. Matchmaking & lobby

- [ ] Bottone "Trova partita" → apre il WS (entri in coda automaticamente)
- [ ] Stato "in attesa di un avversario" finché non arriva il secondo giocatore
- [ ] Alla creazione partita ricevi `game_state` (stato pubblico) + `hand` (mano privata)
- [ ] Orientamento scacchiera: il primo giocatore in coda è il **Bianco**, il secondo il **Nero**
  - dedurre il proprio colore confrontando il proprio `user_id`/username con `active_player`/stato
  - (nota: il server **non invia ancora** esplicitamente "tu sei bianco/nero" — vedi §10)

---

## 4. Scacchiera & gioco base

- [ ] Rendering board da **FEN** (`game_state.board.fen` è la fonte di verità)
- [ ] Mosse in notazione **UCI**: `{"type":"move","payload":{"move":"e2e4"}}`
  - promozione: `e7e8q` (q/r/b/n)
- [ ] Aggiornare la board a ogni `game_state` (la FEN può cambiare anche per una **magia**, non solo per le mosse)
- [ ] Mostrare la lista mosse (`board.moves`) e lo stato (`board.status`: active/checkmate/stalemate/draw)
- [ ] **Timer** per lato: aggiornati da `timer_update` (`white_time`, `black_time` in **millisecondi**, `turn`)
- [ ] **Resa**: `{"type":"resign"}`
- [ ] **Patta**:
  - offrire: `{"type":"draw_offer"}` → ricevi `draw_offer_sent`
  - l'avversario riceve `draw_offer` (`{from}`)
  - accettare: `{"type":"draw_accepted"}` / rifiutare: `{"type":"draw_declined"}`
  - chi offre riceve `draw_declined` se rifiutata
- [ ] **Fine partita**: `game_over` (`{result, reason, winner?}`)
  - `result`: `1-0` / `0-1` / `1/2-1/2`
  - `reason`: checkmate / stalemate / draw / timeout / resign / agreement / abandonment / server_shutdown

---

## 5. 🆕 Fasi del turno (FSM)

Ogni turno scorre: **`draw → main1 → move → main2 → end_turn`** (poi turno avversario).

- [ ] Mostrare la **fase corrente** e il **giocatore attivo** da `phase_changed` (`{phase, active_player, turn_number}`) e da `game_state` (`phase`, `active_player`, `turn_number`)
- [ ] **Auto-avanzamento lato server** (novità): alcune fasi passano da sole, senza input utente. Il client deve solo **reagire** ai `phase_changed`, anche **più di uno in rapida sequenza** (es. dopo una mossa puoi ricevere `main2 → draw → main1 → move` in un colpo). Non assumere una fase per volta.
  - `draw`: **sempre** auto-passata (la pesca avviene comunque, ricevi `card_drawn`/`mana_changed`). Il client **non** vede mai una `draw` su cui agire.
  - `main1`/`main2`: auto-passate se il giocatore **non può castare nulla** (niente mana sufficiente o niente carte giocabili). Se ha almeno una carta giocabile, la fase resta in attesa di input.
  - `move`: **mai** auto-passata, richiede sempre la mossa.
- [ ] Pulsante **"Passa fase"** (`{"type":"pass_phase"}`): serve solo nelle fasi `main1`/`main2` in cui il server si è fermato perché **puoi** castare ma vuoi saltare. Abilitalo solo lì.
- [ ] Azioni consentite per fase (per il giocatore attivo):

| Fase | Azioni client | Note |
|---|---|---|
| `draw` | — | auto-passata dal server, non la vedi |
| `main1` | `cast_spell`, `pass_phase`, `resign`, `draw_offer` | mostrata solo se hai una carta giocabile |
| `move` | `move`, `resign`, `draw_offer` | mossa **obbligatoria**, **niente** `pass_phase` |
| `main2` | `cast_spell`, `pass_phase`, `resign`, `draw_offer` | mostrata solo se hai una carta giocabile |
| `end_turn` | nessuna | transizione server-side, mai osservata |

- [ ] **Dopo una mossa valida la fase avanza da sola** (a `main2`, e oltre se non castabile) — il client **non** deve mandare `pass_phase` dopo aver mosso
- [ ] Quando non è il tuo turno, disabilita tutti i controlli (il server risponde `error: "Non è il tuo turno"`)

---

## 6. 🆕 Mana, mazzo e mano

- [ ] **Mana** di entrambi i giocatori da `game_state` (`white_mana`/`white_max_mana`, `black_mana`/`black_max_mana`) e da `mana_changed` (`{player, current, max}`)
  - crescita: 1 al 1° turno, +1 ad ogni proprio turno, **cap 10**, ricarica a inizio turno
- [ ] **La tua mano** (carte coperte agli altri) da:
  - `hand` (snapshot completo: `{hand:[id...], mana, max_mana, deck_size}`) — inviato a inizio partita e in riconnessione
  - `card_drawn` (`{card_id, deck_size}`) — quando **tu** peschi
- [ ] **Mano avversaria**: mostra **solo il numero** di carte (`black_hand_size`/`white_hand_size`, e aggiornamenti `hand_size_changed` `{player, size}`) — mai le carte
- [ ] **Dimensione mazzi** di entrambi (`*_deck_size`) — informativa
- [ ] Mano iniziale: **4 carte** per ciascuno; il Bianco **salta la pesca al turno 1** (stile Hearthstone), il Nero pesca al suo primo turno
- [ ] Rendering carta dal catalogo (vedi §9): nome, costo mana, target type

---

## 7. 🆕 Lancio magie (cast_spell)

- [ ] Castabile **solo** in `main1`/`main2`, **se** hai la carta in mano e mana sufficiente
- [ ] Invio: `{"type":"cast_spell","payload":{"spell_id":"<id>","targets":["e7"]}}`
  - `targets` **vuoto** per magie `target_type: none`
  - **un** bersaglio (casella, es. `"e7"`) per `target_type: enemy_piece` (es. `disintegrate`)
- [ ] **UI di targeting**: per le magie che richiedono un bersaglio, far selezionare una casella sulla scacchiera
- [ ] Reagire a `spell_cast` (broadcast a entrambi): `{player, spell_id, targets, effects_applied:[{kind, target?, piece_destroyed?}]}`
  - mostrare animazione/log "X ha lanciato \<nome\>"
  - se `effects_applied` contiene `destroy_piece`, il pezzo in `target` sparisce — ma la board ufficiale arriva comunque col `game_state` successivo (usa quello come verità)
- [ ] Aggiornare mana e dimensione mano dopo il cast (`mana_changed`, `hand_size_changed`)
- [ ] Gestione rifiuti (mostrare l'`error`): casella vuota, pezzo proprio, **re** (mai distruggibile), mana insufficiente, carta non in mano, fase sbagliata
- [ ] Importante: **una magia non passa il turno** — dopo il cast resti nella stessa fase e puoi castarne altre / passare

---

## 7bis. 🆕 Effetti persistenti sui pezzi (freeze / shield)

Alcune magie applicano effetti che **durano nel tempo** e seguono il **pezzo** (non la casella).

- [ ] Renderizzare gli effetti attivi da `game_state.active_effects` (`[{square, effects:[{kind, remaining_turns}]}]`) — es. icona ghiaccio su un pezzo congelato, scudo su un pezzo protetto.
- [ ] Aggiornarli quando arriva un `spell_cast` con `effects_applied` di tipo `freeze_piece`/`shield_piece` (`{kind, target, remaining_turns}`).
- [ ] Rimuoverli quando arriva `effect_expired` (`{square, effect_kind}`).
- [ ] **Freeze**: un pezzo congelato non può muoversi; se il giocatore prova a muoverlo il server risponde `error: "Il pezzo in X è congelato"`. Idealmente disabilita la selezione di quel pezzo.
- [ ] **Shield**: protegge un pezzo proprio e **assorbe una cattura**. Quando l'avversario prova a catturare un pezzo scudato, il server **rifiuta la mossa** (`error`) e **consuma lo scudo** (ricevi `effect_expired` per quella casella). Lo scudo segue il pezzo se questo si muove.
- Durata: `remaining_turns` si riferisce ai **turni del proprietario** del pezzo (freeze 2 = il pezzo resta congelato per 2 turni di chi lo possiede). Il decremento avviene a fine turno; ricevi `effect_expired` quando arriva a 0.
- Decisioni server (per i test): lo scudo protegge **solo dalle catture scacchistiche**, non da `disintegrate`; la cattura *en passant* di un pedone scudato non è bloccata (caso limite).

## 8. Riferimento messaggi WebSocket

### Client → Server

| `type` | `payload` | Quando |
|---|---|---|
| `move` | `{move: "e2e4"}` | solo in fase `move` |
| `pass_phase` | _(nessuno)_ | fasi che lo consentono |
| `cast_spell` | `{spell_id, targets:[]}` | fasi `main1`/`main2` |
| `resign` | _(nessuno)_ | sempre |
| `draw_offer` | _(nessuno)_ | sempre |
| `draw_accepted` | _(nessuno)_ | dopo un'offerta ricevuta |
| `draw_declined` | _(nessuno)_ | dopo un'offerta ricevuta |

### Server → Client

| `type` | `payload` | Destinatario |
|---|---|---|
| `game_state` | `{board:{fen,moves,turn,status}, white_time, black_time, phase, active_player, turn_number, white_mana, white_max_mana, black_mana, black_max_mana, white_hand_size, black_hand_size, white_deck_size, black_deck_size, active_effects:[{square, effects:[{kind, remaining_turns}]}], reconnected?}` | entrambi (pubblico) |
| `hand` | `{hand:[id...], mana, max_mana, deck_size}` | **solo proprietario** |
| `card_drawn` | `{card_id, deck_size}` | **solo chi pesca** |
| `hand_size_changed` | `{player, size}` | entrambi |
| `mana_changed` | `{player, current, max}` | entrambi |
| `phase_changed` | `{phase, active_player, turn_number}` | entrambi |
| `spell_cast` | `{player, spell_id, targets, effects_applied:[{kind, target?, piece_destroyed?, remaining_turns?}]}` | entrambi |
| `effect_expired` | `{square, effect_kind, piece_id?}` | entrambi |
| `timer_update` | `{white_time, black_time, turn}` | entrambi |
| `game_over` | `{result, reason, winner?}` | entrambi |
| `opponent_disconnected` | `{message}` | avversario |
| `opponent_reconnected` | `{message}` | avversario |
| `draw_offer` | `{from}` | avversario |
| `draw_offer_sent` | `{message}` | offerente |
| `draw_declined` | `{message}` | offerente |
| `error` | `{message}` | mittente |

> `*_time` sono in **millisecondi**. `player`/`active_player` valgono `"white"`/`"black"`.

---

## 9. Catalogo magie (set MVP)

| ID | Nome | Costo | Target | Effetto |
|---|---|---|---|---|
| `spark` | Spark | 1 | none | noop (placeholder) |
| `jolt` | Jolt | 2 | none | noop |
| `pulse` | Pulse | 2 | none | noop |
| `surge` | Surge | 3 | none | noop |
| `nova` | Nova | 5 | none | noop |
| `disintegrate` | Disintegrate | 4 | enemy_piece | **destroy_piece** (rimuove un pezzo nemico) |
| `frostbolt` | Frost Bolt | 2 | enemy_piece | **freeze_piece** (congela un pezzo nemico per 2 suoi turni) |
| `aegis` | Aegis | 3 | own_piece | **shield_piece** (protegge un pezzo proprio, assorbe 1 cattura, 2 turni) |

- Mazzo: 40 carte (condiviso/identico per i due giocatori in Fase 1).
- `noop` = la carta costa mana e va nello scarto, ma **non** ha effetti (utile a testare mana/mano).
- `disintegrate` modifica la FEN; `frostbolt`/`aegis` aggiungono **effetti persistenti** ai pezzi (vedi §7bis).
- Bersagli: `enemy_piece`/`own_piece` richiedono **una casella** in `targets` (es. `["e7"]`).

---

## 10. Anti-cheat & note importanti

- [ ] Non mostrare **mai** la mano avversaria né il contenuto dei mazzi: solo dimensioni
- [ ] Fidarsi sempre del `game_state` del server come verità (FEN, mana, turni) — non ricalcolare lo stato lato client
- [ ] Gli effetti delle magie li decide il server (`effects_applied`): il client li visualizza, non li simula

### Limiti noti del server (da tenere a mente nei test)
- ⚠️ **Nessuna persistenza DB dei match live**: se riavvii il server, le partite in corso vanno perse (lo shutdown le chiude come patta). La riconnessione funziona solo a server **acceso**.
- ⚠️ **Niente messaggio esplicito "tu sei bianco/nero"**: vedi §3. Sarebbe utile aggiungerlo lato server (TODO).
- ⚠️ L'orologio segue il lato-al-tratto degli scacchi, non il "giocatore attivo" della FSM: durante `main2` di un giocatore l'orologio può già scorrere per l'avversario. Ininfluente se si passano le fasi main rapidamente.
- ⚠️ Distruggere una torre non azzera ancora i diritti d'arrocco nella FEN.

---

## 11. Scenari di test consigliati

1. **Partita base senza magie**: due client, sequenza completa di mosse fino a scacco matto / resa / patta. Verifica timer, `game_over`, aggiornamento ELO (via `/me` o `/leaderboard`).
2. **Ciclo fasi**: `pass_phase` `draw→main1→` (cast opzionale) `→move` (mossa) `→main2→` `pass_phase` → turno avversario. Verifica che `pass_phase` in `move` venga **rifiutato**.
3. **Mana & pesca**: osserva mana crescere (turni bianco 1/3/5 → 1/2/3), pesca a inizio turno, mano iniziale 4, anti-cheat sulla mano avversaria.
4. **Magia noop**: casta `spark` in `main1` → mana −1, carta nello scarto, `spell_cast` a entrambi, board invariata.
5. **Magia destroy_piece**: con `disintegrate` in mano, casta su un pezzo nemico (es. `e7`) in `main1` → `spell_cast` con `piece_destroyed`, `game_state` con FEN aggiornata; poi una mossa legale successiva deve essere accettata sulla **nuova** posizione.
6. **Rifiuti magia**: casella vuota / pezzo proprio / re / mana insufficiente / carta non in mano / fase sbagliata → `error`, nessun costo.
6bis. **Freeze**: con `frostbolt` congela un pezzo nemico; al suo turno l'avversario non può muoverlo (errore). Dopo `remaining_turns` turni arriva `effect_expired` e il pezzo torna mobile.
6ter. **Shield**: con `aegis` proteggi un tuo pezzo; quando l'avversario tenta di catturarlo la mossa è rifiutata e arriva `effect_expired` (scudo consumato). Al tentativo successivo la cattura va a segno.
7. **Riconnessione**: chiudi e riapri il WS dello stesso utente a partita in corso → ricevi `game_state` (`reconnected: true`) + `hand` privata ripristinata; l'avversario riceve `opponent_reconnected`.
8. **Disconnessione/timeout**: chiudi un client e non riconnetterti per 30s → l'altro vince per `abandonment`.
