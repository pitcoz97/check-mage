# Briefing — Client web + mobile per CheckMage

> Documento da passare a Claude Code all'inizio della sessione come briefing di progetto.
> Non è un `CLAUDE.md`: quello va tenuto separato e contenente solo regole persistenti e comandi (vedi §13).

---

## 0. Come lavorare su questo progetto

- Entra in **Plan Mode** prima di iniziare ogni Step della roadmap (§11). Presenta il piano, aspetta approvazione, poi implementa.
- Il backend Go **esiste già ed è funzionante**, ma il suo codice sorgente **non è disponibile in questa fase**: non puoi leggerlo né eseguirlo. Sviluppi contro un **mock server** che implementa il contratto documentato in §3 (vedi §3.6 e Step 0).
- Il contratto in §3 è la migliore ricostruzione disponibile, non una lettura del codice. Dove è incerto, §3.6 lo dice esplicitamente. **Non colmare un'incertezza con un'invenzione silenziosa:** ogni assunzione va isolata nell'adapter, dichiarata in `docs/ASSUMPTIONS.md` e, se richiede una modifica al server, aggiunta a `docs/BACKEND-REQUESTS.md` (§3.7).
- Quando il codice del server tornerà disponibile, l'integrazione è lo Step 7. Fino ad allora nessuna riga di client deve dipendere da un dettaglio non documentato qui.
- Commit atomici, un commit per unità logica di lavoro, messaggi in stile Conventional Commits.

---

## 1. Obiettivo

Costruire il client di **CheckMage**, gioco online che combina **scacchi** e un **sistema di magie in stile Magic: The Gathering / Hearthstone**. Il nome incrocia *checkmate* e *mage*: la scacchiera resta il centro dell'esperienza, le magie sono lo strato che la rende diversa da qualunque altro client di scacchi.

Target di piattaforma, in ordine:
1. **Browser desktop** (esperienza primaria di sviluppo)
2. **Android** (stessa codebase, via Capacitor)
3. **iOS** (successivamente, stessa codebase — le scelte tecniche non devono precluderlo)

Scope della v1:
- Autenticazione (registrazione, login, sessione persistente) e profilo utente
- Matchmaking e partita live completa
- UI del layer magie: mano, mana, fasi del turno, targeting, effetti sui pezzi

