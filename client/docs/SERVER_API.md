# chess-server — Cheatsheet API (per client Unreal Engine)

Riferimento completo per collegarsi al server e usarlo. Tutti i dettagli sono presi direttamente dal
codice del server (`chess-server`).

---

## 0. Concetti base

Il server ha **due canali**:

| Canale | A cosa serve | Tecnologia |
|--------|--------------|-----------|
| **REST/HTTP** | registrazione, login, refresh token, profilo, classifica, storico partite | HTTP + JSON |
| **WebSocket** | matchmaking e gioco in tempo reale (mosse, timer, fine partita) | WebSocket + JSON |

- **Base URL HTTP**: `http://localhost:8080`
- **Base URL WebSocket**: `ws://localhost:8080/ws`
- Tutte le richieste/risposte sono **JSON**.
- L'autenticazione è via **JWT**: ottieni un `access_token` dal login e lo usi su tutte le chiamate protette.

### Forma standard delle risposte REST
Quasi tutte le risposte REST hanno questo involucro:
```json
{ "success": true,  "data": { ... } }
{ "success": false, "error": "messaggio di errore" }
```
> ⚠️ Anche `/leaderboard` è incapsulato: i dati sono in `data` (un array), **non** alla radice.

---

## 1. Autenticazione (flusso)

```
register  ──►  login  ──►  (usi access_token)  ──►  [quando scade] refresh ──► nuovo access_token
```

- **access_token**: scade dopo **24 ore**. Va in `Authorization: Bearer <token>` su ogni endpoint protetto.
- **refresh_token**: scade dopo **30 giorni**. Serve solo per ottenere un nuovo access_token via `/auth/refresh`.
- Claims dentro l'access_token: `user_id`, `username`, `type:"access"`, `exp`.

### Regole di validazione registrazione
- **username**: 3–20 caratteri, solo `a-z A-Z 0-9 _`.
- **email**: formato email valido.
- **password**: 8–72 caratteri, almeno **una maiuscola**, **una minuscola**, **un numero**.

---

## 2. Endpoint REST

### Legenda
- 🔓 pubblico · 🔒 richiede `Authorization: Bearer <access_token>`

---

### 🔓 `GET /status`
Health check (controlla anche il DB).
```json
// 200 (o 503 se DB down)
{ "success": true, "data": { "status": "ok", "version": "0.1.0" } }
```

---

### 🔓 `POST /auth/register`
**Body**
```json
{ "username": "mario", "email": "mario@test.it", "password": "Password1" }
```
**Risposta**
```json
// 200
{ "success": true, "data": { "user_id": 42 } }
// 400 dati/validazione, 409 username o email già in uso
{ "success": false, "error": "Username o email già in uso" }
```

---

### 🔓 `POST /auth/login`
**Body**
```json
{ "email": "mario@test.it", "password": "Password1" }
```
**Risposta**
```json
// 200
{
  "success": true,
  "data": {
    "tokens": {
      "access_token": "eyJ...",
      "refresh_token": "eyJ..."
    },
    "user": { "id": 42, "username": "mario", "email": "mario@test.it", "elo": 1200 }
  }
}
// 401
{ "success": false, "error": "Credenziali non valide" }
```
> Da salvare lato client: `data.tokens.access_token` (e refresh), `data.user.id`/`username`.

---

### 🔓 `POST /auth/refresh`
**Body**
```json
{ "refresh_token": "eyJ..." }
```
**Risposta** — nota: i token sono **direttamente in `data`** (non dentro `tokens`):
```json
// 200
{ "success": true, "data": { "access_token": "eyJ...", "refresh_token": "eyJ..." } }
// 401 token scaduto/non valido
```

---

### 🔒 `GET /me`
Profilo dell'utente loggato.
```json
{ "success": true, "data": { "id": 42, "username": "mario", "email": "mario@test.it", "elo": 1200, "created_at": "2026-06-30T10:00:00Z" } }
```

---

### 🔓 `GET /leaderboard`
Top 10 per ELO.
```json
{
  "success": true,
  "data": [
    { "rank": 1, "id": 3, "username": "alice", "elo": 1640 },
    { "rank": 2, "id": 42, "username": "mario", "elo": 1512 }
  ]
}
```

