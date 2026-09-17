# ASSUMPTIONS

Registro di ciò che il client assume sul server Go.

**Fonte:** il codice in `C:\Projects\chess-server` (commit `7f817e5`), consultabile in sola lettura.
I riferimenti sono `file.go:riga`, relativi a `internal/`. Il server qui non è eseguibile: la verifica
a runtime resta allo Step 7.

**Stati:**
- `verificata sul codice`;
- `smentita` (con la sostituzione adottata);
- `non determinabile` (il codice non basta, serve una decisione o una modifica al server);
- `verificata a runtime`.

**Regola che resta valida:** ogni interpretazione dei payload vive in `src/api/adapter.ts`. I warning
dell'adapter portano l'id della voce (`G1`, `C3`, …).

---

## 1. Esito delle assunzioni dello Step 0

| Id | Assunzione dello Step 0 | Esito | Riferimento | Conseguenza per il client |
|---|---|---|---|---|
| G1 | `game_state.pieces[]` con `piece_id` | **smentita** | `game/room.go:1117`, `effects/tracker.go:259` | Gli effetti arrivano **per casella**: `active_effects: [{square, effects:[{kind, remaining_turns, source_spell_id?}]}]`. Il server sposta la casella quando il pezzo si muove. Niente `piece_id` nel client. |
| G2 | Id d'istanza per le carte in mano | **smentita** | `spells/spells.go:132`, `game/room.go:837`, `match/match.go:273` | `hand` e `card_drawn` portano solo `spell_id`. L'id d'istanza è **locale** (serve solo per il rendering) e al cast si manda lo `spell_id`. |
| G3 | `targets` = caselle ordinate | **verificata** | `spells/spells.go:37`, `match/match.go:325`, `game/room.go:644` | 0 caselle per `none`, 1 per `enemy_piece`/`own_piece`, 2 (`[from, to]`) per `piece_move`. Un numero diverso è rifiutato. |
| G4 | `game_start` con lo stato iniziale | **smentita** | `game/manager.go:88-95` (commentato), `game/room.go:75-86` | All'avvio arrivano `game_state` (phase `draw`), poi `hand` privata, poi i `phase_changed` dell'auto-avanzamento. **Colore e avversario non vengono comunicati** → P0-5. |
| G5 | Stato completo alla riconnessione | **verificata** | `game/room.go:922-936` | `game_state` con `reconnected: true`, poi `hand`; all'avversario `opponent_reconnected`. |
| G6 | `error` come `{code?, message}` | **smentita** | `game/client.go:82-89` | `error` è solo `{message}`, in testo italiano. L'adapter converte i testi noti in codici (§3, C4). |
| G7 | Nessuna correlazione tra `error` e azione | **verificata** | `game/client.go:82` | `pendingAction` con timeout di 5s, come previsto. |
| G8 | `effects_applied[]` = `{kind, piece_id?, square?, params}` | **smentita** | `game/room.go:583-661` | Campi diversi per kind: `noop {kind}`; `destroy_piece {target, piece_destroyed}`; `freeze_piece`/`shield_piece {target, remaining_turns}`; `move_piece {from, to}`; `draw_card {count}`; `gain_mana {amount, mana}`. |
| G9 | Time control deciso dal server | **verificata** | `game/manager.go:73`, `config/config.go:61-62` | 10' + 5" da configurazione; `game_state` non lo espone (P2-9). |
| G10 | `GET /spells` | **smentita** | `api/router.go:29-52` | L'endpoint non esiste: si usa `src/spells/fallback.json`, copia di `spells/spells.go:83-95` (P1-1). |
| A11 | Registrazione `{username, password}` | **smentita** | `handlers/auth.go:18`, `validation/validation.go` | Body `{username, email, password}`. Password di 8–72 caratteri con almeno una maiuscola, una minuscola e una cifra. Username di 3–20 caratteri `[A-Za-z0-9_]`. Risposta `{user_id}`. |
| A12 | Login `{username,password}` → `{token,user}` | **smentita** | `handlers/auth.go:90-159`, `models/response.go:5` | Tutte le risposte sono avvolte in `{success, data?, error?}`. Login con email → `{tokens:{access_token, refresh_token}, user:{id, username, email, elo}}`. `/auth/refresh` restituisce i token direttamente in `data`. |
| A13 | `turn_number` globale | **verificata** | `match/match.go:173,242` | Il bianco gioca nei turni dispari, il nero nei pari. |
| A14 | `deck_size` in `hand_size_changed` | **smentita** | `game/room.go:811`, `1115` | I mazzi di entrambi sono in `game_state.*_deck_size`; il proprio anche in `card_drawn.deck_size` e `hand.deck_size`. |
| A15 | Enum aperti, numeri fuori dominio | **verificata** (resta come difesa) | — | `board.status` ∈ `active\|checkmate\|stalemate\|draw` (`game/room.go:398-408`). |
| A16 | Nessuna notifica di rientro dell'avversario | **smentita** | `game/room.go:933` | Esiste `opponent_reconnected`. |
| A17 | Nessuna notifica di patta rifiutata | **smentita** | `game/room.go:1206` | Esiste `draw_declined` verso chi ha offerto; `draw_offer_sent` conferma l'invio. |
| A18 | Spazi distinti per kind di stato e kind di effetto | **verificata** | `effects/tracker.go:7-8`, `spells/spells.go:52-53` | `freeze`/`shield` descrivono lo stato; `freeze_piece`/`shield_piece` l'effetto. |
| A19 | Il numero di bersagli dipende dall'effetto | **smentita** | `spells/spells.go:33-46` | Dipende dal `target_type`: `piece_move` = 2. Nel client basta leggerlo dal registry dei target. |