Fuori scope v1 (ma l'architettura non deve ostacolarli): leaderboard, storico partite, replay, deckbuilding, spettatori, chat.

---

## 2. Vincoli non negoziabili

1. **Il server è autoritativo su tutto.** Il client non valida mosse, non calcola effetti di magie, non decide di chi è il turno, non gestisce i timer come fonte di verità. Ogni cambiamento di stato di gioco arriva da un messaggio WebSocket del server.
2. **Il client non conosce informazioni nascoste.** Vede la propria mano, la dimensione del proprio mazzo e di quello avversario, e la mano avversaria solo come numero di carte coperte. Non deve mai esistere una struttura dati client-side che contenga il mazzo completo o la mano avversaria.
3. **Nessun segreto nel bundle.** Nessuna chiave, nessun token hardcoded. Solo variabili `VITE_*` per URL di API/WS.
4. **Una sola codebase** per web, Android e iOS.
5. **Mai mostrare all'utente testo grezzo proveniente dal server.** Il server invia alcuni messaggi con testo in italiano (es. `opponent_disconnected`): il client mappa il `type` del messaggio sulle proprie stringhe localizzate e ignora il testo del payload.

---

## 3. Il backend esistente — contratto

**Stack server (contesto, non da modificare):** Go 1.23+, Chi v5, PostgreSQL 16, Gorilla WebSocket, Stockfish per la validazione mosse, JWT (golang-jwt v5), bcrypt, Uber Zap, rate limiting per IP (`RATE_GENERAL=10`, `RATE_AUTH=3`, `RATE_WS=1` req/s), CORS via `go-chi/cors`, graceful shutdown che salva le partite attive.

### 3.1 Endpoint REST

Base URL configurabile via env. Endpoint pubblici:

| Metodo | Path | Descrizione |
|---|---|---|
| `GET` | `/status` | Health check |
| `POST` | `/auth/register` | Registrazione |
| `POST` | `/auth/login` | Login, restituisce JWT |
| `GET` | `/leaderboard` | Top 10 per ELO |

Endpoint protetti (header `Authorization: Bearer <token>`):

| Metodo | Path | Descrizione |
|---|---|---|
| `GET` | `/me` | Profilo dell'utente corrente (letto live dal DB) |
| `GET` | `/users/{id}` | Profilo pubblico con statistiche vittorie/sconfitte/patte |
| `GET` | `/users/{id}/games` | Storico partite |
| `GET` | `/ws` | Upgrade WebSocket + ingresso in coda matchmaking |

Note operative:
- Il JWT scade dopo 24h. Gestisci la scadenza: 401 → logout pulito con ritorno al login, mai loop di retry.
- Il rate limit su `/auth/*` è 3 req/s: niente retry aggressivi sul login, e disabilita il bottone durante la richiesta.
- ELO: tutti partono da 1200, algoritmo FIDE standard con K=32, aggiornato a fine partita.

### 3.2 Protocollo WebSocket — messaggi base

Formato generico: `{ "type": string, "payload": object }`.

**Client → Server**
```jsonc
{ "type": "move",          "payload": { "move": "e2e4" } }   // notazione UCI
{ "type": "resign",        "payload": {} }
{ "type": "draw_offer",    "payload": {} }
{ "type": "draw_accepted", "payload": {} }
{ "type": "draw_declined", "payload": {} }
```

**Server → Client**
```jsonc
{ "type": "game_start", "payload": { "room_id": "room-1-2", "white": "mario", "black": "luigi", "fen": "rnbqkbnr/..." } }

{ "type": "game_state", "payload": { "board": { "fen": "...", "moves": ["e2e4"], "turn": "black", "status": "active" }, "white_time": 598000, "black_time": 600000 } }

{ "type": "timer_update", "payload": { "white_time": 597000, "black_time": 600000, "turn": "white" } }

{ "type": "game_over", "payload": { "result": "1-0", "reason": "checkmate", "winner": "mario" } }

{ "type": "draw_offer", "payload": { "from": "mario" } }

{ "type": "opponent_disconnected", "payload": { "message": "..." } }

{ "type": "error", "payload": { ... } }
```

I tempi sono in **millisecondi**. `timer_update` arriva circa ogni secondo.

Valori possibili di `reason` in `game_over`: `checkmate`, `stalemate`, `draw` (materiale insufficiente o regola delle 50 mosse), `agreement`, `resign`, `timeout`, `abandonment`, `server_shutdown`.

### 3.3 Protocollo WebSocket — layer magie

**Client → Server**
```jsonc
{ "type": "pass_phase",  "payload": {} }
{ "type": "cast_spell",  "payload": { "spell_id": "...", "targets": ["e4"] } }
{ "type": "move",        "payload": { "move": "e2e4" } }   // valido solo in fase "move"
```

**Server → Client**
```jsonc
{ "type": "phase_changed",     "payload": { "phase": "main1", "active_player": "mario", "turn_number": 7 } }
{ "type": "card_drawn",        "payload": { "card_id": "..." } }          // solo al giocatore che pesca
{ "type": "hand_size_changed", "payload": { "player": "luigi", "size": 5 } }
{ "type": "mana_changed",      "payload": { "player": "mario", "current": 4, "max": 5 } }
{ "type": "spell_cast",        "payload": { "player": "mario", "spell_id": "...", "targets": [...], "effects_applied": [...] } }
{ "type": "effect_applied",    "payload": { "piece_id": "...", "effect_kind": "freeze", "remaining_turns": 2 } }
{ "type": "effect_expired",    "payload": { "piece_id": "...", "effect_kind": "freeze" } }
```

**Regola critica:** `spell_cast` contiene `effects_applied` esplicito. Il client **anima** quello che il server dichiara, non ricalcola nulla. Questo evita desync.

### 3.4 Regole di gioco da rappresentare in UI

**Fasi del turno (FSM server-side):**

| Fase | Cosa succede | Azioni del giocatore attivo |
|---|---|---|
| `draw` | Pesca automatica di 1 carta, crescita mana | `pass_phase`, `resign`, `draw_offer` |
| `main1` | Si possono castare magie | `pass_phase`, `cast_spell`, `resign`, `draw_offer` |
| `move` | Mossa scacchistica **obbligatoria** | `move`, `resign`, `draw_offer` — **niente `pass_phase`** |
| `main2` | Si possono castare magie | `pass_phase`, `cast_spell`, `resign`, `draw_offer` |
| `end_turn` | Transizione automatica server-side (trigger di fine turno, decremento effetti) | nessuna azione client |

Dopo una mossa valida il server avanza **da solo** a `main2`: il client **non** manda `pass_phase` dopo aver mosso.

**Mana:** parte da 1, +1 ogni 2 turni del giocatore, cap 10, ricarica al massimo corrente all'inizio del turno. Nessuna carta risorsa/terra.

**Mazzo e mano:** mazzo da 40 carte, mano iniziale 4, pesca 1 per turno. Costi delle magie 1–8 mana. Se il mazzo finisce, semplicemente non si pesca (nessuna fatigue).

**Magie:** data-driven. Ogni magia è un record con `id`, `name`, `mana_cost`, `phases` (in quali fasi è giocabile), `target_type` (`none | square | piece | own_piece | enemy_piece`) e una lista di `effects`, ciascuno con `kind` e `params`.

**Catalogo Fase 1** — sei magie, tutte giocabili in `main1` e `main2`:

| id | Nome | Costo | Target | Effetto | Params |
|---|---|---|---|---|---|
| `fireball` | Fireball | 6 | `enemy_piece` | `destroy_piece` | — |
| `teleport` | Teleport | 5 | `own_piece` | `move_piece` | destinazione legale per quel pezzo |
| `ice_age` | Ice Age | 3 | `enemy_piece` | `freeze_piece` | `turns: 2` |
| `greed` | Greed | 3 | `none` | `draw_card` | `amount: 2` |
| `shield` | Shield | 2 | `own_piece` | `shield_piece` | `turns: 3` |
| `recover` | Recover | 1 | `none` | `gain_mana` | `amount: 3` |

Criterio dei costi, per riferimento in fase di bilanciamento: *Fireball* rimuove materiale in modo permanente ed è l'effetto più forte del set, quindi sta nella fascia alta — con la crescita del mana (+1 ogni 2 turni propri) arriva intorno all'undicesimo turno. *Teleport* concede di fatto una mossa extra senza consumare la mossa scacchistica del turno, quindi costa poco meno. *Ice Age* e *Greed* sono l'ossatura del mazzo a costo medio: la prima è tempo, la seconda è carte (spendi una carta per pescarne due, guadagno netto +1). *Shield* è difensiva e a costo basso. *Recover* costa 1 e ne restituisce 3, guadagno netto +2 nel turno: è l'unico acceleratore, e serve per rendere castabile una magia costosa un turno prima.

**Questi valori sono una proposta di design, non il contratto.** Se il server implementa costi o parametri diversi, vince il server: il client non li hardcoda mai, li legge dal catalogo (§5.1). Se emerge una discrepanza tra questa tabella e il codice Go, segnalamela invece di allineare il client a mano.

Due comportamenti da verificare lato server e da riflettere in UI:
- *Fireball* non deve poter bersagliare il re. Se il server lo permette, è un bug del server: segnalalo, non aggirarlo nel client.
- *Teleport* non consuma la mossa del turno: dopo la sua risoluzione la fase resta `main1`/`main2`, non avanza. La UI non deve suggerire il contrario.

**Composizione del mazzo (40 carte, condiviso e identico per i due giocatori in Fase 1).** Anche questa è server-side: se non è già definita, la proposta è `shield` ×10, `ice_age` ×8, `greed` ×6, `recover` ×6, `teleport` ×6, `fireball` ×4 — più copie di ciò che costa poco, così le prime mani sono quasi sempre giocabili.

**Effetti sui pezzi:** sono legati al **pezzo** tramite `piece_id`, non alla casella — seguono il pezzo quando si muove. La UI deve quindi disegnare i badge di effetto sul pezzo e farli viaggiare con lui. Un pezzo `freeze` non può muoversi: il server rifiuta la mossa, ma il client deve renderlo evidente **prima** che l'utente ci provi.

### 3.5 ⚠️ Blocco noto sull'autenticazione WebSocket

Il server oggi si aspetta il JWT nell'header `Authorization` sulla connessione `/ws`. **L'API WebSocket dei browser non permette di impostare header custom.** Funziona da un client nativo, non dal web: così com'è, il client non riuscirà mai a connettersi.

Opzioni, in ordine di preferenza:

1. **Ticket monouso (scelta adottata).** Endpoint protetto `GET /ws/ticket` che restituisce un token opaco a vita breve (30–60s, monouso, in memoria server-side). Il client si connette a `/ws?ticket=<t>`. Il JWT vero non finisce mai in un URL, quindi non nei log del server né nel Referer.
2. **Sec-WebSocket-Protocol.** JWT come subprotocollo: `new WebSocket(url, ["bearer", token])`. Funziona ovunque, ma usa un header di handshake per uno scopo non suo e va gestito lato Go.
3. **Query param diretto** `?token=<jwt>`. Semplice, ma il JWT finisce nei log e nella history: accettabile solo in sviluppo.

**Come procedere ora, senza il codice del server.** Il client viene scritto assumendo l'opzione 1, e il mock server implementa `GET /ws/ticket` esattamente così. La patch Go corrispondente è la richiesta **P0-1** in `docs/BACKEND-REQUESTS.md`, da applicare allo Step 7. Se al momento dell'integrazione risultasse più semplice l'opzione 2, deve bastare cambiare `ws/connection.ts`: incapsula lì l'intera strategia di autenticazione, dietro una funzione unica.

Stessa logica per il CORS: il server usa `go-chi/cors` e dovrà accettare `http://localhost:5173` in sviluppo e, per Capacitor, `capacitor://localhost` e `http://localhost`, altrimenti la build Android non riesce a chiamare le API. È la richiesta **P0-2**.

### 3.6 Zone grigie del contratto — non inventare, isola

Quello che segue **non è noto** e non va dedotto a intuito. Per ciascun punto: implementa l'assunzione indicata, isolala nell'adapter, scrivila in `docs/ASSUMPTIONS.md`, e apri la richiesta corrispondente in `docs/BACKEND-REQUESTS.md`.

| # | Cosa non sappiamo | Perché è bloccante | Assunzione da adottare |
|---|---|---|---|
| G1 | **Come il client associa un `piece_id` a una casella.** La FEN non contiene identificativi, ma `effect_applied` / `effect_expired` parlano per `piece_id`. | Senza mapping la UI non sa su quale pezzo disegnare il badge "congelato". È il buco più serio del contratto. | `game_state` include un array `pieces: [{ piece_id, square, type, color, effects: [...] }]`. Se non c'è, il client non lo ricostruisce per euristica: mostra gli effetti in un pannello laterale e logga la mancanza. |
| G2 | **`card_drawn.card_id`: è lo `spell_id` o un id di istanza?** | Con più copie della stessa magia in mano servono chiavi distinte per rendering, animazioni e cast. | Esiste un id di istanza univoco per carta in mano, distinto da `spell_id`. Modella `HandCard = { instance_id, spell_id }` fin da subito. |
| G3 | **Formato di `targets[]` in `cast_spell`.** Caselle algebriche, `piece_id`, o misto? `move_piece` ne richiede due. | Sbagliare il formato significa che nessuna magia con bersaglio funziona. | Array di caselle algebriche in ordine: `["e4"]` per bersaglio singolo, `["e4","e6"]` per Teleport (origine, destinazione). |
| G4 | **Contenuto di `game_start` per il layer magie.** Mano iniziale, mana, dimensione mazzi, fase iniziale. | Determina se serve una seconda interazione per popolare la UI a inizio partita. | `game_start` contiene già tutto lo stato iniziale. In subordine, il client tratta il primo `game_state` + `phase_changed` come inizializzazione. |
| G5 | **Stato del layer magie alla riconnessione.** | Se il server rimanda solo la FEN, dopo un reconnect la mano è vuota e la partita è ingiocabile. | Alla riconnessione il server rimanda uno stato completo equivalente a `game_start`. |
| G6 | **Struttura del payload `error`.** | Determina se si possono mostrare messaggi specifici o solo un generico. | `{ code?: string, message: string }`, tutto opzionale. Il client tollera anche una stringa nuda e non si rompe mai su un payload inatteso. |
| G7 | **Come il server rifiuta una singola azione** (mossa illegale, magia non castabile). | Serve per fare il rollback dell'azione ottimista giusta. | Il client tiene una `pendingAction`: un `error` che arriva mentre c'è un'azione in volo la annulla. Timeout di sicurezza 5s. |
| G8 | **Formato di `spell_cast.effects_applied[]`.** | È quello che guida le animazioni. | `[{ kind, piece_id?, square?, params }]`. Un effetto sconosciuto non viene animato ma viene loggato, e non blocca il resto. |
| G9 | **Scelta del time control nel matchmaking.** Oggi `/ws` mette in coda e basta. | Determina se la lobby ha o no un selettore. | Nessuna scelta in v1: coda unica, time control deciso dal server. La UI mostra quello ricevuto, non lo chiede. |
| G10 | **Endpoint del catalogo magie.** | Vedi §5.1. | Si tenta `GET /spells`; su 404 si usa `fallback.json` con un warning visibile in sviluppo. |

**Regola dell'adattatore.** Tutte le assunzioni qui sopra vivono in `src/api/adapter.ts`: funzioni che normalizzano il payload grezzo del server nei modelli interni del client. Il resto del codice conosce solo i modelli interni. Quando il server reale contraddirà un'assunzione, deve cambiare **quel file e nient'altro**. Se ti accorgi di stare scrivendo una normalizzazione fuori dall'adapter, fermati.

### 3.7 Richieste al backend

Mantieni `docs/BACKEND-REQUESTS.md` come registro vivo delle modifiche da chiedere al server. Ogni voce: **cosa serve, perché, contratto proposto in JSON, priorità, stato**. Aggiungine una ogni volta che incontri un limite del backend, anche piccolo — è il documento che porterò al server quando ne avrò di nuovo il codice.

Inizializzalo con queste, già note:

- **P0-1** — `GET /ws/ticket` e accettazione di `?ticket=` su `/ws` (§3.5). Senza, il client web non si connette.
- **P0-2** — CORS: `http://localhost:5173`, `capacitor://localhost`, `http://localhost` (§3.5).
- **P0-3** — `pieces[]` con `piece_id`, casella ed effetti attivi dentro `game_state` (G1).
- **P0-4** — id di istanza per le carte in mano, distinto da `spell_id` (G2).
- **P1-1** — `GET /spells`: catalogo completo con `id`, `name`, `mana_cost`, `phases`, `target_type`, `effects[]` (§5.1, G10).
- **P1-2** — stato completo del layer magie in `game_start` e alla riconnessione (G4, G5).
- **P1-3** — payload `error` strutturato con un codice macchina-leggibile (G6, G7).
- **P2-1** — scelta del time control nel matchmaking e annullamento esplicito della coda (G9).
- **P2-2** — conferma che *Fireball* non possa bersagliare il re e che *Teleport* non faccia avanzare la fase (§3.4).

---

## 4. Stack tecnico

| Area | Scelta | Note |
|---|---|---|
| Framework | **React 18 + TypeScript** (strict) | |
| Build | **Vite** | |
| Mobile | **Capacitor 6** | Android in v1, iOS predisposto |
| Styling | **Tailwind CSS** + CSS custom properties per i token | I token di §6 come variabili CSS, non valori sparsi nel markup |
| Stato | **Zustand** | Store a slice, vedi §8 |
| Routing | **React Router** | |
| Fetch REST | `fetch` wrappato in un client tipizzato | TanStack Query solo se serve davvero caching/refetch |
| Logica scacchi client-side | **chess.js** (BSD-2) | **Solo** per evidenziare mosse legali e disegnare le frecce. Mai come autorità. |
| Scacchiera | Componente **custom** (CSS grid + SVG) | Vedi nota licenze sotto |
| Test | **Vitest** + Testing Library | + un mock WebSocket server per i test di protocollo |
| Lint/format | ESLint + Prettier, `no-explicit-any` attivo | |

**Nota licenze — importante.** Non usare `chessground` di lichess né i set di pezzi di lichess: sono GPL e contaminerebbero la licenza del progetto. Se vuoi una libreria pronta usa `react-chessboard` (MIT). Per i pezzi, usa un set con licenza permissiva o generane uno SVG proprio; elenca in `CREDITS.md` provenienza e licenza di ogni asset.

Variabili d'ambiente: `VITE_API_BASE_URL`, `VITE_WS_URL`. Fornisci `.env.example`. `.env` in `.gitignore`.

---

## 5. Struttura del progetto

```
chess-client/
├── src/
│   ├── api/
│   │   ├── http.ts              # client REST tipizzato, injection del Bearer, gestione 401
│   │   ├── endpoints.ts         # funzioni per endpoint (login, register, me, ...)
│   │   ├── adapter.ts           # normalizzazione dei payload server -> modelli interni (§3.6)
│   │   └── types.ts             # tipi DTO del backend
│   ├── ws/
│   │   ├── connection.ts        # apertura, ticket, heartbeat, riconnessione con backoff
│   │   ├── protocol.ts          # union type discriminata di TUTTI i messaggi in/out
│   │   └── dispatch.ts          # instrada gli eventi server verso lo store
│   ├── store/
│   │   ├── authStore.ts
│   │   ├── matchStore.ts        # stato di gioco: unica fonte = eventi server
│   │   └── uiStore.ts           # modali, toast, modalità targeting, preferenze
│   ├── game/
│   │   ├── Board/               # scacchiera, caselle, pezzi, badge effetti, highlight
│   │   ├── Hand/                # carte in mano, fan layout, drag/tap per castare
│   │   ├── ManaBar/
│   │   ├── PhaseTrack/
│   │   ├── PlayerPanel/         # avatar, nome, ELO, timer, carte coperte
│   │   └── targeting.ts         # macchina a stati della selezione bersaglio
│   ├── spells/
│   │   ├── catalog.ts           # caricamento, validazione e cache del catalogo
│   │   ├── schema.ts            # schema runtime (zod) di Spell ed Effect
│   │   ├── effects.registry.tsx # EffectKind -> icona, colore, badge, animazione
│   │   ├── targets.registry.ts  # TargetType -> calcolo dei bersagli validi
│   │   └── fallback.json        # copia statica del catalogo, usata solo se il server non lo espone
│   ├── screens/
│   │   ├── Auth/                # Login, Register
│   │   ├── Lobby/               # home + ricerca partita
│   │   ├── Match/               # schermata di gioco
│   │   └── Profile/
│   ├── design/
│   │   ├── tokens.css           # variabili CSS (§6)
│   │   └── components/          # Button, Card, Modal, Toast, Avatar, ...
│   ├── i18n/                    # it (default), en
│   └── main.tsx
├── android/                     # generata da Capacitor
├── mock-server/                 # dev-only, mai nel bundle di produzione
│   ├── index.ts                 # REST + WebSocket conformi a §3.2–3.3, con /ws/ticket
│   ├── scenarios/               # sequenze scriptate per sviluppo e test
│   └── spells.json              # stesso catalogo di src/spells/fallback.json
├── docs/
│   ├── BRIEFING-CLIENT.md       # questo documento
│   ├── ASSUMPTIONS.md           # ogni assunzione presa al posto del server, con motivo
│   └── BACKEND-REQUESTS.md      # registro delle modifiche da chiedere al backend (§3.7)
├── capacitor.config.ts
└── .env.example
```

### 5.1 Estendibilità del catalogo magie — requisito di prima classe

Il set di sei magie di §3.4 è un punto di partenza: la collezione crescerà e verrà ribilanciata spesso. **Aggiungere una magia nuova, o cambiarne costo, parametri e testo, non deve richiedere modifiche ai componenti React.** Progetta il client con questo come vincolo, non come rifinitura successiva.

Regole concrete:

1. **Una sola fonte di verità.** Il catalogo si carica all'avvio della partita. Se il server espone un endpoint (es. `GET /spells`), quello è la fonte; `fallback.json` serve solo se l'endpoint non esiste ancora, ed è marcato come temporaneo. Non duplicare mai costi o parametri dentro i componenti.
2. **Validazione a runtime.** `schema.ts` definisce lo schema (zod) di `Spell` e `Effect` e lo applica alla risposta del server. I tipi TypeScript derivano dallo schema, non viceversa. Un catalogo malformato produce un errore diagnosticabile all'avvio, non un crash a metà partita.
3. **Zero `switch` su `spell_id`.** In nessun punto del client deve esistere un ramo di codice dedicato a una magia specifica. Se ti serve, vuol dire che manca un campo nel modello dati: aggiungi il campo.
4. **Registry per gli effetti.** `effects.registry.tsx` mappa `EffectKind` → `{ icon, color, label, badge, animation, describe(params) }`. Aggiungere un effetto = aggiungere una entry. La funzione `describe(params)` genera il testo di regole della carta a partire dai parametri, così cambiare `turns: 2` in `turns: 3` aggiorna la carta da sola.
5. **Registry per i bersagli.** `targets.registry.ts` mappa `TargetType` → funzione che, dato lo stato di gioco, restituisce le caselle valide da evidenziare. Aggiungere un tipo di bersaglio = aggiungere un resolver, senza toccare la scacchiera.
6. **Degradazione elegante sull'ignoto.** Il server può introdurre una magia o un effetto prima che il client sia aggiornato. Una magia con un `effect_kind` sconosciuto si renderizza comunque — nome, costo, testo grezzo, badge neutro — resta castabile, e il client logga l'anomalia. **Mai un crash, mai una carta invisibile.**
7. **Layout della carta indipendente dal contenuto.** Nome corto e nome lungo, testo di una riga e di quattro, costo a una cifra: la carta deve reggere tutti i casi senza troncamenti silenziosi e senza rompere il ventaglio della mano.
8. **Test di copertura del catalogo.** Un test che itera su tutto il catalogo e verifica che ogni `effect_kind` e ogni `target_type` abbia una entry nel rispettivo registry. Quando aggiungerò una magia, quel test dirà subito cosa manca.
9. **Storybook-like page in sviluppo.** Una rotta `/dev/cards`, attiva solo in `import.meta.env.DEV`, che mostra tutte le carte del catalogo in griglia con i loro stati (giocabile, mana insufficiente, fase sbagliata, in targeting). Serve a valutare il bilanciamento e la leggibilità a colpo d'occhio senza avviare una partita.

### 5.2 Il mock server

Finché il backend reale non è disponibile, il mock è l'unico interlocutore del client. Va preso sul serio: se è permissivo dove il server è severo, scopriremo il divario allo Step 7, che è il momento peggiore.

- **Stack:** Node + TypeScript, `express` + `ws`, avviabile con `npm run mock`. Tutto in `devDependencies`: non deve esistere alcun import dal mock dentro `src/`.
- **Deve implementare esattamente** §3.1 (inclusi i codici di errore e il rate limit su `/auth/*`), §3.2, §3.3, `GET /ws/ticket` e `GET /spells`, rispettando le assunzioni di §3.6.
- **Deve essere severo come il server:** valida le mosse con chess.js, rifiuta le azioni fuori fase, rifiuta un `cast_spell` con mana insufficiente o con una carta non in mano, rifiuta il movimento di un pezzo congelato. Ogni rifiuto produce un `error`, mai un silenzio.
- **Scenari scriptati** selezionabili da query param o variabile d'ambiente, perché servono a sviluppare e a testare: partita normale fino a matto, avversario che si disconnette e non torna, avversario che si riconnette entro la finestra, timeout sul tempo, offerta di patta, sequenza di magie che copre tutti e sei gli effetti, e uno scenario "server ostile" che manda payload malformati e messaggi di tipo sconosciuto.
- Lo scenario ostile non è un vezzo: è quello che garantisce che il client non si rompa quando il server reale farà qualcosa che questo documento non prevede.
- Due client collegati al mock devono poter giocare l'uno contro l'altro in due schede del browser.

---

## 6. Design system

**Riferimento dichiarato dal cliente: chess.com.** Segui quel linguaggio visivo per la parte scacchistica — non reinterpretarlo. La libertà creativa sta nel layer magie, che chess.com non ha.

### Palette (definisci come variabili CSS in `tokens.css`)

```css
--bg-app:        #302E2B;  /* sfondo applicazione, marrone-grigio caldo */
--bg-panel:      #262421;  /* pannelli, barre laterali */
--bg-elevated:   #3A3835;  /* card, dropdown, stati hover */
--border-subtle: #4A4844;

--board-light:   #EEEED2;
--board-dark:    #769656;
--board-hint:    rgba(20, 85, 30, 0.5);   /* mossa legale */
--board-last:    rgba(255, 255, 51, 0.5); /* ultima mossa */
--board-check:   #E02B2B;

--accent:        #81B64C;  /* verde primario: CTA "Gioca" */
--accent-hover:  #A3D160;
--text-primary:  #FFFFFF;
--text-muted:    #B8B8B8;
--danger:        #CA3431;
```

Layer magie — palette separata e usata **solo** lì, così il giocatore distingue a colpo d'occhio "scacchi" da "magia":

```css
--mana-full:     #3AA0E8;  /* cristallo mana carico */
--mana-empty:    #1E3A52;
--spell-frame:   #C9A227;  /* bordo carta */
--effect-freeze: #7FD8F7;
--effect-shield: #F0D264;
--effect-doom:   #B5479B;  /* destroy / debuff */
```

### Tipografia

- **Montserrat** per tutta la chrome dell'interfaccia (è la famiglia di chess.com): 600/700 per titoli e bottoni, 400/500 per il corpo.
- **Un solo** carattere di contrasto, usato **esclusivamente** per il nome della magia sulla carta: un serif con carattere (es. Cinzel). Non usarlo altrove, o l'app sembra un gioco fantasy generico invece di una scacchiera con sopra un sistema di magie.
- Scala tipografica: 12 / 14 / 16 / 20 / 28 / 40. Niente label in maiuscolo tracciato.

### Principi

- **La scacchiera è l'eroe.** Occupa il massimo spazio possibile; tutto il resto le sta intorno, silenzioso.
- **Spendi l'audacia in un punto solo:** la carta magia che si stacca dalla mano e si risolve sulla scacchiera. Tutto il resto è disciplinato.
- **Ogni elemento strutturale codifica informazione**, non decora: il bordo dorato distingue una carta giocabile ora, non è ornamento.
- **Motion:** solo movimento che risponde a un'azione o comunica un cambio di stato deciso dal server (mossa dell'avversario, magia risolta, effetto scaduto). Niente entrate fade-and-slide sui pannelli. Rispetta `prefers-reduced-motion`.
- **Quality floor:** responsive fino a 360px, focus visibile da tastiera, contrasto AA sul testo, hit target ≥44px sul touch.