---

### 🔓 `GET /users/{id}`
Profilo pubblico + statistiche.
```json
{
  "success": true,
  "data": {
    "user":  { "id": 42, "username": "mario", "elo": 1200, "created_at": "..." },
    "stats": { "wins": 10, "losses": 5, "draws": 2, "total": 17 }
  }
}
// 404 se l'utente non esiste
```

---

### 🔒 `GET /users/{id}/games`
Ultime 20 partite dell'utente (come bianco o nero).
```json
{
  "success": true,
  "data": [
    {
      "id": 101,
      "white": "mario",
      "black": "alice",
      "result": "1-0",
      "time_control": "10+0",
      "pgn": "1. e2e4 e7e5 2. g1f3 ...",
      "played_at": "2026-06-30T12:00:00Z"
    }
  ]
}
```

---

## 3. WebSocket — connessione e matchmaking

### Connessione
```
ws://localhost:8080/ws?token=<ACCESS_TOKEN>
```
> 🔑 **Importante per Unreal/browser**: il token va passato come **query param `?token=`**.
> Il server accetta anche `Authorization: Bearer` come header, ma molti client WebSocket
> (incluso il browser) non permettono header custom sull'handshake → usa il query param.
> In Unreal con il modulo `WebSockets` puoi comunque impostare header, ma il query param è la via più sicura.

### Matchmaking (automatico)
1. Apri la connessione WS → entri in **coda**.
2. Quando un **secondo** giocatore si connette, il server crea una partita e accoppia i due.
   - Il **primo** ad essere in attesa gioca **Bianco**, il secondo **Nero** (il bianco muove per primo).
3. Entrambi ricevono subito un messaggio `game_state` con la posizione iniziale.
4. **Per rimettersi in coda dopo una partita**: il server accoda solo al momento della connessione,
   quindi **chiudi e riapri** la connessione WS (non esiste un messaggio "re-queue").

### Riconnessione
Se cadi durante una partita hai **30 secondi** per riconnetterti (riaprendo il WS con lo stesso utente):
ricevi un `game_state` con `reconnected: true`. Oltre i 30s, partita persa per abbandono.

### ⚠️ Il server NON comunica il tuo colore
I messaggi `game_state` **non** dicono se sei Bianco o Nero, né il nome dell'avversario.
Devi dedurlo (es. memorizzando chi muove quando una tua mossa viene accettata) oppure
attivare il messaggio `game_start` commentato in `internal/game/manager.go` lato server.

### Rate limiting WS
Max **5 messaggi/secondo** (burst 10) per client; oltre, ricevi un `error`.

---

## 4. WebSocket — Messaggi CLIENT → SERVER

Formato generale (sempre):
```json
{ "type": "<tipo>", "payload": { ... } }
```

| `type` | `payload` | Descrizione |
|--------|-----------|-------------|
| `move` | `{ "move": "e2e4" }` | Esegue una mossa (notazione **UCI**). Solo in fase `move`. Promozione: `e7e8q` (q/r/b/n). |
| `pass_phase` | `{}` | Passa alla fase successiva. Solo nelle fasi `draw`/`main1`/`main2`. |
| `cast_spell` | `{ "spell_id": "spark", "targets": [] }` | Lancia una magia. Solo in `main1`/`main2`. `targets`: vuoto per `target_type:none`, una casella (es. `["e7"]`) per `enemy_piece`. |
| `resign` | `{}` | Abbandoni: l'avversario vince. |
| `draw_offer` | `{}` | Offri patta all'avversario. |
| `draw_accepted` | `{}` | Accetti una patta ricevuta. |
| `draw_declined` | `{}` | Rifiuti una patta ricevuta. |

---

## 5. WebSocket — Messaggi SERVER → CLIENT

