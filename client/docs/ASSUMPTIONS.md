# ASSUMPTIONS

Ogni assunzione presa al posto del server Go, che oggi non è consultabile. La regola è una:
**un'assunzione vive in `src/api/adapter.ts`** (o in `src/ws/connection.ts` se riguarda l'autenticazione
del socket). Allo Step 7 ogni voce va verificata contro il server reale e portata a `verificata` o
`smentita`. Se è `smentita`, si corregge l'adapter e nient'altro.

A runtime l'adapter emette warning etichettati con l'id della voce (`G1`, `A14`, …), così un log punta
direttamente alla riga da controllare.

Stati: `non verificata` · `verificata` · `smentita`.

---

## Assunzioni di contratto (G = zone grigie del briefing §3.6, A = emerse allo Step 0)

### G1 — Mapping `piece_id` ↔ casella
- **Stato:** non verificata
- **Assunzione:** `game_state` (e lo snapshot di `game_start`) contiene
  `pieces: [{ piece_id, square, type, color, effects: [{ kind, remaining_turns }] }]`.
  `type` è la lettera chess.js (`p n b r q k`); si accetta anche il nome esteso. `color` vale `white|black`.
  Il `piece_id` è opaco: il client non ne interpreta il formato.
- **Motivo:** la FEN non ha identificativi, mentre `effect_applied`/`effect_expired` parlano per `piece_id`.
- **Dove:** `adapter.ts` §2 (`wirePieceSchema`), §3 (`decodeGameState`, `decodeGameStart`).
- **Se falsa:** `pieces: null` + warning `pieces_missing`. Il client **non** ricostruisce il mapping per
  euristica: gli effetti finiscono in un pannello laterale (Step 5).
- **Richiesta:** P0-3.

### G2 — Id d'istanza delle carte
- **Stato:** non verificata
- **Assunzione:** ogni carta in mano ha un id di istanza univoco (`card_id`) distinto da `spell_id`.
  `card_drawn` = `{ card_id, spell_id }`; la mano nello snapshot è `[{ card_id, spell_id }]`.
  Sul filo `cast_spell` resta `{ spell_id, targets }` come da contratto: `card_id` **non** viene inviato.
- **Motivo:** con più copie della stessa magia in mano servono chiavi distinte.
  Il payload documentato di `card_drawn` ha solo `card_id` e non dice di quale magia si tratti.
- **Dove:** `adapter.ts` §3 (`decodeHandCard`), §4 (`encodeClientIntent`).
- **Se falsa** (manca `spell_id`): `card_id` viene trattato come `spell_id` e l'adapter genera un id
  d'istanza solo locale (`instanceIdIsLocal: true`) + warning `card_spell_id_missing`.
- **Richiesta:** P0-4.

### G3 — Formato di `cast_spell.targets`
- **Stato:** non verificata
- **Assunzione:** array di caselle algebriche in ordine semantico: `["e4"]` per un bersaglio singolo,
  `["e4","e6"]` per Teleport (origine, destinazione). `[]` per `target_type: none`.