---

## 7. Schermate

### 7.1 Auth
Login e registrazione, un solo campo per schermata concettuale, errori inline specifici (il server ha requisiti sulla password: mostrali **prima** del submit, non solo dopo il rifiuto). Sessione persistita; all'avvio, se c'è un token, valida con `GET /me` prima di mostrare la lobby.

### 7.2 Lobby
Profilo compatto in alto (avatar, username, ELO), il CTA "Gioca" come elemento dominante, stato della coda di matchmaking con possibilità di annullare. Empty state che invita all'azione, non che si scusa.

### 7.3 Match — desktop

```
┌────────────────────────────────────────────────────────────┐
│  [avversario] luigi  1240   🂠🂠🂠🂠🂠   ●●●●●○○○○○   ⏱ 09:58 │
├──────────────────────────────┬─────────────────────────────┤
│                              │  draw ▸ main1 ▸ move ▸ main2 │
│                              │  ─────────────────────────── │
│         SCACCHIERA           │  Storico mosse               │
│         (8x8, quadrata,      │  1. e4    e5                 │
│          max dimensione)     │  2. Cf3  ✦Congela            │
│                              │  ─────────────────────────── │
│                              │  [ Passa fase ]              │
│                              │  [ Patta ]  [ Abbandona ]    │
├──────────────────────────────┴─────────────────────────────┤
│  ⏱ 09:42   ●●●●○○○○○○  4/5      ┌──┐┌──┐┌──┐┌──┐           │
│  [io] mario  1252                │🂡││🂢││🂣││🂤│  mano       │
│                                  └──┘└──┘└──┘└──┘           │
└────────────────────────────────────────────────────────────┘
```