| `type` | Quando | Payload | Destinatario |
|--------|--------|---------|--------------|
| `game_state` | inizio partita e dopo ogni mossa/magia che cambia la board | vedi sotto | entrambi |
| `phase_changed` | cambio di fase/turno | `{ "phase", "active_player", "turn_number" }` | entrambi |
| `mana_changed` | il mana di un giocatore cambia | `{ "player": "white|black", "current", "max" }` | entrambi |
| `hand` | snapshot della **tua** mano (inizio partita + riconnessione) | `{ "hand": ["spark",...], "mana", "max_mana", "deck_size" }` | solo proprietario |
| `card_drawn` | hai pescato **tu** | `{ "card_id": "jolt", "deck_size": 35 }` | solo chi pesca |
| `hand_size_changed` | cambia la dimensione di una mano | `{ "player", "size" }` | entrambi |
| `spell_cast` | una magia è stata giocata | `{ "player", "spell_id", "targets", "effects_applied":[{ "kind", "target"?, "piece_destroyed"?, "remaining_turns"? }] }` | entrambi |
| `effect_expired` | un effetto persistente scade/si consuma | `{ "square", "effect_kind":"freeze|shield", "piece_id"? }` | entrambi |
| `timer_update` | ogni 1 secondo | `{ "white_time": ms, "black_time": ms, "turn": "white|black" }` | entrambi |
| `game_over` | fine partita | `{ "result": "1-0|0-1|1/2-1/2", "reason": "...", "winner": "username" }` (`winner` assente se patta) | entrambi |
| `error` | mossa illegale, fuori turno/fase, cast invalido, ecc. | `{ "message": "..." }` | mittente |
| `draw_offer` | l'avversario offre patta | `{ "from": "username" }` | avversario |
| `draw_offer_sent` | conferma della tua offerta | `{ "message": "..." }` | offerente |
| `draw_declined` | l'avversario rifiuta la tua patta | `{ "message": "..." }` | offerente |
| `opponent_disconnected` | l'avversario è caduto | `{ "message": "..." }` | avversario |
| `opponent_reconnected` | l'avversario è tornato | `{ "message": "..." }` | avversario |

### Payload di `game_state` (stato PUBBLICO)
```json
{
  "board": {
    "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    "moves": ["e2e4", "e7e5"],
    "turn": "white",
    "status": "active"
  },
  "white_time": 600000,
  "black_time": 600000,
  "phase": "draw",
  "active_player": "white",
  "turn_number": 1,
  "white_mana": 1, "white_max_mana": 1,
  "black_mana": 1, "black_max_mana": 1,
  "white_hand_size": 4, "black_hand_size": 4,
  "white_deck_size": 36, "black_deck_size": 36,
  "active_effects": [ { "square": "e7", "effects": [ { "kind": "freeze", "remaining_turns": 2 } ] } ],
  "reconnected": true   // presente SOLO nel game_state inviato a chi si riconnette
}
```
- `board.turn`: `"white"` o `"black"` — lato al tratto **negli scacchi** (si ribalta alla mossa).
- `board.status`: `"active"`, `"checkmate"`, `"stalemate"`, `"draw"`.
- `white_time` / `black_time`: **millisecondi** rimanenti.
- `phase`: fase corrente della FSM del turno (vedi §10). `active_player`: chi gioca il turno (FSM).
- `*_hand_size` / `*_deck_size`: solo **conteggi** (anti-cheat: mai le carte avversarie).
- ⚠️ `active_player` (turno-FSM) e `board.turn` (tratto scacchi) possono divergere durante le fasi main.

### `reason` di `game_over`
`checkmate` · `stalemate` · `draw` · `agreement` (patta concordata) · `resign` · `timeout` ·
`abandonment` (disconnessione oltre 30s) · `server_shutdown`.

---

## 5.1 Card game: fasi (FSM), mana, magie

### Fasi del turno
Ogni turno scorre: **`draw → main1 → move → main2 → end_turn`** → poi turno avversario (`draw`).

| Fase | Azioni del giocatore attivo | Note |
|------|-----------------------------|------|
| `draw` | — | **auto-passata**: il client non la vede (la pesca avviene lo stesso) |
| `main1` | `cast_spell`, `pass_phase`, `resign`, `draw_offer` | mostrata solo se hai una carta giocabile |
| `move` | `move`, `resign`, `draw_offer` | mossa **obbligatoria**, **niente** `pass_phase` |
| `main2` | `cast_spell`, `pass_phase`, `resign`, `draw_offer` | mostrata solo se hai una carta giocabile |
| `end_turn` | nessuna | transizione server-side, mai osservata |

