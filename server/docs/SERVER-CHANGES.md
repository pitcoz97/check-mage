# SERVER-CHANGES — modifiche al server per il client

Modifiche al server Go fatte in risposta a [BACKEND-REQUESTS.md](BACKEND-REQUESTS.md) e ai bug emersi dalla
revisione del codice. Il riferimento di partenza è il commit `7f817e5`; le modifiche stanno sul branch
`fix/backend-requests` (a partire da `main`, in cui è stato unito `feat/magic-chess-step1`).

Il protocollo completo e aggiornato è in [PROTOCOL.md](../PROTOCOL.md). Questo documento elenca solo **cosa è
cambiato** e **cosa deve fare il client**.

---

## 1. Da fare nel client (in ordine di impatto)

| # | Cosa cambia | Azione nel client | Voci |
|---|---|---|---|
| 1 | `game_state` contiene `white_player` e `black_player` `{id, username}` | Ricavare il colore confrontando `id` con l'utente di `/me`; togliere `players: null` e il warning C1 dall'adapter | P0-5, C1 |
| 2 | `error` ha `code` (sempre) e `details` (a volte) | Usare `code` al posto della tabella dei testi; tenere il testo solo come fallback per codici sconosciuti | P1-3, C2, C4, G6 |
| 3 | `board.status` ha tre valori terminali nuovi: `resigned`, `timeout`, `abandoned` | Aggiungerli all'enum; ogni valore diverso da `active` è terminale | B1, A15 |
| 4 | Una seconda connessione dello stesso utente **chiude la prima**: `error` `replaced_by_new_connection`, poi chiusura WebSocket con codice **4001** | Alla chiusura 4001 **non** riconnettersi in automatico (altrimenti due tab si scalzano a vicenda); mostrare "partita aperta altrove" | B2, B10 |
| 5 | Nuovo `GET /ws/ticket` → `{ticket, expires_in: 30}`; `/ws?ticket=…` | Cambiare solo `src/ws/connection.ts`: chiedere un ticket prima di ogni apertura (anche a ogni riconnessione, il ticket è monouso) | P1-8 |
| 6 | Nuovo `GET /spells` | Caricare il catalogo da qui; `fallback.json` resta solo come riserva | P1-1, C3, G10 |
| 7 | `board.moves` può contenere `"0000"` (mossa assorbita da uno scudo) | Non passarlo a chess.js; mostrarlo nello storico come mossa annullata | B7 |
| 8 | `draw_declined` ha `reason`: `"declined"` oppure `"move_played"` (l'offerta decade quando chi l'ha ricevuta muove) | Chiudere l'offerta pendente in entrambi i casi. Chi riceve l'offerta non riceve nulla quando muove: deve scartarla da sé dopo la propria mossa | — |
| 9 | `game_state` arriva **prima** di ogni `game_over`, con lo `status` finale | Nessuna azione obbligatoria; la mossa decisiva ora è visibile | — |
| 10 | Dopo `game_over` ogni azione riceve `error` `game_over` | Può sostituire il filtro client-side sugli eventi dopo il primo `game_over` (tenerlo comunque come difesa) | B4 |
| 11 | Heartbeat: ping del server ogni ~54s, connessione chiusa dopo 60s senza traffico | Nessuna azione nel browser (pong automatico). Su mobile un'app in background perde il socket; il timer d'abbandono (30s) parte quando il server se ne accorge | — |
| 12 | Magie rifiutate con `illegal_position` | Vedi §4: in `main1` Teleport e Disintegrate non possono dare scacco | B5 |
| 13 | Un refresh token su `/me`, `/users/{id}/games`, `/ws` riceve **401** | Usare sempre l'access token; se oggi il client manda il refresh token per errore, ora se ne accorge | B3 |
| 14 | Liste vuote come `[]` | L'adapter può smettere di trattare `null` come lista vuota (innocuo tenerlo) | B8 |
| 15 | 404 e 405 in JSON `{success:false, error}` | Nessuna azione | B12 |
| 16 | `game_state.time_control` `{base_ms, increment_ms}` | Mostrare l'incremento | P2-9 |
| 17 | Nuovo `GET /auth/password-policy` | Leggere i requisiti da qui invece di replicare `validation.go` | P2-10 |

---

## 2. Stato delle voci di BACKEND-REQUESTS