### 7.4 Match — mobile portrait
Scacchiera centrata a piena larghezza, pannello avversario sopra, pannello proprio sotto, mano a ventaglio sovrapposta al bordo inferiore che si espande al tap. Il track delle fasi diventa una barra orizzontale sottile sopra la scacchiera. Storico mosse dietro un tab/bottom sheet.

### 7.5 Interazioni critiche

- **Mossa:** supporta sia drag-and-drop sia tap-casella-origine → tap-casella-destinazione. Il tap-tap è obbligatorio, è il pattern usabile su mobile. Mosse legali evidenziate al pickup (calcolate con chess.js solo per il suggerimento visivo). Promozione: selettore a 4 pezzi.
- **Cast di una magia:** tap/drag sulla carta → se `target_type` è `none`, invia subito; altrimenti la scacchiera entra in **modalità targeting**, evidenzia solo i bersagli validi per quel `target_type`, e mostra un modo evidente di annullare (ESC / tap fuori / bottone).
- **Carta non giocabile:** disattivata visivamente con il motivo leggibile (mana insufficiente, fase sbagliata). Non nascondere le carte, non lasciare l'utente a indovinare.
- **Feedback di rifiuto:** quando il server rifiuta un'azione, l'interfaccia deve tornare allo stato precedente con un'animazione che mostri *cosa* è tornato indietro, più un toast con il motivo.
- **Pezzo congelato:** badge sul pezzo + al pickup non mostrare mosse legali, mostra il motivo.
- **Turno dell'avversario:** tutti i controlli d'azione disabilitati, non nascosti.