- Dopo una **mossa** valida la fase avanza da sola a `main2` (stesso giocatore): **non** mandare `pass_phase`.
- Una **magia non passa il turno**: dopo il cast resti nella stessa fase.

### Mana
- Parte da **1** al turno 1, **+1** ad ogni proprio turno, **cap 10**; si ricarica a inizio turno.
- Stato pubblico in `game_state` (`*_mana`/`*_max_mana`) e aggiornamenti via `mana_changed`.

### Mazzo & mano
- Mazzo **40** carte, mano iniziale **4**. Il **Bianco salta la pesca al turno 1** (stile Hearthstone).
- La **tua** mano arriva via `hand` (snapshot) e `card_drawn` (singola pesca).
- Della mano/mazzo avversari conosci **solo i conteggi** (`*_hand_size`, `*_deck_size`).

### Catalogo magie (set MVP)
| ID | Nome | Costo | `target_type` | Effetto |
|----|------|-------|---------------|---------|
| `spark` | Spark | 1 | `none` | noop |
| `jolt` | Jolt | 2 | `none` | noop |
| `pulse` | Pulse | 2 | `none` | noop |
| `surge` | Surge | 3 | `none` | noop |
| `nova` | Nova | 5 | `none` | noop |
| `disintegrate` | Disintegrate | 4 | `enemy_piece` | `destroy_piece` (rimuove un pezzo nemico, mai il re) |
| `frostbolt` | Frost Bolt | 2 | `enemy_piece` | `freeze_piece` (congela un pezzo nemico per 2 suoi turni) |
| `aegis` | Aegis | 3 | `own_piece` | `shield_piece` (protegge un pezzo proprio, assorbe 1 cattura, 2 turni) |
| `insight` | Insight | 1 | `none` | `draw_card` (peschi 1 carta extra → `card_drawn` privato) |
| `channel` | Channel | 0 | `none` | `gain_mana` (+2 mana solo per questo turno) |
| `teleport` | Teleport | 3 | `piece_move` | `move_piece` (sposta un tuo pezzo su una casella vuota) |

**Target types** e `targets` da inviare in `cast_spell`:
- `none` → `[]` · `enemy_piece`/`own_piece` → **una** casella (es. `["e7"]`) · `piece_move` → **due**
  caselle `[partenza, arrivo]` (es. `["b1","c3"]`, destinazione **vuota**).

- `noop` = costa mana e va nello scarto, ma non tocca la board (utile a testare mana/mano).
- `disintegrate`/`teleport` cambiano la FEN → arriva un `game_state`. `frostbolt`/`aegis` **non**
  cambiano la FEN: applica gli effetti da `spell_cast.effects_applied` (`{kind, target, remaining_turns}`).
- `insight`/`channel` toccano solo mano/mana (`card_drawn`, `mana_changed`). `teleport` è rifiutato
  (senza costo) se scoprirebbe il proprio re.
- **Anti-cheat**: gli effetti li decide il server (`effects_applied`); il client li visualizza, non li simula.

### Effetti persistenti (freeze/shield)
- Stato attuale in `game_state.active_effects`: `[{ "square", "effects":[{ "kind":"freeze|shield", "remaining_turns" }] }]`.
- Rimozione via `effect_expired` `{ "square", "effect_kind":"freeze|shield" }`.
- **freeze**: il pezzo non può muoversi (il server rifiuta la mossa). **shield**: assorbe una cattura
  (il server rifiuta la mossa avversaria e manda `effect_expired` per consumarlo).

### Auto-avanzamento delle fasi
- Il server **auto-passa** le fasi che non richiedono input: `draw` è **sempre** saltata (il client non
  la vede mai; la pesca avviene lo stesso → `card_drawn`/`mana_changed`). `main1`/`main2` sono saltate
  se non hai nulla di castabile.
