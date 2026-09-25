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