---

## 8. Stato e connessione

### Reducer unico degli eventi
Tutti i messaggi server passano per una singola funzione `applyServerEvent(state, event)` nel `matchStore`. Nessun componente muta lo stato di gioco direttamente. `protocol.ts` definisce una union discriminata su `type` che copre **tutti** i messaggi di §3.2 e §3.3, così un messaggio non gestito diventa un errore di compilazione e non un bug silenzioso.

### Timer
Il server manda `timer_update` ~1/s. Interpola localmente tra un update e l'altro per un conteggio fluido, ma **risincronizza sempre** sul valore del server quando arriva. Mai far scattare la fine partita lato client: aspetta `game_over`.

### Riconnessione
Backoff esponenziale con jitter (1s → 2s → 4s → … cap 30s). Il server supporta la riconnessione a partita in corso entro `RECONNECT_TIMEOUT` (default 30s) e ripristina lo stato completo. Mostra un banner persistente "Riconnessione in corso" con il tempo residuo, e ripristina la UI dallo stato che il server rimanda — non da quello che il client aveva in memoria. Gestisci anche il ciclo di vita mobile: quando l'app va in background Android chiude il socket, quindi riconnetti su `resume`.

### Ottimismo
Solo sulla propria mossa scacchistica è ammesso un aggiornamento ottimista con rollback in caso di `error`. **Mai** ottimismo su magie, mana, pesca, cambio di fase.