---

## 2. Contratto verificato (riferimento per l'adapter)

### REST — sempre `{ "success": bool, "data"?: …, "error"?: "testo" }` (`models/response.go:5`)
| Endpoint | Auth | `data` | Errori | Rif. |
|---|---|---|---|---|
| `GET /status` | — | `{status, version:"0.1.0"}` (503 + `success:false` se il DB è giù) | — | `handlers/status.go` |
| `POST /auth/register` | — | `{user_id}` (HTTP 200) | 400 validazione, 409 duplicato | `handlers/auth.go:18` |
| `POST /auth/login` | — | `{tokens:{access_token, refresh_token}, user:{id, username, email, elo}}` | 400, 401 | `handlers/auth.go:90` |
| `POST /auth/refresh` | — | `{access_token, refresh_token}` | 400, 401 | `handlers/auth.go:187` |
| `GET /me` | Bearer | `{id, username, email, elo, created_at}` | 401, 500 | `handlers/auth.go:272` |
| `GET /leaderboard` | — | `[{rank, id, username, elo}]` oppure `null` se vuota | 500 | `handlers/stats.go:14` |
| `GET /users/{id}` | — | `{user:{id, username, elo, created_at}, stats:{wins, losses, draws, total}}` | 400, 404 | `handlers/stats.go:111` |
| `GET /users/{id}/games` | Bearer | `[{id, white, black, result, time_control, pgn, played_at}]` oppure `null` | 400, 401, 500 | `handlers/stats.go:54` |
| `GET /ws` | Bearer o `?token=` | upgrade | 401 `{success:false,…}` | `middleware/auth.go:21`, `handlers/ws.go` |
| rotta inesistente | — | **testo semplice** `404 page not found` (default di chi) | — | `api/router.go` |

**Rate limit per IP** (`middleware/ratelimit.go:114-118`):
- generale 10/s, burst 20, su tutte le rotte;
- auth 3/s, burst 5, solo su register/login;
- `/ws` 1/s, burst 3.

Oltre il limite: 429 "Troppe richieste, rallenta!".
**Messaggi WebSocket:** 5/s, burst 10 (`handlers/ws.go:36`).
**CORS:** `http://*`, `https://*` (`api/router.go:20`).