| Id | Voce | Stato | Note |
|---|---|---|---|
| P0-5 | Identità dei giocatori | **applicata** | Opzione preferita: campi in `game_state` (quindi anche alla riconnessione). `game_start` non esiste ancora. |
| B1 | Partita `active` dopo resign/timeout/abbandono | **applicata** | La partita si chiude una sola volta: un solo `game_over`, un solo salvataggio, ELO aggiornato una volta. |
| B2 | Il socket vecchio fa perdere per abbandono | **applicata** | `Leave` ignora le connessioni sostituite; in più `Reconnect` chiude la vecchia (4001). |
| B3 | Refresh token accettato come access token | **applicata** | Anche: solo HS256, claim `user_id`/`username` obbligatori. |
| B4 | Azioni dopo la fine | **applicata** | `error` `game_over`. |
| B5 | Teleport crea posizioni illegali | **applicata** | Regola estesa anche a Disintegrate, vedi §4. |
| B6 | `time_control` fisso | **applicata** | Salvato come `"10+5"` (minuti+secondi) dalla configurazione. |
| B7 | PGN non standard | **applicata in parte** | Mossa assorbita = `0000` in `moves`, `--` nel PGN, così la numerazione non si sfasa. Il PGN resta in UCI (niente SAN). |
| B8 | Liste `null` | **applicata** | |
| B9 | CORS `capacitor://localhost` | **applicata** | Origini configurabili con `CORS_ALLOWED_ORIGINS`; il default include `capacitor://localhost`. |
| B10 | Stesso utente in coda due volte | **applicata** | La connessione nuova sostituisce la vecchia (4001). Il vecchio errore "Sei già in coda" non esiste più. |
| B11 | Scudo ed en passant | **applicata** | Lo scudo blocca anche l'en passant. |
| B12 | 404 testuale, refresh senza limiter | **applicata** | `/auth/refresh` ora ha il limite auth (3/s, burst 5). |
| B13 | Teleport del re su g1/c1/g8/c8 | **applicata** | |
| B14 | Teleport diagonale di un pedone | **applicata** | |
| B15 | Rate limit per connessione | **applicata** | Chiave = IP senza porta. `X-Forwarded-For`/`X-Real-IP` valgono solo da proxy in `TRUSTED_PROXIES`. |
| P1-8 | Ticket monouso per il WebSocket | **applicata** | `?token=` e header Bearer restano validi. |
| P1-1 | `GET /spells` | **applicata** | Forma `data: [Spell]` come proposto, ordinata per `mana_cost` e poi `id`. |
| P1-3 | Codici d'errore | **applicata** | Codici in §3: confrontarli con quelli di `adapter.ts` §3b, i nomi possono differire. |
| P2-9 | `time_control` in `game_state` | **applicata** | |
| P2-10 | Password policy | **applicata** | |
| P2-1 | Scelta del time control | **non applicata** | Richiede più code di matchmaking: da decidere insieme (quali cadenze, UI della lobby). |
| P2-11 | Refresh token in cookie HttpOnly | **non applicata** | Serve prima decidere il dominio di produzione: con un cookie servono CORS con credenziali e origini esplicite (niente `http://*`), più protezione CSRF su `/auth/refresh`. Per ora i token restano nel body. |

---

## 3. Codici d'errore WebSocket

Payload: `{ "message": "…", "code": "…", "details"?: {…} }`. `message` resta in italiano, solo per il debug.

| `code` | Quando | `details` |
|---|---|---|
| `invalid_payload` | JSON o payload malformato | — |
| `unknown_message_type` | `type` non gestito | `type` |
| `rate_limited` | più di ~5 messaggi/s | — |
| `game_over` | azione su una partita conclusa | — |
| `replaced_by_new_connection` | un'altra connessione dello stesso utente ha preso il posto di questa | — |
| `not_your_turn` | azione fuori turno | — |
| `wrong_phase` | mossa, pass o magia nella fase sbagliata | `phase` |
| `illegal_move` | mossa illegale | `move` |
| `piece_frozen` | pezzo congelato | `square` |
| `unknown_spell` | `spell_id` inesistente | `spell_id` |
| `card_not_in_hand` | carta non in mano | `spell_id` |
| `insufficient_mana` | mana insufficiente | `needed`, `available` |
| `invalid_target_count` | numero di bersagli errato | `expected`, `received` |
| `invalid_target` | casella non valida o vuota, pezzo del colore sbagliato, re non distruggibile, destinazione occupata | — |
| `illegal_position` | la magia lascerebbe un re sotto scacco in modo illegale | `king` (`white`/`black`) |
| `draw_offer_pending` | c'è già un'offerta di patta | — |
| `no_draw_offer` | risposta senza offerta pendente | — |
| `own_draw_offer` | risposta alla propria offerta | — |
| `internal_error` | errore imprevisto | — |

Un `code` sconosciuto va trattato come errore generico legato all'azione in volo.