- **Motivo:** se il formato è sbagliato, nessuna magia con bersaglio funziona.
- **Dove:** `adapter.ts` §4.
- **Se falsa:** si cambia solo l'encoder.
- **Richiesta:** P1-3 (un codice d'errore dedicato renderebbe il problema diagnosticabile).

### G4 — Contenuto di `game_start`
- **Stato:** non verificata
- **Assunzione:** oltre ai campi documentati (`room_id, white, black, fen`), `game_start` contiene lo
  stato iniziale completo: `white_time, black_time, moves, time_control {initial_ms, increment_ms},
  pieces, phase, active_player, turn_number, hand, hand_sizes {username: n}, deck_sizes {username: n},
  mana {username: {current, max}}`.
- **Motivo:** determina se la UI si popola con un solo messaggio.
- **Dove:** `adapter.ts` §3 (`decodeGameStart`).
- **Se falsa:** i campi mancanti diventano `null` nello snapshot + warning `snapshot_incomplete`.
  Il reducer (Step 3) completa lo stato con i primi `game_state`/`phase_changed`/`mana_changed`/
  `hand_size_changed`/`card_drawn`.
- **Richiesta:** P1-2.

### G5 — Stato alla riconnessione
- **Stato:** non verificata
- **Assunzione:** ricollegandosi a `/ws` entro `RECONNECT_TIMEOUT`, il server rimanda un **`game_start`
  completo** (stesso `room_id`, stesso formato di G4), non un tipo di messaggio nuovo. Il client lo tratta
  come sostituzione totale dello stato.
- **Motivo:** se il server rimanda solo la FEN, dopo il reconnect la mano è vuota.
- **Dove:** `adapter.ts` §3 (`decodeGameStart`, stesso decoder). La sostituzione totale spetta al reducer.
- **Se falsa:** vale lo stesso fallback di G4.
- **Richiesta:** P1-2.

### G6 — Payload `error`
- **Stato:** non verificata
- **Assunzione:** `{ code?: string, message?: string }`. È tollerata anche una stringa nuda, `null` o
  qualunque altro valore: il decoder non fallisce mai su `error`.
- **Motivo:** decide se si possono mostrare messaggi specifici.
- **Dove:** `adapter.ts` §3 (`decodeError`).
- **Se falsa:** `code: null` → la UI mostra un messaggio generico. `message` non viene **mai** mostrato.
- **Richiesta:** P1-3.

### G7 — Rifiuto di una singola azione
- **Stato:** non verificata
- **Assunzione:** il server non correla un `error` all'azione che lo ha causato. Il client tiene una sola
  `pendingAction`: un `error` che arriva mentre è in volo la annulla; timeout di sicurezza 5s.
- **Motivo:** serve a fare il rollback della mossa ottimista giusta.
- **Dove:** logica di dispatch/store (Step 3). L'adapter si limita a normalizzare `error`.
- **Richiesta:** P1-3.

### G8 — `spell_cast.effects_applied[]`
- **Stato:** non verificata
- **Assunzione:** `[{ kind, piece_id?, square?, params? }]`. `kind` appartiene allo spazio degli effetti
  di magia del catalogo (`destroy_piece`, `freeze_piece`, …).
- **Motivo:** guida le animazioni.
- **Dove:** `adapter.ts` §3 (`decodeAppliedEffects`).
- **Se falsa:** ogni elemento viene validato singolarmente. Quelli malformati sono scartati con warning
  `effect_malformed`, il resto dell'evento resta valido. I `kind` sconosciuti vengono conservati: li
  gestisce il registry (Step 5).

### G9 — Time control
- **Stato:** non verificata
- **Assunzione:** coda unica e time control deciso dal server. La lobby non ha selettore; la UI mostra
  i tempi ricevuti (`time_control` in G4 se presente, altrimenti `white_time`/`black_time`).
- **Richiesta:** P2-1.

### G10 — Endpoint del catalogo magie
- **Stato:** non verificata
- **Assunzione:** `GET /spells` restituisce un array di magie (si accetta anche `{ spells: [...] }`).
  Se risponde 404, il client usa `src/spells/fallback.json` e mostra un warning in sviluppo.
- **Dove:** `adapter.ts` §7 (`normalizeSpellCatalog`). La scelta del fallback spetta a `catalog.ts` (Step 5).
- **Se falsa:** le voci invalide vengono scartate una per una con warning, mai il catalogo intero.
- **Richiesta:** P1-1.

### A11 — Contratto di registrazione e password policy
- **Stato:** non verificata
- **Assunzione:** `POST /auth/register {username, password}` → `201 {id, username, elo}`.
  Username: 3–20 caratteri `[A-Za-z0-9_]`. Password: 8–72 caratteri (72 è il limite in byte di bcrypt).
  Errori: `400 {error: "invalid_username"|"invalid_password"}`, `409 {error: "username_taken"}`.
- **Motivo:** §3.1 elenca gli endpoint ma non i body; §7.1 chiede di mostrare i requisiti prima del submit.
- **Dove:** `adapter.ts` §5. I valori della policy stanno in un'unica costante esportata dall'adapter.
- **Richiesta:** P1-4.

### A12 — Login, profilo ed errori REST
- **Stato:** non verificata
- **Assunzione:** `POST /auth/login {username, password}` → `200 {token, user: {id, username, elo}}`;
  `401 {error: "invalid_credentials"}`. `GET /me` → `{id, username, elo, wins, losses, draws}`.
  `GET /users/{id}` → come `/me`. `GET /users/{id}/games` → `[{id, room_id, white, black, result, reason,
  ended_at}]`. `GET /leaderboard` → `[{id, username, elo}]`. `GET /ws/ticket` → `{ticket, expires_in}`.
  Errori generici: `{error: string}` con 400/401/404/409/429. Gli id utente possono essere numeri o stringhe
  e vengono normalizzati a stringa.
- **Dove:** `adapter.ts` §5, §6.
- **Richiesta:** P1-4.

### A13 — Significato di `turn_number`
- **Stato:** non verificata
- **Assunzione:** contatore globale che parte da 1 e cresce di 1 a ogni cambio di giocatore attivo
  (turno 1 = primo turno del bianco, turno 2 = primo turno del nero). Il client lo mostra soltanto e non
  ne ricava mana né altro.
- **Dove:** `adapter.ts` §3 (`decodePhaseChanged`). Nessuna trasformazione.

### A14 — Dimensione del mazzo
- **Stato:** non verificata
- **Assunzione:** nessun messaggio documentato aggiorna la dimensione dei mazzi, che §2 chiede di mostrare.
  Si assume un campo `deck_size` dentro `hand_size_changed`. Il valore iniziale arriva da `deck_sizes` (G4).
- **Se falsa:** `deckSize: null` → la UI mostra il dato come sconosciuto. **Non** lo deduce contando le pescate.
- **Dove:** `adapter.ts` §3 (`decodeHandSizeChanged`).
- **Richiesta:** P1-5.

### A15 — Valori fuori dominio
- **Stato:** non verificata
- **Assunzione:** gli enum (`phase`, `reason`, `result`, `board.status`, `turn`) possono ricevere valori
  nuovi. Per `board.status` il solo valore noto è `active`.
- **Se falsa:** un valore sconosciuto diventa `'unknown'` + warning `enum_unknown`; un tempo negativo o non
  finito viene portato a 0 + warning `number_out_of_range`. Un campo **identitario** mancante (es.
  `fen`, `player`) invece rende il messaggio `malformed_payload`.
- **Dove:** `adapter.ts` §2–§3.

### A16 — Ritorno dell'avversario dopo `opponent_disconnected`
- **Stato:** non verificata
- **Assunzione:** nessun messaggio segnala che l'avversario si è riconnesso. Il banner resta finché non
  arriva un evento di gioco originato dall'avversario o un `game_over`.
- **Dove:** reducer (Step 3); l'adapter non è coinvolto.
- **Richiesta:** P1-6.

### A17 — Rifiuto di un'offerta di patta
- **Stato:** non verificata
- **Assunzione:** chi offre patta non riceve alcuna notifica del rifiuto (`draw_declined` esiste solo
  client→server). L'offerta pendente decade al successivo cambio di giocatore attivo.
- **Richiesta:** P2-4.

### A18 — Stati persistenti dei pezzi e doppia notifica
- **Stato:** non verificata
- **Assunzione:** i `kind` di `effect_applied`/`effect_expired`/`pieces[].effects` (es. `freeze`, `shield`)
  sono uno spazio **distinto** da quello degli effetti di magia (`freeze_piece`, `shield_piece`).
  Una magia con effetto persistente produce sia la voce in `spell_cast.effects_applied` (animazione)
  sia un `effect_applied` separato (stato). Il reducer deve essere idempotente.
- **Motivo:** l'esempio del briefing usa `effect_kind: "freeze"` mentre il catalogo usa `freeze_piece`.
- **Richiesta:** P2-3.

### A19 — Numero di bersagli di una magia
- **Stato:** non verificata
- **Assunzione:** il catalogo dichiara solo `target_type` (un bersaglio), ma Teleport ne richiede due
  (origine e destinazione, G3). Si assume che il secondo bersaglio sia una proprietà del **kind**
  dell'effetto (`move_piece` richiede una destinazione), non della singola magia: il client la dichiarerà
  nel registry degli effetti (Step 5), senza rami dedicati a `teleport`.
- **Motivo:** §5.1.3 vieta di scrivere codice per una magia specifica; se manca un dato, va aggiunto al modello.
- **Se falsa:** si aggiunge un campo al catalogo e lo si legge in `adapter.ts` §7.
- **Richiesta:** P2-5.

---

## Regole del mock (M)

Comportamenti di gioco che §3.4 non definisce. Il mock li implementa per essere **severo**; il client non
li replica mai. Da confermare col server (P2-3).

| # | Regola |
|---|---|
| M1 | **Shield**: il pezzo non può essere bersaglio di magie avversarie **né catturato** con una mossa. Shield sul re non cambia le regole dello scacco. |
| M2 | **Teleport**: destinazione = casella **vuota** raggiungibile con una mossa legale non speciale del pezzo (niente catture, en passant, arrocco né promozione), calcolata come se toccasse a chi lancia. Un pezzo congelato non si teletrasporta (`piece_frozen`). Non fa avanzare la fase. |
| M3 | **Fireball** non può bersagliare il re. |
| M4 | Dopo una magia che modifica la scacchiera la posizione resta legale: chi **non** ha il tratto secondo la FEN non può essere sotto scacco, e chi lancia non può mettersi da solo sotto scacco. Altrimenti `invalid_target`. |
| M5 | Gli effetti con durata si decrementano nell'`end_turn` del **proprietario del pezzo**; a 0 scadono con `effect_expired`. |
| M6 | Si pesca anche nel primo turno. Mana iniziale 1/1. All'inizio del k-esimo turno di un giocatore: `max = min(10, 1 + floor((k-1)/2))`, `current = max`. `gain_mana` può portare `current` oltre `max`, fino a 10. |
| M7 | Matto, stallo, materiale insufficiente e regola delle 50 mosse si valutano con le regole standard **subito dopo ogni mossa** (le magie del turno successivo non possono salvare un matto). In più, all'ingresso in fase `move`, se i filtri (pezzi congelati, Shield) lasciano zero mosse: matto se il re è sotto scacco, altrimenti stallo. |
| M8 | Corre l'orologio del giocatore attivo per tutto il suo turno, in ogni fase. |
| M9 | `resign` è ammesso in qualunque momento da entrambi. `draw_offer` solo dal giocatore attivo. `draw_accepted`/`draw_declined` solo da chi ha ricevuto un'offerta pendente. |
| M10 | Ordine dei messaggi dopo un cast: `spell_cast` → `mana_changed` → `effect_applied`*/`card_drawn`* → `hand_size_changed` → `game_state` (se la scacchiera è cambiata). |
| M11 | Codici `error` del mock: `malformed_message`, `unknown_message_type`, `no_active_game`, `not_your_turn`, `wrong_phase`, `illegal_move`, `piece_frozen`, `target_shielded`, `insufficient_mana`, `card_not_in_hand`, `unknown_spell`, `invalid_target`, `no_draw_offer`. |
| M12 | A fine turno, se c'erano effetti attivi, il mock rimanda un `game_state` con i `remaining_turns` aggiornati. Gli override `startingMaxMana` e `deckTop` esistono **solo** per gli scenari e i test, non sono regole di gioco. |