### WebSocket server → client
| `type` | Payload | Destinatario | Rif. |
|---|---|---|---|
| `game_state` | `{board:{fen, moves, turn, status}, white_time, black_time, phase, active_player, turn_number, white_mana, white_max_mana, black_mana, black_max_mana, white_hand_size, black_hand_size, white_deck_size, black_deck_size, active_effects, reconnected?}` | entrambi | `game/room.go:1101` |
| `hand` | `{hand:[spell_id…], mana, max_mana, deck_size}` | proprietario | `game/room.go:827` |
| `card_drawn` | `{card_id: spell_id, deck_size}` | chi pesca | `game/room.go:802` |
| `hand_size_changed` | `{player: color, size}` | entrambi | `game/room.go:811` |
| `mana_changed` | `{player: color, current, max}` | entrambi | `game/room.go:792` |
| `phase_changed` | `{phase, active_player: color, turn_number}` | entrambi | `game/room.go:774` |
| `spell_cast` | `{player: color, spell_id, targets, effects_applied}` | entrambi | `game/room.go:535` |
| `effect_expired` | scadenza: `{square, effect_kind, piece_id: int}`; scudo consumato: `{square, effect_kind:"shield", reason:"shield_absorbed"}` | entrambi | `game/room.go:422,732` |
| `timer_update` | `{white_time, black_time, turn: giocatore attivo}` | entrambi, ogni secondo | `game/room.go:1083` |
| `game_over` | `{result, reason, winner?: username}` | entrambi | `game/room.go:1022` |
| `draw_offer` | `{from: username}` | avversario | `game/room.go:1162` |
| `draw_offer_sent` / `draw_declined` | `{message}` | chi ha offerto | `game/room.go:1167,1206` |
| `opponent_disconnected` / `opponent_reconnected` | `{message}` | avversario | `game/room.go:869,933` |
| `error` | `{message}` | mittente | `game/client.go:82` |

---

## 3. Assunzioni aperte

| Id | Assunzione | Motivo | Dove vive | Richiesta |
|---|---|---|---|---|
| C1 | Il colore del giocatore arriverà in `game_state` come `white_player`/`black_player: {id, username}` (contratto `proposed` del mock). Finché manca, il client **non** deduce il colore. | Il server non lo comunica (`game/manager.go:88`). | `adapter.ts` §3; `players: null` + warning | P0-5 |
| C2 | Se un giorno `error` porterà `code`, quello prevale sulla tabella dei testi. | Proposta P1-3. | `adapter.ts` §3b | P1-3 |
| C3 | `GET /spells`, se aggiunto, serializzerà `spells.Catalog` con i tag JSON di `spells/spells.go:60-73`. | È la forma più probabile; contratto `proposed`. | `adapter.ts` §7 | P1-1 |
| C4 | I testi d'errore restano quelli di commit `7f817e5`. Un testo nuovo o cambiato diventa `code: null` e la UI mostra un messaggio generico legato all'azione in volo. | Il server non espone codici. | `adapter.ts` §3b/§5; controllo incrociato in `tests/error-texts.test.ts` | P1-3 |
| C5 | Gli id d'istanza locali delle carte si riallineano a ogni `hand` confrontando i multinsiemi di `spell_id`. | Il server manda solo id di magia. | reducer (Step 3) | — |
| C6 | La legalità delle mosse nel mock usa chess.js al posto di Stockfish. Coincidono sulle posizioni legali, possono divergere su quelle rese illegali da Teleport (B5). | Stockfish non è disponibile nel mock. | `mock-server/game/rules.ts` | — |

---

## 4. Divergenze tra documentazione e codice
Dove i documenti in `docs/` contraddicono il codice, **vale il codice**.