- Possono arrivare **più `phase_changed` in sequenza**: reagisci a ciascuno, non assumere una fase per volta.
- Manda `pass_phase` **solo** in `main1`/`main2` (dove il server si è fermato perché *puoi* castare).

---

## 6. Formati dati

### Mosse: UCI
`<casa-origine><casa-destinazione>[<promozione>]`
- `e2e4` — pedone da e2 a e4
- `e1g1` — arrocco corto (re da e1 a g1); `e1c1` arrocco lungo
- `e7e8q` — promozione a Donna (`q`=donna, `r`=torre, `b`=alfiere, `n`=cavallo)

### Posizione: FEN
6 campi separati da spazio:
`<pezzi> <colore-al-tratto> <arrocchi> <en-passant> <half-move> <full-move>`
Es: `rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1`
- Pezzi per **rank dall'8 all'1**, file dalla a alla h. Maiuscole = Bianco, minuscole = Nero. I numeri = case vuote consecutive.
- Per disegnare la scacchiera in Unreal: parsi solo il **primo campo** (`fen.Split(' ')[0]`).

### Risultati
`1-0` (vince il Bianco) · `0-1` (vince il Nero) · `1/2-1/2` (patta).

### Tempo
Sempre in **millisecondi** (interi). Default partita: **10 minuti base + 5 secondi di incremento** per mossa.

---

## 7. Sequenza tipica di una partita

```
[REST]  POST /auth/login                    → access_token
[WS]    connetti ws://.../ws?token=...       → (in coda)
[WS] ← game_state (posizione iniziale, turn=white)
[WS] → {type:"move", payload:{move:"e2e4"}}
[WS] ← game_state (moves=["e2e4"], turn=black)
[WS] ← timer_update ... (ogni secondo)
        ... si alternano move / game_state ...
[WS] ← game_over ({result, reason, winner})
[WS]    chiudi la connessione
        (per rigiocare: riapri il WS → torni in coda)
```

---

## 8. Note di implementazione per Unreal Engine

- **HTTP**: usa il modulo **`HTTP`** (`FHttpModule::Get().CreateRequest()`); imposta header
  `Content-Type: application/json` e, sugli endpoint protetti, `Authorization: Bearer <token>`.
- **WebSocket**: usa il modulo **`WebSockets`** (`FWebSocketsModule::Get().CreateWebSocket(Url)`).
  Passa il token nell'URL come `?token=...`. Collega i delegate `OnConnected`, `OnMessage`,
  `OnClosed`, `OnConnectionError`.
- **JSON**: usa **`Json`** + **`JsonUtilities`** (`FJsonSerializer`, `TJsonReader`) per
  parse/serialize. Definisci USTRUCT con `UPROPERTY` per i payload se vuoi il binding automatico.
- **Thread**: i delegate di rete arrivano sul game thread di Unreal — ok per aggiornare la UI/scena
  direttamente, ma evita lavoro pesante lì dentro.
- **Moduli da abilitare** nel `.Build.cs`: `"HTTP"`, `"WebSockets"`, `"Json"`, `"JsonUtilities"`.
- **Mappa FEN → mesh**: tieni una `TMap<TCHAR, PieceType>` (`'P','N','B','R','Q','K'` bianchi,
  minuscoli neri) per istanziare i pezzi sulla scacchiera.
- **Limite colore**: poiché il server non comunica il colore, decidi una strategia (deduzione alla
  prima mossa accettata, oppure abilita `game_start` lato server).

---

## 9. Configurazione server (default)

| Variabile (`.env`) | Default | Significato |
|--------------------|---------|-------------|
| `SERVER_PORT` | `8080` | porta HTTP/WS |
| `DEFAULT_BASE_TIME` | `10m` | tempo base per giocatore |
| `DEFAULT_INCREMENT` | `5s` | incremento per mossa |
| `RECONNECT_TIMEOUT` | `30s` | finestra di riconnessione |
| `RATE_GENERAL` / `RATE_AUTH` / `RATE_WS` | `10` / `3` / `1` | rate limit (req/s) |
| `JWT_SECRET` | — | **obbligatorio**, firma i token |

Avvio: `go run main.go` (richiede PostgreSQL e Stockfish nel PATH).