---

## 4. Regole di gioco cambiate

- **Magie e scacco (B5).** Una magia che modifica la scacchiera (Disintegrate, Teleport) è rifiutata con
  `illegal_position`, a costo zero, se lascia sotto scacco il re di chi **non** ha il tratto:
  - in `main1` il tratto è di chi lancia, quindi la magia **non può dare scacco** all'avversario. Vale anche per
    un Disintegrate che rimuove il pezzo che copriva il re avversario;
  - in `main2` il tratto è dell'avversario: la magia **può** dare scacco, e se è matto la partita finisce al
    cambio di turno;
  - Teleport non può mai lasciare sotto scacco il re di chi lancia (come prima).

  Per il targeting: non serve pre-calcolarlo, basta gestire il rifiuto.
- **Scudo ed en passant (B11).** Lo scudo assorbe anche la cattura en passant; `effect_expired` porta la casella
  del pedone protetto.
- **Scudo e scacco (nuovo).** Se la cattura bloccata dallo scudo era l'unico modo in cui l'attaccante poteva
  uscire dallo scacco, lo scudo **si rompe** e la cattura avviene normalmente: il pezzo sparisce insieme allo
  scudo e non arriva `effect_expired`. Senza questa regola la posizione sarebbe illegale.
- **Teleport (B13, B14).** Uno spostamento magico non ha semantica scacchistica: il re su g1 non trascina la torre,
  un pedone in diagonale non cattura en passant. Gli effetti restano sul pezzo giusto.
- **Offerta di patta.** Decade quando chi l'ha ricevuta gioca una mossa (`draw_declined` con
  `reason: "move_played"` a chi l'aveva offerta).
- **Orologio.** Scala il tempo realmente trascorso, invece di 100 ms per tick. Prima, durante le chiamate a
  Stockfish, alcuni tick andavano persi e il tempo scorreva un po' più piano.

---

## 5. Connessione e autenticazione

- **Flusso consigliato:** `GET /ws/ticket` con `Authorization: Bearer <access_token>` → `{ticket, expires_in}`
  → `new WebSocket(WS_URL + "/ws?ticket=" + ticket)` entro 30 secondi. Il ticket vale una volta sola; un ticket
  usato o scaduto riceve 401 all'upgrade.
- `?token=<access_token>` e l'header Bearer funzionano ancora.
- **Codice di chiusura 4001** (`replaced_by_new_connection`): la connessione è stata sostituita da un'altra dello
  stesso utente. Non riconnettersi in automatico.
- **Rate limit.** Ora vale davvero per IP. Se client e server passano da un reverse proxy, il server va configurato
  con `TRUSTED_PROXIES`, altrimenti tutti i client dietro il proxy condividono lo stesso limite.

---

## 6. Endpoint REST nuovi o cambiati

| Metodo | Path | Auth | `data` |
|---|---|---|---|
| `GET` | `/ws/ticket` | Bearer | `{ticket: string, expires_in: 30}` |
| `GET` | `/spells` | — | `[{id, name, mana_cost, phases, target_type, effects:[{kind, params?}]}]` |
| `GET` | `/auth/password-policy` | — | `{username:{min_length, max_length, pattern}, password:{min_length, max_length, require_uppercase, require_lowercase, require_digit}}` |
| `GET` | `/leaderboard`, `/users/{id}/games` | come prima | `[]` quando vuoti |
| `POST` | `/auth/refresh` | — | invariato; ora soggetto al rate limit auth |
| `GET` | `/status` | — | invariato; senza DB risponde 503 invece di andare in errore |
| — | rotta inesistente / metodo errato | — | 404 / 405 con `{success:false, error}` |

---

## 7. Cosa resta aperto

- **P2-1** scelta del time control e **P2-11** refresh token in cookie: vedi §2.
- **Catalogo.** Resta quello del server (decisione presa). 5 carte su 11 sono ancora segnaposto `noop`
  (`spark`, `jolt`, `pulse`, `surge`, `nova`) e occupano 24 carte su 40 del mazzo.
- **Pezzi congelati e matto.** Il rilevamento di matto/stallo conta come legali anche le mosse dei pezzi congelati:
  se un giocatore ha solo mosse di pezzi congelati, la partita non finisce e può solo abbandonare o aspettare il
  timeout.
- **PGN.** Resta in UCI e non registra le magie.
- **`game_start`.** Non è stato introdotto: l'inizializzazione resta primo `game_state` + `hand` + `phase_changed`.

---

## 8. Stato della verifica lato server