| Punto | `SERVER_API.md` / `FRONTEND_TEST_SPEC.md` | Codice |
|---|---|---|
| Orologio | segue il tratto scacchistico | segue `match.ActivePlayer`; `timer_update.turn` è il giocatore attivo (`game/room.go:1041-1091`) |
| Arrocco dopo Disintegrate | non revocato | revocato (`effects/effects.go:205`) |
| Persistenza / shutdown | partite perse, chiuse come patta | persistite in Postgres e ripristinate dormienti; `server_shutdown` non viene più emesso (`game/manager.go:121-173`) |
| `phase_changed` con `draw` | il client non vede mai `draw` | `draw` **viene emessa** al rollover di turno; `end_turn` no (`match/match.go:169-177`, `game/room.go:774`) |
| Fase dopo un cast | resta la stessa | `AutoAdvance`: se non resta nulla di castabile, la fase avanza (`game/room.go:505`) |
| Param di `draw_card` | `amount` | `count` (`spells/spells.go:92`) |
| `effects_applied` | `{kind, target?, piece_destroyed?, remaining_turns?}` | anche `from`/`to`, `count`, `amount`/`mana` (vedi G8) |
| Teleport che dà scacco all'avversario | non specificato | consentito (`PROTOCOL.md`, `game/room.go:652`) |
| Offerta di patta | "sempre" | nessun controllo di turno, ma una sola offerta pendente (`game/room.go:1148`) |

---

## 5. Regole di gioco portate nel mock
Porting 1:1, senza scelte del mock, salvo C6.

| # | Regola | Rif. Go |
|---|---|---|
| R1 | Coda singola: il primo in attesa è il bianco. Stesso utente già in coda → "Sei già in coda". | `game/manager.go:30-96` |
| R2 | Avvio: `game_state` (phase draw) → `hand` al bianco → `hand` al nero → `AutoAdvance` (main1, poi move se nulla è castabile). | `game/room.go:75-89` |
| R3 | Rollover a `end_turn`: cambia il giocatore attivo, `turn_number++`, fase draw, mana = `min(indice del turno proprio, 10)`, pesca 1 (niente pesca se il mazzo è vuoto). Il bianco non pesca al turno 1: la pesca avviene solo nei rollover. | `match/match.go:155-178,242-277` |
| R4 | Auto-avanzamento: draw sempre; main1/main2 se nessuna carta in mano ha costo ≤ mana. | `match/match.go:199-238` |
| R5 | Mossa: turno = tratto FEN → fase move → legalità → congelato → incremento → assorbimento dello scudo (`PassTurn`, mossa non registrata) → esito (matto/stallo/50 mosse/materiale insufficiente conservativo/ripetizione tripla) → Advance + AutoAdvance → decremento effetti. | `game/room.go:312-434`, `engine/stockfish.go:188-292` |
| R6 | Cast: attivo → fase → magia esiste → fase della magia → carta in mano → mana → numero di bersagli → effetti (in caso di errore, costo zero) → spesa di mana e carta scartata → AutoAdvance → matto al rollover. | `match/match.go:301-349`, `game/room.go:480-567` |
| R7 | Effetti: destroy (nemico, non il re, revoca l'arrocco della torre); freeze su nemico, shield su proprio (rinnovano la durata); draw_card con `count`; gain_mana con cap 10; move_piece (proprio → casella vuota, revoca l'arrocco, rifiutato se lascia in scacco chi lancia). | `game/room.go:573-673`, `effects/*.go` |
| R8 | Il Tracker segue i pezzi nelle mosse: catture, en passant "euristico", arrocco, promozione. `TickColor` decrementa gli effetti di chi chiude il turno. | `effects/tracker.go` |
| R9 | Orologio: tick da 100 ms sul giocatore attivo, broadcast ogni secondo, timeout → `game_over`. | `game/room.go:1041-1092` |
| R10 | Patta: una sola offerta pendente, rispondibile solo da chi l'ha ricevuta. Accettata → `agreement`; rifiutata → `draw_declined` a chi l'ha offerta. | `game/room.go:1143-1210` |
| R11 | Disconnessione (solo con `status == active`) → `opponent_disconnected` → dopo 30s `abandonment`. Il rientro annulla il timer. | `game/room.go:853-937` |
| R12 | `endGame` → `game_over` e salvataggio; pgn UCI numerato; `time_control "10+0"`; ELO FIDE K=32. | `game/room.go:975-1035`, `db/db.go:51-119` |
