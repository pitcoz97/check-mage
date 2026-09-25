# ASSUMPTIONS

Registro di ciò che il client assume sul server Go.

**Fonte:** il codice in `C:\Projects\chess-server`, consultabile in sola lettura, branch `fix/backend-requests`
(commit `62475c9`, costruito su `7f817e5`, non ancora unito in `main`). I riferimenti sono `file.go:riga`, relativi a
`internal/`; dove è indicato `7f817e5` si riferiscono al codice precedente.

**Verifica a runtime:** eseguita il 23 settembre 2026 contro il server reale (§6), 47 voci verificate e nessuna
divergenza. Va rilanciata a ogni cambiamento del server con `npm run verify:server`.

> **Stato del client.** Dallo Step 2-bis adapter, mock e test implementano il contratto di §2 e le regole di §5.
> Il mock non replica più il contratto di `7f817e5`.

**Stati:**
- `verificata sul codice`;
- `smentita` (con la sostituzione adottata);
- `superata` (era vera su `7f817e5`, il server l'ha cambiata);
- `non determinabile` (il codice non basta, serve una decisione o una modifica al server);
- `verificata a runtime`.

**Regola che resta valida:** ogni interpretazione dei payload vive in `src/api/adapter.ts`. I warning
dell'adapter portano l'id della voce (`G1`, `C3`, …).

---

## 1. Esito delle assunzioni dello Step 0

| Id | Assunzione dello Step 0 | Esito | Riferimento | Conseguenza per il client |
|---|---|---|---|---|
| G1 | `game_state.pieces[]` con `piece_id` | **smentita** | `game/room.go:926`, `effects/tracker.go` | Gli effetti arrivano **per casella**: `active_effects: [{square, effects:[{kind, remaining_turns, source_spell_id?}]}]`. Il server sposta la casella quando il pezzo si muove. Niente `piece_id` nel client. |
| G2 | Id d'istanza per le carte in mano | **smentita** | `game/room.go:1004-1018`, `match/match.go:300` | `hand` e `card_drawn` portano solo `spell_id`. L'id d'istanza è **locale** (serve solo per il rendering) e al cast si manda lo `spell_id`. |
| G3 | `targets` = caselle ordinate | **verificata** | `spells/spells.go:37-46`, `match/match.go:300-349` | 0 caselle per `none`, 1 per `enemy_piece`/`own_piece`, 2 (`[from, to]`) per `piece_move`. Un numero diverso è rifiutato con `invalid_target_count`. |
| G4 | `game_start` con lo stato iniziale | **smentita**; colore **risolto** da P0-5 | `game/manager.go:99`, `game/room.go:1365-1366` | Non esiste `game_start`: all'avvio arrivano `game_state` (phase `draw`), `hand` privata, poi i `phase_changed` dell'auto-avanzamento. Il colore si ricava confrontando `white_player.id`/`black_player.id` con l'id di `/me`. |
| G5 | Stato completo alla riconnessione | **verificata** | `game/room.go:1134-1148` | `game_state` con `reconnected: true` (compresi i giocatori), poi `hand`; all'avversario `opponent_reconnected`. |
| G6 | `error` come `{code?, message}` | **superata**: ora `{message, code, details?}` | `game/client.go:126-137`, `gameerr/gameerr.go` | Il client usa `code`; il testo resta solo per il debug. Un `code` sconosciuto è un errore generico legato all'azione in volo. |
| G7 | Nessuna correlazione tra `error` e azione | **verificata** | `game/client.go:126` | `pendingAction` con timeout di 5s, come previsto. |
| G8 | `effects_applied[]` = `{kind, piece_id?, square?, params}` | **smentita** | `game/room.go:740-853` | Campi diversi per kind: `noop {kind}`; `destroy_piece {target, piece_destroyed}`; `freeze_piece`/`shield_piece {target, remaining_turns}`; `move_piece {from, to}`; `draw_card {count}`; `gain_mana {amount, mana}`. |
| G9 | Time control deciso dal server | **verificata** | `game/room.go:1367-1370`, `config/config.go` | 10' + 5" da configurazione, ora esposto in `game_state.time_control` (P2-9). |
| G10 | `GET /spells` | **superata**: l'endpoint esiste | `handlers/catalog.go:13`, `spells/spells.go:172` | Il catalogo si carica da `/spells`; `src/spells/fallback.json` resta come riserva (P1-1). |
| A11 | Registrazione `{username, password}` | **smentita** | `handlers/auth.go`, `validation/validation.go:11-19` | Body `{username, email, password}`. Requisiti ora esposti da `GET /auth/password-policy` (P2-10). Risposta `{user_id}`. |
| A12 | Login `{username,password}` → `{token,user}` | **smentita** | `handlers/auth.go`, `models/response.go:5` | Tutte le risposte sono avvolte in `{success, data?, error?}`. Login con email → `{tokens:{access_token, refresh_token}, user:{id, username, email, elo}}`. `/auth/refresh` restituisce i token direttamente in `data`. |
| A13 | `turn_number` globale | **verificata** | `match/match.go:154-178,241` | Il bianco gioca nei turni dispari, il nero nei pari. |
| A14 | `deck_size` in `hand_size_changed` | **smentita** | `game/room.go:692-695,1382-1383` | I mazzi di entrambi sono in `game_state.*_deck_size`; il proprio anche in `card_drawn.deck_size` e `hand.deck_size`. |
| A15 | Enum aperti, numeri fuori dominio | **verificata** (resta come difesa) | `game/room.go:25-33` | `board.status` ∈ `active\|checkmate\|stalemate\|draw\|resigned\|timeout\|abandoned`; ogni valore diverso da `active` è terminale. |
| A16 | Nessuna notifica di rientro dell'avversario | **smentita** | `game/room.go:1143-1148` | Esiste `opponent_reconnected`. |
| A17 | Nessuna notifica di patta rifiutata | **smentita** | `game/room.go:556-561,1495-1500` | `draw_declined {message, reason}` verso chi ha offerto, con `reason` `declined` o `move_played`; `draw_offer_sent` conferma l'invio. |
| A18 | Spazi distinti per kind di stato e kind di effetto | **verificata** | `effects/tracker.go`, `spells/spells.go:51-57` | `freeze`/`shield` descrivono lo stato; `freeze_piece`/`shield_piece` l'effetto. |
| A19 | Il numero di bersagli dipende dall'effetto | **smentita** | `spells/spells.go:37-46` | Dipende dal `target_type`: `piece_move` = 2. Nel client basta leggerlo dal registry dei target. |

---

## 2. Contratto verificato (riferimento per l'adapter)

### REST — sempre `{ "success": bool, "data"?: …, "error"?: "testo" }` (`models/response.go:5`)
Gli errori REST sono **ancora solo testo** (P1-3 applicata solo al WebSocket).

| Endpoint | Auth | `data` | Errori | Rif. |
|---|---|---|---|---|
| `GET /status` | — | `{status, version}` (503 + `success:false` se il DB è giù) | — | `handlers/status.go` |
| `POST /auth/register` | — | `{user_id}` (HTTP 200) | 400 validazione, 409 duplicato | `handlers/auth.go` |
| `POST /auth/login` | — | `{tokens:{access_token, refresh_token}, user:{id, username, email, elo}}` | 400, 401 | `handlers/auth.go` |
| `POST /auth/refresh` | — | `{access_token, refresh_token}` | 400, 401, 429 (limite auth) | `handlers/auth.go`, `api/router.go:44` |
| `GET /auth/password-policy` | — | `{username:{min_length, max_length, pattern}, password:{min_length, max_length, require_uppercase, require_lowercase, require_digit}}` | — | `handlers/catalog.go:24`, `validation/validation.go:27-58` |
| `GET /me` | Bearer (solo access) | `{id, username, email, elo, created_at}` | 401, 500 | `handlers/auth.go`, `middleware/auth.go:56` |
| `GET /leaderboard` | — | `[{rank, id, username, elo}]`, `[]` se vuota | 500 | `handlers/stats.go:37` |
| `GET /users/{id}` | — | `{user:{id, username, elo, created_at}, stats:{wins, losses, draws, total}}` | 400, 404 | `handlers/stats.go` |
| `GET /users/{id}/games` | Bearer | `[{id, white, black, result, time_control, pgn, played_at}]`, `[]` se vuota | 400, 401, 500 | `handlers/stats.go:97` |
| `GET /spells` | — | `[{id, name, mana_cost, phases, target_type, effects:[{kind, params?}]}]`, ordinato per costo e id | — | `handlers/catalog.go:13` |
| `GET /ws/ticket` | Bearer | `{ticket, expires_in: 30}` | 401, 500 | `handlers/ws.go:23`, `api/router.go:58` |
| `GET /ws` | `?ticket=` (monouso, 30s) oppure Bearer / `?token=` | upgrade | 401 `"Ticket non valido o scaduto"` o `"Token non valido o scaduto"` | `middleware/wsticket.go:78-94`, `api/router.go:62` |
| rotta inesistente / metodo errato | — | 404 `"Risorsa non trovata"` / 405 `"Metodo non consentito"` in JSON | — | `api/router.go:33-34` |

**Rate limit per IP** (`middleware/ratelimit.go:101`): la chiave è l'IP senza porta; `X-Forwarded-For`/`X-Real-IP`
valgono solo da un proxy in `TRUSTED_PROXIES`. Due schede dello stesso browser condividono gli stessi limiti.
- generale 10/s, burst 20, su tutte le rotte;
- auth 3/s, burst 5, su register, login **e refresh**;
- `/ws` 1/s, burst 3 (applicato prima dell'autenticazione).

Oltre il limite: 429 "Troppe richieste, rallenta!".
**Messaggi WebSocket:** 5/s, burst 10; massimo 4096 byte per messaggio (`game/client.go:23`).
**Heartbeat:** ping del server ogni 54s; la connessione si chiude dopo 60s senza traffico dal client
(`game/client.go:19-24`). Il browser risponde al ping da solo.
**CORS:** `CORS_ALLOWED_ORIGINS`, default `https://*`, `http://*`, `capacitor://localhost` (`config/config.go:74`).

### WebSocket server → client
| `type` | Payload | Destinatario | Rif. |
|---|---|---|---|
| `game_state` | `{board:{fen, moves, turn, status}, white_player:{id, username}, black_player:{id, username}, time_control:{base_ms, increment_ms}, white_time, black_time, phase, active_player, turn_number, white_mana, white_max_mana, black_mana, black_max_mana, white_hand_size, black_hand_size, white_deck_size, black_deck_size, active_effects, reconnected?}` | entrambi | `game/room.go:1360-1386` |
| `hand` | `{hand:[spell_id…], mana, max_mana, deck_size}` | proprietario | `game/room.go:1004-1018` |
| `card_drawn` | `{card_id: spell_id, deck_size}` | chi pesca | `game/room.go:697-704,979` |
| `hand_size_changed` | `{player: color, size}` | entrambi | `game/room.go:692` |
| `mana_changed` | `{player: color, current, max}` | entrambi | `game/room.go:969` |
| `phase_changed` | `{phase, active_player: color, turn_number}` | entrambi | `game/room.go:951` |
| `spell_cast` | `{player: color, spell_id, targets, effects_applied}` | entrambi | `game/room.go:685-690` |
| `effect_expired` | scadenza: `{square, effect_kind, piece_id: int}`; scudo consumato: `{square, effect_kind:"shield", reason:"shield_absorbed"}` (per l'en passant `square` è il pedone catturato) | entrambi | `game/room.go:548-555,902` |
| `timer_update` | `{white_time, black_time, turn: giocatore attivo}` | entrambi, ogni secondo | `game/room.go:1331-1340` |
| `game_over` | `{result, reason, winner?: username}`; `reason` ∈ `checkmate\|stalemate\|draw\|resign\|timeout\|abandonment\|agreement` | entrambi, **una sola volta**, sempre **dopo** un `game_state` con lo status finale | `game/room.go:1241-1271` |
| `draw_offer` | `{from: username}` | avversario | `game/room.go:1440` |
| `draw_offer_sent` | `{message}` | chi ha offerto | `game/room.go:1445` |
| `draw_declined` | `{message, reason: "declined"\|"move_played"}` | chi ha offerto | `game/room.go:556-561,1495-1500` |
| `opponent_disconnected` / `opponent_reconnected` | `{message}` | avversario | `game/room.go:1053,1145` |
| `error` | `{message, code, details?}` (codici in `gameerr/gameerr.go`) | mittente | `game/client.go:126-137` |

**Chiusura 4001** (`replaced_by_new_connection`): preceduta da un `error` con lo stesso codice, arriva ~250 ms dopo
(`game/client.go:142-153`). Succede quando lo stesso utente si connette altrove, in partita (`game/room.go:1116`) o in
coda (`game/manager.go:52`).

**Ordine degli eventi di una mossa** (`game/room.go:548-569`): `effect_expired` (scudo) → `draw_declined`
(`move_played`) → `game_state` → `phase_changed`… → `effect_expired` (scadenze) → `game_over`.

---

## 3. Assunzioni aperte

| Id | Assunzione | Motivo | Dove vive | Richiesta |
|---|---|---|---|---|
| C1 | ~~Il colore arriverà in `white_player`/`black_player`~~ **Risolta** (`game/room.go:1365`). Resta da verificare a runtime; se i campi mancano l'adapter produce `players: null` con warning, senza dedurre il colore. | P0-5 applicata. | `adapter.ts` §3 | — |
| C2 | ~~`code` prevale sulla tabella dei testi~~ **Risolta**: si usa solo `code` (con `details`); la tabella dei testi WS è stata rimossa. Un `code` mancante o sconosciuto dà `code: null` e un warning G6. | P1-3 applicata al WS. | `adapter.ts` §3b | — |
| C3 | ~~Forma di `GET /spells`~~ **Risolta**: coincide con i tag JSON di `Spell` (`spells/spells.go:61-74`). `endpoints.ts` → `fetchSpellCatalog`. | P1-1 applicata. | `adapter.ts` §7 | — |
| C4 | I testi d'errore **REST** restano quelli del branch attuale (compresi i nuovi di §2). Un testo nuovo o cambiato diventa `code: null` e la UI mostra un messaggio generico. | La REST non espone codici. | `adapter.ts` §5; `tests/error-texts.test.ts` | P1-3 (REST) |
| C5 | Gli id d'istanza locali delle carte si riallineano a ogni `hand` confrontando i multinsiemi di `spell_id`. | Il server manda solo id di magia. | reducer (Step 3) | — |
| C6 | La legalità delle mosse nel mock usa chess.js al posto di Stockfish. Ora che le magie non creano più posizioni illegali (B5), le due fonti coincidono. | Stockfish non è disponibile nel mock. | `mock-server/game/engine.ts` | — |
| C7 | Sul web access e refresh token sono salvati in `localStorage` (via `src/lib/storage.ts`), perché la sessione deve sopravvivere alla chiusura della tab. Un XSS potrebbe leggerli: mitigazioni = nessuno script di terze parti, CSP allo Step 6. Su mobile passeranno a `@capacitor/preferences`. Il server non espone un logout: il client scarta i token. | I token arrivano nel body JSON. | `src/store/authStore.ts` | P2-11 (sospesa) |
| C8 | Lo username viene inviato già ripulito dagli spazi: il server lo valida dopo il trim ma lo salva così com'è (`validation/validation.go:62`). | Evita nomi utente con spazi invisibili. | `src/screens/Auth/Register.tsx` | — |
| C9 | `password-policy.username.pattern` è una regex RE2 di Go; il client la compila come `RegExp` JS. Se non compila (warning `password_policy_invalid`) si usa quella di riserva; se l'endpoint non risponde vale tutta `FALLBACK_CREDENTIAL_POLICY`. La regola dell'email non è nella policy e resta replicata nel client. | RE2 e JS coincidono solo sulle regex semplici; la policy non copre l'email. | `adapter.ts` §6, `Register.tsx` | — |
| C10 | Durante una partita il client considera morta la connessione dopo 5s senza frame (arriva un `timer_update` al secondo), la chiude e riconnette. In coda non c'è traffico: vale solo `onclose`. Il client **non** manda ping applicativi: un `type` sconosciuto riceve `unknown_message_type` e consuma il rate limit. | Il browser non espone i ping WS; il server rileva i socket morti solo dopo 60s. | `src/ws/connection.ts` (`DEFAULT_SILENCE_MS`, `expectTraffic`) | — |
| C11 | Per riprendere una partita dopo un ricaricamento il client ricorda, in `storage.ts` (`active-match`), l'id dell'utente con una partita aperta: scritto al primo `game_state`, cancellato a `game_over` o all'uscita. `/match` riapre il socket solo con questo flag; se entro 4s non arriva un `game_state` la partita non esiste più (il server ha messo l'utente in coda), quindi si chiude e si torna in lobby. | Il server non dice se c'è una partita in corso senza aprire il socket, e aprirlo senza partita mette in coda (`game/manager.go:31-101`). | `src/store/matchSession.ts`, `src/screens/Match/Match.tsx` | P2-13 |
| C12 | La finestra di rientro è di 30s (`RECONNECT_TIMEOUT`, default in `config/config.go:68`): serve solo al countdown del banner, contato dall'inizio della disconnessione vista dal client. | Il server non la espone e la configurazione può cambiarla. | `src/store/matchSession.ts` (`RECONNECT_WINDOW_MS`) | P2-12 |
| C13 | **Confermata a runtime.** I turni residui degli effetti (`remaining_turns`) sono esatti solo nell'ultimo `game_state`: il server li decrementa al cambio di turno (`game/room.go:858-866`) senza comunicarlo quando il cambio avviene con un `pass_phase` o un cast, perché lì non manda `game_state`. Il client non ricalcola il decremento (sarebbe logica di gioco). | Nessun evento porta il decremento. | `src/store/matchStore.ts` | P2-14 |
| C14 | Una carta in mano con uno `spell_id` che il catalogo non contiene si disegna comunque (id come nome, costo ignoto, cornice neutra) ma resta **non lanciabile**, col motivo scritto sulla carta: senza `target_type` il client non sa quante caselle mandare. Stessa regola per un `target_type` sconosciuto. Un **effetto** sconosciuto invece non blocca nulla: la carta resta lanciabile e l'effetto si mostra neutro (briefing §5.1.6). | Il catalogo si carica a inizio partita dallo stesso server, quindi succede solo con la riserva `fallback.json` contro un server più nuovo. | `src/spells/playability.ts`, `src/game/hand/SpellCard.tsx` | — |
| C15 | **Confermata a runtime.** La dimensione del mazzo **avversario** è esatta solo nell'ultimo `game_state`: la pesca del rollover produce `card_drawn` (solo a chi pesca) e `hand_size_changed` (a entrambi), ma nessun evento porta il mazzo dell'altro. Il proprio resta sempre esatto. Il client non lo ricalcola. | Stessa causa di C13: al rollover non arriva `game_state`. | `src/store/matchStore.ts`, `scripts/e2e/client.ts` (escluso dal confronto) | P2-14 |
| C16 | Il mana massimo non supera mai 10: la barra del mana (redesign) disegna 10 cristalli e mostra come "bloccati" quelli oltre `max_mana`. Il 10 è `MaxManaCap` (`spells/spells.go:22`), usato dal server per limitare la crescita del mana. Il client non lo usa per nessuna decisione di gioco, solo per il disegno. | Il tetto non viaggia nel protocollo: `game_state` porta solo `mana` e `max_mana` (`spells/spells.go:137`). | barra del mana (`src/game/mana/ManaBar.tsx`, dal passo R4) | P2-17 |

---

## 4. Divergenze tra documentazione e codice
Dove i documenti in `docs/` contraddicono il codice, **vale il codice**. `PROTOCOL.md` del server è stato aggiornato
insieme a `fix/backend-requests`; le righe seguenti riguardano `SERVER_API.md` e `FRONTEND_TEST_SPEC.md`.

| Punto | `SERVER_API.md` / `FRONTEND_TEST_SPEC.md` | Codice |
|---|---|---|
| Orologio | segue il tratto scacchistico | segue `match.ActivePlayer` e scala il tempo reale trascorso; `timer_update.turn` è il giocatore attivo (`game/room.go:1279-1340`) |
| Arrocco dopo Disintegrate | non revocato | revocato (`effects/effects.go`) |
| Persistenza / shutdown | partite perse, chiuse come patta | persistite in Postgres e ripristinate dormienti; `server_shutdown` non viene più emesso (`game/manager.go:134-190`) |
| `phase_changed` con `draw` | il client non vede mai `draw` | `draw` **viene emessa** al rollover di turno; `end_turn` no (`match/match.go:154-178`, `game/room.go:951`) |
| Fase dopo un cast | resta la stessa | `AutoAdvance`: se non resta nulla di castabile, la fase avanza (`game/room.go:655`) |
| Param di `draw_card` | `amount` | `count` (`spells/spells.go`) |
| `effects_applied` | `{kind, target?, piece_destroyed?, remaining_turns?}` | anche `from`/`to`, `count`, `amount`/`mana` (vedi G8) |
| Magia che dà scacco all'avversario | non specificato | in `main1` rifiutata con `illegal_position` (Teleport e Disintegrate); in `main2` consentita, e se è matto la partita finisce al cambio di turno (`game/room.go:725-733,659`) |
| Offerta di patta | "sempre" | nessun controllo di turno, una sola offerta pendente (`game/room.go:1423`); decade quando chi l'ha ricevuta muove (`game/room.go:503-508`) |
| "Sei già in coda" | errore alla seconda connessione | la connessione nuova sostituisce la vecchia (4001) (`game/manager.go:50-64`) |

---

## 5. Regole di gioco portate nel mock
Porting 1:1, senza scelte del mock, salvo C6 (e gli scenari con bot, che sono un'aggiunta).

| # | Regola | Rif. Go |
|---|---|---|
| R1 | Coda singola: il primo in attesa è il bianco. Stesso utente già in coda → la connessione nuova sostituisce la vecchia (`error` `replaced_by_new_connection` + chiusura 4001). `LeaveQueue` confronta la connessione, non l'utente. | `game/manager.go:31-117` |
| R2 | Avvio: `game_state` (phase draw, con giocatori e time control) → `hand` al bianco → `hand` al nero → `AutoAdvance` (main1, poi move se nulla è castabile). | `game/room.go:76-127` |
| R3 | Rollover a `end_turn`: cambia il giocatore attivo, `turn_number++`, fase draw, mana = `min(indice del turno proprio, 10)`, pesca 1 (niente pesca se il mazzo è vuoto). Il bianco non pesca al turno 1: la pesca avviene solo nei rollover. | `match/match.go:154-178,241-290` |
| R4 | Auto-avanzamento: draw sempre; main1/main2 se nessuna carta in mano ha costo ≤ mana. | `match/match.go:198-238` |
| R5 | Mossa: partita non conclusa → turno = tratto FEN → fase move → legalità → congelato → casella catturata (per l'en passant il pedone) → scudo: assorbe (mossa `0000`, `PassTurn`) **salvo** che la mossa nulla lasci in scacco chi muove, nel qual caso lo scudo si rompe → incremento → decadenza dell'offerta di patta ricevuta → esito (matto/stallo/patta/ripetizione tripla) → Advance + AutoAdvance → decremento effetti. `game_state` sempre prima di `game_over`. | `game/room.go:423-570` |
| R6 | Cast: partita non conclusa → attivo → fase → magia esiste → fase della magia → carta in mano → mana → numero di bersagli → effetti (in caso di errore, costo zero) → spesa di mana e carta scartata → AutoAdvance → matto al rollover. | `match/match.go:300-353`, `game/room.go:624-718` |
| R7 | Effetti: destroy (nemico, non il re, revoca l'arrocco della torre); freeze su nemico, shield su proprio (rinnovano la durata); draw_card con `count`; gain_mana con cap 10; move_piece (proprio → casella vuota, `Tracker.Relocate` senza semantica scacchistica). Destroy e move_piece rifiutati con `illegal_position` se lasciano sotto scacco il re di chi non ha il tratto; move_piece anche se lascia in scacco chi lancia. Errori di bersaglio → `invalid_target`. | `game/room.go:720-853`, `effects/*.go` |
| R8 | Il Tracker segue i pezzi nelle mosse: catture, en passant, arrocco, promozione. `TickColor` decrementa gli effetti di chi chiude il turno. | `effects/tracker.go` |
| R9 | Orologio: tick da 100 ms che scala il tempo reale trascorso sul giocatore attivo, broadcast ogni secondo, timeout → status `timeout`, `timer_update` + `game_state` + `game_over`. | `game/room.go:1279-1327` |
| R10 | Patta: una sola offerta pendente, rispondibile solo da chi l'ha ricevuta. Accettata → `agreement`; rifiutata → `draw_declined {reason:"declined"}`; decade con `draw_declined {reason:"move_played"}` se chi l'ha ricevuta muove. | `game/room.go:503-508,1413-1501` |
| R11 | Disconnessione (solo a partita attiva e solo per la connessione registrata) → `opponent_disconnected` → dopo 30s status `abandoned`, `game_state` + `game_over` `abandonment`. Il rientro annulla il timer e chiude con 4001 un'eventuale connessione precedente ancora aperta. | `game/room.go:1031-1149` |
| R12 | Fine partita unica (`finishLocked`): status terminale, timer e offerte chiusi, un solo `game_over` e un solo salvataggio; azioni successive → `error` `game_over`; PGN UCI numerato con `--` per `0000`; `time_control "10+5"`; ELO FIDE K=32. | `game/room.go:1176-1271`, `db/db.go` |

---

## 6. Verifica a runtime (Step 7)

**Eseguita il 23 settembre 2026** contro il server reale su `http://192.168.222.128:8080` (branch
`fix/backend-requests`), con:

```bash
npm run verify:server -- --http http://192.168.222.128:8080 --ws ws://192.168.222.128:8080/ws --slow
```

**Esito: 47 voci verificate, 0 divergenze.** Il comando va rilanciato dopo ogni cambiamento del server; la procedura
e la lettura del rapporto sono in `docs/INTEGRAZIONE.md`.

| Voci | Cosa è stato verificato | Esito |
|---|---|---|
| A11, A12, B3 | registrazione, login, refresh, `/me`, refresh token rifiutato come access (401) | verificata |
| C4 | testi d'errore REST riconosciuti (`Credenziali non valide` → `invalid_credentials`), 404 e 405 in JSON | verificata |
| C9 | `password-policy` esposta, 7 requisiti, regex compilata anche in JavaScript | verificata |
| C3, G10 | `GET /spells`: 11 magie, nessuna scartata, identiche a `fallback.json` | verificata |
| P0-1 | ticket solo col Bearer, ticket inventato rifiutato, **ticket valido una volta sola**, durata 30s | verificata |
| C1, P0-5, G2, G4, A13, P2-9 | colori dai giocatori, mano privata di 4 carte, `game_state` → `hand` → `phase_changed` (nessun `game_start`), time control 10'+5", primo turno al bianco | verificata |
| G6, A15 | `not_your_turn`, `wrong_phase` con la fase, `illegal_move` con la mossa, `insufficient_mana` con i numeri | verificata |
| C10 | `timer_update` 4 volte in 3,5s; socket vivo oltre 70s di silenzio (ping/pong) | verificata |
| G8 | `spell_cast` con gli effetti dichiarati | verificata |
| C13, C15 | **confermate**: alla chiusura del turno non arriva `game_state`, quindi turni residui e mazzo avversario restano indietro (P2-14 non ancora applicata) | verificata |
| G5 | riconnessione con stato completo: nessuna differenza fra reducer e server, `reconnected: true` | verificata |
| A17 | patta offerta, rifiutata (`declined`) e decaduta per mossa (`move_played`) | verificata |
| B2 | seconda connessione: `replaced_by_new_connection` + 4001, la nuova riprende la partita | verificata |
| B1 | resa: status `resigned` nell'ultimo `game_state`, `game_over` con vincitore, azioni successive rifiutate | verificata |
| A12 (limiti) | rate limit su `/auth`: 429 dopo pochi tentativi ravvicinati | verificata |
| — | **CORS dal browser vero** (origine `http://localhost:5173`): `GET /spells` dall'app, POST con preflight su `/auth/login`, header `Authorization` su `/ws/ticket` | verificata |

**Trovato dalla verifica:** l'upgrade del WebSocket è limitato a **1/s per IP** (`RATE_WS`), e un upgrade rifiutato
(429 o 401) in Node emette solo `error`, senza `close`. Il client restava in attesa per sempre invece di riprovare:
corretto in `src/ws/connection.ts` (`nativeSocketFactory`).

**Non verificabile in automatico:** scudo sull'en passant e posizioni costruite (servono mazzi pilotati, coperti da
`mock-server/game/room.test.ts`), C11 e C12 (scelte del client, non comportamenti del server).