- `go build`, `go vet` e `go test ./...` passano. Sono stati aggiunti test per: fine partita unica, azioni dopo
  la fine, timeout, riconnessione e socket sostituito, coda con connessione doppia, `game_state` con giocatori e
  time control, magie che creano posizioni illegali, cattura en passant, PGN, access token, ticket, IP dietro
  proxy, `/spells`, password policy.
- **Non verificato a runtime:** i test sono girati senza Stockfish né PostgreSQL. Il percorso completo di una mossa
  (scudo, en passant, decadenza della patta, `game_state` prima del `game_over` per matto) e la persistenza su DB
  vanno provati sulla VM con due client reali prima di chiudere lo Step 7.
- Consigliato per lo Step 7: aggiornare il mock a questo contratto e verificare una per una le voci di
  `ASSUMPTIONS.md` toccate qui (C1, C2, C3, C4, G4, G6, G10, A15).

---

## 9. Catalogo magie — Step 1 (branch `feat/spell-catalog`)

Primo step di [BRIEFING-MAGIE.md](BRIEFING-MAGIE.md), sul branch `feat/spell-catalog` (da `fix/backend-requests`).
Supera le voci di §4 e §7 su Disintegrate, Teleport, segnaposto `noop` e pezzi congelati.

| # | Cosa cambia | Azione nel client |
|---|---|---|
| 1 | **Catalogo nuovo.** Le 11 magie precedenti non esistono più; ci sono le 9 dello Step 1 (`frost`, `ice_chain`, `shatter`, `blood_pact`, `blink`, `shield`, `royal_shield`, `forced_march`, `conscription`). Le partite salvate col catalogo vecchio si ricaricano senza le carte scomparse. | Nomi e testi per id (i18n); `fallback.json` e mock allineati |
| 2 | `GET /spells`: `target_type` sparisce; al suo posto `targets: [TargetSpec]`, più `tags`, `rarity` e `limits` opzionale (PROTOCOL.md, "Catalogo magie") | Adapter, schema e registry dei bersagli leggono i `TargetSpec` |
| 3 | `cast_spell`: una casella per elemento di `targets`, nello stesso ordine; `spell_id` resta (niente id d'istanza: le copie sono identiche) | Il numero di passi del targeting è `targets.length` |
| 4 | Params rinominati: `turns` → `duration`, `count` → `amount`. In `effects_applied` `draw_card` resta `count` | Registry degli effetti |
| 5 | **Durate** relative a chi lancia: `remaining_turns` conta i turni del suo avversario; `active_effects[].effects[]` ha `caster` | Nessuna (il client non ricalcola le durate) |
| 6 | `invalid_target` ha `details: {index, reason, square}`; nuovo `limit_reached` `{spell_id, per_turn}` | Testi per `reason` e per `limit_reached` |
| 7 | **Niente scacco da magia** in `main1` e `main2`; il matto arriva solo da una mossa | Nessuna |
| 8 | **Pezzi congelati e fine partita**: senza mosse giocabili è matto (sotto scacco) o stallo | Nessuna |
| 9 | Nuovo effect kind `summon_pawn` (`effects_applied`: `target`, `piece`); `move_piece` anche relativo (`relative: "forward"`, un solo bersaglio) | Registry degli effetti |

Verifica: `go vet ./...` e `go test ./...` sulla VM (qui Go non è installato).

---

## 10. Catalogo magie — Step 2 (cimitero e gruppo A)

| # | Cosa cambia | Azione nel client |
|---|---|---|
| 1 | 9 magie nuove: `eternal_winter`, `recall`, `resurrection`, `swap`, `metamorphosis`, `royal_guard`, `divine_castling` (solo main1), `phalanx`, `early_promotion`. Mazzo di 40 su 18 magie, leggendarie a 1 copia | Nomi e testi i18n per id |
| 2 | **Cimitero**: `game_state.white_graveyard` / `black_graveyard` (tipi, in ordine); evento `graveyard_changed {player, graveyard}` a entrambi dopo catture e magie che lo cambiano | Mostrarlo nella riga del giocatore |
| 3 | `cast_spell.choice = {piece}` per `promote_piece` e per `revive_piece` con più tipi disponibili; errori `invalid_choice {reason: missing \| not_allowed}` | Passo di scelta dopo i bersagli |
| 4 | Magie senza effetto rifiutate a costo zero: `no_effect {reason: no_pieces \| empty_graveyard \| no_castling}` | Messaggio per `reason` |
| 5 | `effects_applied`: `freeze_all`/`shield_area` con `targets` (lista) e `remaining_turns`; `swap_pieces` con `targets`; `transform_piece`/`promote_piece`/`revive_piece` con `target` e `piece` | Applicare gli stati di massa da `targets` |
| 6 | `invalid_target` ha il nuovo `reason: pawn_rank` (Scambio che porterebbe un pedone in 1ª o 8ª) | Messaggio |

Verifica: `go build ./... && go vet ./... && go test ./...` sulla VM.

## 11. Catalogo magie — Step 3 (stati delle case)

| # | Cosa cambia | Azione nel client |
|---|---|---|
| 1 | 2 magie nuove: `ice_wall` (muro per 2 turni su una casa vuota) e `sanctuary` (nessuna cattura per 3 turni su una casa qualsiasi). Mazzo di 40 su 20 magie | Nomi e testi i18n per id |
| 2 | **Stati delle case**: `game_state.square_effects` (`[{square, effects: [{kind, remaining_turns, source_spell_id, caster}]}]`) ed evento `square_effects_changed {square_effects}` con la lista completa, quando uno stato nasce o scade. Kind: `wall`, `no_capture` | Disegnarli sulle case |
| 3 | Il muro blocca il movimento (arrivo e percorso, arrocco compreso; il cavallo scavalca), non gli attacchi: lo scacco resta quello degli scacchi. Il santuario vieta le catture del pezzo sulla casa (en passant compreso) e Frantumare | Togliere dagli evidenziati le mosse bloccate |
| 4 | Nuovo errore `move_blocked {square, reason: wall \| no_capture}`; controllato prima dello scudo | Rollback e messaggio |
| 5 | `invalid_target` ha i nuovi `reason` `wall` (casa col muro non vuota, anche per la Marcia forzata) e `no_capture` | Messaggio |
| 6 | `effects_applied`: `create_wall {target, remaining_turns}`, `create_square_effect {target, effect, remaining_turns}` | — |
| 7 | Senza mosse giocabili per muri o santuari: matto o stallo, anche dopo un muro lanciato in main1 | — |
| 8 | Snapshot: `square_effects` (assente negli snapshot precedenti = nessuno stato) | — |

Verifica: `go build ./... && go vet ./... && go test ./...` sulla VM.

## 12. Catalogo magie — Step 4 (rune)

| # | Cosa cambia | Azione nel client |
|---|---|---|
| 1 | 6 magie nuove: `revelation`, `stasis_rune`, `repel_rune`, `explosive_rune`, `detonation`, `minefield` (leggendaria, tre bersagli). Catalogo di 26; la ricetta rispetta i limiti di copie (2 comuni, 1 leggendarie) | Nomi e testi i18n per id |
| 2 | Nuovo stato delle case `rune`: `remaining_turns: -1`, `hidden`, `rune {on_enter, duration?, only?, fallback?, fallback_duration?}`. Al massimo una runa per giocatore per casa; una casa con le rune resta vuota per i bersagli | Disegnarle sulla casa; tratteggiate se nascoste |
| 3 | **Stato per destinatario**: `game_state` (anche alla riconnessione) e `square_effects_changed` sono costruiti per ciascun giocatore, senza le rune nascoste dell'avversario | Nessuna: la lista ricevuta è quella da disegnare |
| 4 | Il cast di una runa arriva all'avversario come `spell_cast {player, hidden: true, effects_applied: [{kind: "hidden_effect"}]}`, senza `spell_id` né `targets` | Registro e avviso "magia nascosta" |
| 5 | Nuovo evento `rune_triggered {square, owner, on_enter, result}` a entrambi; `result` è `{kind: freeze_piece, target, remaining_turns}`, `{kind: return_to_origin, from, to}` o `{kind: destroy_piece, target, piece_destroyed}`. Scatta solo con un pezzo nemico entrato muovendo (il re e i pezzi arrivati per magia no), non se lascerebbe sotto scacco il re di chi ha mosso; poi arrivano `game_state` e `square_effects_changed` senza la runa | Lampeggio della casa e avviso |
| 6 | `effects_applied`: `place_rune {targets, on_enter}`, `reveal_runes {side}`, `detonate_runes {runes, targets, remaining_turns}` | Registry degli effetti |
| 7 | `no_effect` ha il nuovo `reason: no_runes` (Detonazione senza rune proprie) | Messaggio |
| 8 | Snapshot: le rune stanno in `square_effects` con `hidden` e `rune` | — |

Verifica: `go build ./... && go vet ./... && go test ./...` (i test delle rune che passano da una mossa usano
Stockfish e si saltano dove non è installato).

## 13. Catalogo magie — Step 5 (trigger e aure)

| # | Cosa cambia | Azione nel client |
|---|---|---|
| 1 | 3 magie nuove: `restless_soul`, `reflection` (nascosta), `banner`. Catalogo di 29; lo Stendardo non è nella ricetta del mazzo finché il passo di lato non arriva (Step 6) | Nomi e testi i18n per id |
| 2 | `game_state` porta `triggers` e `auras` (per destinatario: i trigger nascosti dell'avversario non ci sono) | Etichette nella riga del giocatore |
| 3 | Eventi nuovi: `player_effects_changed {triggers, auras}` (liste per destinatario), `trigger_fired {player, on, do, source_spell_id, result}`, `aura_changed {player, grant, active}` | Avvisi; sostituire le liste |
| 4 | Anima inquieta pesca per ogni proprio pezzo perso, dal lancio alla fine del turno avversario, anche per un proprio sacrificio; la carta arriva solo al proprietario | — |
| 5 | Riflesso congela chi prova a catturare un pezzo scudato del proprietario (scudo che assorbe o si rompe), una volta; il re mai | Lampeggio della casa |
| 6 | `effects_applied`: `add_trigger {on, do, remaining_turns}`, `add_aura {grant, active}`; `no_effect` ha il nuovo `reason: aura_present` | Registry, messaggio |
| 7 | Snapshot: trigger e aure stanno nel `PlayerState` (`triggers`, `auras`, assenti negli snapshot precedenti) | — |

Verifica: `go build ./... && go vet ./... && go test ./...` (i test che passano da una mossa usano Stockfish).

## 14. Catalogo magie — Step 6 (mosse speciali)

| # | Cosa cambia | Azione nel client |
|---|---|---|
| 1 | 3 magie nuove, solo in main1: `phase_step` (su un proprio alfiere), `echo_of_fallen` (con `choice`), `haste` (leggendaria). Catalogo completo a 32; lo Stendardo entra nel mazzo | Nomi e testi i18n per id |
| 2 | Mosse speciali generate e validate dal server (phasing, movimento preso in prestito, passo di lato): `game_state.special_moves` e il nuovo evento privato `move_options {special_moves, extra_move}` per il giocatore di turno nella fase Move | Evidenziarle e mandarle col normale `move` |
| 3 | Fretta: seconda mossa facoltativa di pedone senza cattura; `extra_move` non null, `special_moves` = mosse ammesse, `pass_phase` la salta | CTA "Salta la seconda mossa" |
| 4 | Stati del pezzo nuovi in `active_effects`: `phasing` e `borrow_movement` (con `borrow_as`), durata 0 | Badge |
| 5 | `effects_applied`: `add_effect {target, effect, remaining_turns}`, `borrow_movement {target, piece}`, `extra_move {pieces, no_capture}`; `no_effect` ha il nuovo `reason: already_granted` | Registry, messaggio |
| 6 | Matto e stallo contano le mosse speciali | — |
| 7 | Snapshot: `extra_move` e gli stati di movimento | — |

Verifica: `go build ./... && go vet ./... && go test ./...` (i test che passano da una mossa usano Stockfish).

## 15. Collezione e rarità rara

| # | Cosa cambia | Azione nel client |
|---|---|---|
| 1 | Nuova rarità `rare` (massimo 2 copie, come le comuni): `shatter`, `swap`, `blink`, `detonation`, `divine_castling`, `echo_of_fallen`, `royal_shield`, `metamorphosis`, `sanctuary`. La ricetta del mazzo non cambia | Accettare `rare` nello schema; cornice oro |
| 2 | `GET /me/collection` (Bearer): `{cards: [{spell_id, copies, max_copies}], owned, total}`, una voce per ogni magia del catalogo nell'ordine di `GET /spells` | Pagina Collezione |
| 3 | Tabella `user_cards` creata allo startup (`db.EnsureCollectionSchema`); il set iniziale (comuni 2, rare 1, leggendarie 0: 45 / 59) arriva alla prima lettura, in una transazione | — |

Verifica: `go build ./... && go vet ./... && go test ./...`; col DB vero, una prima `GET /me/collection` crea le righe dello starter.

## 16. Mazzi personali

| # | Cosa cambia | Azione nel client |
|---|---|---|
| 1 | `GET/POST /me/decks`, `PUT/DELETE /me/decks/{id}`, `POST /me/decks/{id}/activate` (vedi PROTOCOL.md, "Mazzi"); tabella `user_decks` creata allo startup | Pagina Mazzi, card della home, mazzo attivo |
| 2 | Mazzo valido: 40 carte, limiti di rarità, copie possedute; bozze salvabili, solo un valido può essere attivo; massimo 10 | Stato del mazzo, errori per testo |
| 3 | "Mazzo iniziale" attivo creato alla prima lettura | — |
| 4 | In partita ognuno gioca col proprio mazzo attivo; se non è valido: `error deck_invalid` e chiusura `4002`, niente coda | Messaggio e link ai Mazzi |

Verifica: `go build ./... && go vet ./... && go test ./...`; col DB vero, una prima `GET /me/decks` crea la tabella e il mazzo iniziale.

## 17. Tutte le carte sbloccate (temporaneo)

| # | Cosa cambia | Azione nel client |
|---|---|---|
| 1 | `spells.UnlockAllCards` (acceso): `GET /me/collection` dà ogni magia a `max_copies` (59 / 59) e le regole dei mazzi (validazione, mazzo iniziale, mazzo attivo in partita) usano la collezione piena; le righe `user_cards` non cambiano | Nessuna: il client legge ciò che manda il server |
| 2 | I mazzi iniziali creati d'ora in poi sono la ricetta condivisa intera (leggendarie comprese) | — |

Verifica: `go build ./... && go vet ./... && go test ./...`. Per tornare alle copie vere: `UnlockAllCards = false` in `internal/spells/collection.go`.

## 18. Deploy su VPS

| # | Cosa cambia | Azione nel client |
|---|---|---|
| 1 | `DB_SSLMODE` (default `disable`) al posto di `sslmode=disable` fisso: un Postgres gestito con SSL usa `require` | — |
| 2 | L'handshake del WebSocket accetta solo le origini di `CORS_ALLOWED_ORIGINS` (stessi pattern con `*`); senza `Origin` passa (P2-16 chiusa) | In produzione il sito e l'app (`https://localhost`, `capacitor://localhost`) devono essere nella lista: lo fa `deploy/docker-compose.yml` |
| 3 | `server/Dockerfile` (Go + Stockfish di Debian) e lo stack `deploy/` (Postgres, server, Caddy); guida in `docs/DEPLOY.md` | Il client si costruisce nel container di Caddy con gli URL di produzione |

Verifica: `go build ./... && go vet ./... && go test ./...`.

## 19. Amici, presenza e sfide dirette

| # | Cosa cambia | Azione nel client |
|---|---|---|
| 1 | Presenza in memoria (`internal/presence`): online chi ha mandato un segnale negli ultimi 30 s, con `POST /me/presence` o aprendo il WebSocket | Segnale ogni 5 s a pagina visibile |
| 2 | `GET /me/friends`: `{friends: [{id, username, elo, status}], online}`; con `handlers.AllFriends` (acceso, temporaneo) tutti gli utenti sono amici | Pagina Amici, card della home, riga Android |
| 3 | `POST /me/challenges {to}` → `201` + sfida (scade in 60 s); `DELETE /me/challenges/{id}` annulla o rifiuta; `POST /me/presence` porta le sfide ricevute | Banner delle sfide, «Sfida» |
| 4 | `/ws?challenge=<id>`: il secondo dei due che si collega fa partire una partita amichevole (colori a caso, `friendly: true` in `game_state`, niente ELO). Sfida che non partirà più: `error challenge_declined|challenge_expired|challenge_unavailable` e chiusura `4003` | Attesa, esiti, chip «Amichevole» |
| 5 | Colonna `games.rated` (aggiunta allo startup da `db.EnsureGameSchema`, e in `deploy/postgres/init.sql`); `GET /users/{id}/games` porta `white_id`, `black_id`, `rated` | Etichetta «Amichevole» nello storico |

Verifica: `go build ./... && go vet ./... && go test ./...`; con il server avviato, `npm run e2e:challenge -- --http http://localhost:8080 --ws ws://localhost:8080/ws` dal client. Per le amicizie vere: `AllFriends = false` in `internal/handlers/friends.go` (lista vuota finché non ci sarà la tabella).

## 20. Amicizie vere e blocchi

| # | Cosa cambia | Azione nel client |
|---|---|---|
| 1 | Tabelle `friend_links` e `user_blocks` create allo startup (`db.EnsureFriendSchema`) | — |
| 2 | `GET /me/friends`: `{friends, others, incoming, outgoing, online, max_friends}`; `friends` sono gli amici veri, `others` gli altri utenti finché vale `AllFriends` | Pagina Amici con richieste e altri giocatori |
| 3 | `POST /me/friends/requests`, `.../{id}/accept`, `DELETE /me/friends/requests/{id}`, `DELETE /me/friends/{id}`: rispondono con la lista; richiesta incrociata = amicizia; limiti 200 amici e 50 richieste inviate | Azioni d'amicizia, profilo, fine partita |
| 4 | `GET /users/search?q=` (almeno 2 caratteri, al più 20) con la relazione | Ricerca nella pagina Amici |
| 5 | `GET/POST /me/blocks`, `DELETE /me/blocks/{id}`: il blocco toglie i legami, chiude le sfide fra i due, li nasconde a vicenda, vieta richieste e sfide | Blocca nel profilo, elenco nelle Impostazioni |
| 6 | `POST /me/presence` porta `friend_requests`; le sfide richiedono amicizia vera quando `AllFriends` è spento | Badge sulla voce Amici |

Verifica: `go build ./... && go vet ./... && go test ./...`; con il server avviato, `npm run e2e:challenge -- --http http://localhost:8080 --ws ws://localhost:8080/ws` dal client (23 controlli).

## 21. Privacy e conformità

| # | Cosa cambia | Azione nel client |
|---|---|---|
| 1 | Colonne `users.deleted_at`, `terms_version`, `terms_accepted_at`, `hide_presence` (`db.EnsurePrivacySchema` allo startup, e in `init.sql`) | — |
| 2 | Registrazione con `accept_terms` e `age_confirmed` obbligatori; `/me` e login con `terms_version`, `terms_current`, `hide_presence`; `POST /me/terms` | Casella in registrazione, riaccettazione |
| 3 | `DELETE /me {password}`: cancella i dati collegati e rende anonimo l'utente; spariscono da classifica, amici e ricerca; storico con `white_deleted`/`black_deleted` | «Elimina account», «Giocatore eliminato» |
| 4 | `GET /me/export`: tutti i dati dell'utente | «Scarica i miei dati» |
| 5 | `PUT /me/privacy {hide_presence}`: appare offline e non riceve sfide | Interruttore nelle Impostazioni |
| 6 | Log delle richieste senza query string | — |

Verifica: `go build ./... && go vet ./... && go test ./...`. Per cambiare i testi legali: alzare insieme `TermsVersion` (`internal/handlers/privacy.go`) e `TERMS_VERSION` (`client/src/legal/config.ts`).

## 22. Partite contro il bot

| # | Cosa cambia | Azione nel client |
|---|---|---|
| 1 | Secondo processo Stockfish `engine.Bot` (`InitBot` in `main.go`), `BestMoveWith` con Skill Level, limiti e `searchmoves` | — |
| 2 | Colonna `users.bot_level` (`EnsureBotSchema`, `EnsureBotAccounts`), account `#bot-<livello>` nascosti da ogni elenco | — |
| 3 | `/ws?bot=<livello>&color=…` (`Manager.JoinBot`, `game/bot.go`), amichevole; `bot` nel giocatore di `game_state`; `bot_unavailable` + chiusura 4004 | Card «Gioca»: «Contro il bot» con livello e colore; «Bot · livello», «Gioca ancora» |
| 4 | `white_bot`/`black_bot` in `GET /users/{id}/games` | «Bot · livello» nello storico |

Verifica: `go build ./... && go vet ./... && go test ./...`, poi `npm run e2e:bot -- --http … --ws …` dal client.
La forza dei livelli si tara in `internal/bot/levels.go` (`profiles`) e con le soglie di `internal/bot/spells.go`.

## 23. Tempo per fase

| # | Cosa cambia | Azione nel client |
|---|---|---|
| 1 | Niente orologio globale: `PHASE_TIME_MAIN` (90 s) per main1 e main2, `PHASE_TIME_MOVE` (120 s) per la mossa (`game/clock.go`); `DEFAULT_BASE_TIME` e `DEFAULT_INCREMENT` tolti | Orologio della fase del giocatore attivo, l'altro fermo sul tempo pieno |
| 2 | Fase Magie scaduta: passata dal server, `phase_timeout {player, phase, strikes}`; 3 di fila → `game_over` `timeout_strikes` | Segni delle scadenze, avviso, testo di fine partita |
| 3 | Mossa scaduta → `game_over` `timeout` (la seconda mossa di Fretta invece si salta) | Testo di fine partita |
| 4 | `game_state`: `time_control {main_ms, move_ms}`, `phase_time`, `white_timeouts`/`black_timeouts` (tolti `white_time`, `black_time`, `base_ms`, `increment_ms`); `timer_update {phase_time, turn, phase}`; storico `"90/120/90"` | Adapter (legge ancora gli orologi globali di un server precedente) |

Verifica: `go build ./... && go vet ./... && go test ./...`. Sul server di produzione vanno tolte, se ci sono, le
variabili `DEFAULT_BASE_TIME` e `DEFAULT_INCREMENT` (non fanno danni, ma non servono più).