---

## 9. Mobile (Capacitor)

- `capacitor.config.ts`: `appName: "CheckMage"`, `appId: "com.checkmage.app"`, `server.androidScheme: 'https'`. L'`appId` diventa immutabile una volta pubblicato sugli store, quindi se preferisci un reverse-DNS legato a un dominio tuo dimmelo ora.
- Plugin minimi: `@capacitor/status-bar`, `@capacitor/splash-screen`, `@capacitor/preferences` (storage del token — su mobile usa questo, sul web `localStorage`, dietro un'unica astrazione `storage.ts`), `@capacitor/app` (eventi pause/resume per la riconnessione).
- Safe area insets rispettate via `env(safe-area-inset-*)`.
- Blocca l'orientamento in portrait per la v1, o gestisci il landscape con un layout dedicato — ma non lasciare che la scacchiera si deformi.
- Non introdurre nulla che dipenda da API disponibili solo su Android: iOS deve restare una build, non un port.

---

## 10. Qualità e criteri trasversali

- TypeScript strict, zero `any`, zero `@ts-ignore` non commentati.
- Test unitari obbligatori su: reducer degli eventi WebSocket, macchina di targeting, logica di abilitazione delle carte (mana + fase), formattazione timer.
- Un mock WebSocket server per i test d'integrazione che replichi le sequenze di §3.2–3.3.
- i18n dal primo giorno: italiano default, inglese come seconda lingua. Nessuna stringa hardcoded nei componenti.
- Nessun `console.log` nel codice finale.

---

## 11. Roadmap e criteri di accettazione

Uno Step per volta. Al termine di ogni Step, verifica i criteri e fermati per la review.

**Step 0 — Contratto e mock server**
`protocol.ts` (union discriminata di tutti i messaggi), `adapter.ts`, il mock di §5.2, e i tre file in `docs/`.
✔ `npm run mock` serve REST + WebSocket conformi a §3. Uno script di prova completa una partita fittizia end-to-end contro il mock. `ASSUMPTIONS.md` elenca tutte e dieci le voci di §3.6, `BACKEND-REQUESTS.md` tutte e nove quelle di §3.7.

**Step 1 — Scheletro**
Vite + React + TS + Tailwind + Router + token di design + layout shell + i18n.
✔ Build e lint puliti, `tokens.css` usato ovunque, nessun colore hardcoded.

**Step 2 — Auth e profilo**
Client REST tipizzato, login/registrazione, persistenza sessione, gestione 401, schermata profilo.
✔ Login contro il mock, chiusura tab, riapertura: sessione ancora valida. Token scaduto: logout pulito senza loop di retry.

**Step 3 — Layer WebSocket**
Connessione con ticket, heartbeat, riconnessione con backoff, `applyServerEvent`.
✔ Test del reducer verdi su tutte le sequenze del mock. Un messaggio sconosciuto è un errore di compilazione se dimenticato nella union, e un no-op loggato se arriva a runtime. Lo scenario "server ostile" non produce nessun crash.

**Step 4 — Scacchiera e partita classica**
Board, pezzi, drag + tap-tap, highlight, promozione, timer, pannelli giocatore, resa/patta, fine partita.
✔ Due schede del browser, una partita completa fino a matto contro il mock, timer coerenti, riconnessione a metà partita che ripristina tutto.

**Step 5 — Layer magie**
Track delle fasi, cristalli di mana, mano, carte, targeting, badge effetti, animazioni di risoluzione, rotta `/dev/cards`.
✔ Partita completa con magie castate in main1 e main2, tutti e sei gli effetti visti almeno una volta, targeting annullabile, carte non giocabili disabilitate col motivo, pezzo congelato che rifiuta il pickup, effetto che segue il pezzo quando si muove, Teleport che non fa avanzare la fase.

**Step 6 — Build Android**
Capacitor, ciclo di vita pause/resume, safe area, storage nativo, layout portrait.
✔ APK installabile che gioca una partita completa contro una scheda desktop collegata allo stesso mock.

**Step 7 — Integrazione col server reale** *(quando il codice Go tornerà disponibile)*
Per prima cosa applica le patch P0 di `BACKEND-REQUESTS.md`. Poi verifica **una per una** le dieci assunzioni di §3.6 contro il comportamento reale, e correggi solo `adapter.ts` e `connection.ts`.
✔ `ASSUMPTIONS.md` non contiene più voci non verificate. Il mock viene aggiornato per riflettere il server reale, non abbandonato: resta l'ambiente di test.

---

## 12. Cosa non fare

- Non riscrivere né "migliorare" il backend: non hai il suo codice. Le modifiche desiderate si annotano in `BACKEND-REQUESTS.md`.
- Non far dipendere il codice di `src/` da nulla che stia in `mock-server/`, e non mettere le sue dipendenze fuori da `devDependencies`.
- Non normalizzare payload del server fuori da `adapter.ts`.
- Non introdurre dipendenze GPL (chessground, set di pezzi lichess).
- Non implementare logica di gioco client-side che duplichi il server.
- Non usare `localStorage` direttamente nei componenti: passa dall'astrazione `storage.ts`.
- Non aggiungere librerie di animazione pesanti per effetti che si fanno con CSS transitions.
- Non generare asset grafici placeholder generici (carte con gradienti viola, icone stock): se serve un asset che non hai, chiedimelo.

---

## 13. Da mettere invece nel `CLAUDE.md`

Tienilo corto e persistente — comandi e regole, non contesto di progetto:

```md
# Comandi
- dev:   npm run dev
- build: npm run build
- test:  npm run test
- lint:  npm run lint
- android: npx cap sync android && npx cap open android

# Regole
- TypeScript strict. Niente `any`.
- Nessun colore hardcoded: usa le variabili in src/design/tokens.css.
- Nessuna stringa UI hardcoded: usa i18n.
- Il server è autoritativo: nessuna logica di gioco duplicata nel client.
- Nessun segreto nel repo. Solo variabili VITE_*.
- Conventional Commits.
```

---

## 14. Prima di iniziare, chiedimi

Il server non è consultabile in questa fase, quindi tutto ciò che lo riguarda va in `BACKEND-REQUESTS.md` invece che in una domanda. Restano da chiarire con me:

1. Se preferisci un `appId` legato a un dominio tuo invece di `com.checkmage.app` (dopo la pubblicazione non si cambia più).
2. Se vuoi un testo di flavour sulle carte, e in che tono.
3. Licenza del progetto (influenza la scelta degli asset grafici).
4. Se vuoi che il mock resti nel repo a lungo termine come ambiente di test, o solo fino allo Step 7.

E segnalami subito, senza aspettare la fine dello Step, qualunque punto in cui questo documento ti risulti ambiguo o contraddittorio.
