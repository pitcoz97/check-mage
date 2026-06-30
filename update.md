\# Chess + Spells: Estensione del Backend



\## Contesto



Sto estendendo un backend di scacchi online esistente per trasformarlo in un gioco ibrido: scacchi + sistema di magie ispirato a Magic: The Gathering / Hearthstone. Il backend è in Go, già in produzione-ready.



\### Stack esistente

\- Linguaggio: Go

\- Router: Chi v5

\- Database: PostgreSQL

\- WebSocket: Gorilla

\- Engine scacchistico: Stockfish (UCI) per validazione mosse

\- Auth: JWT

\- Logging: Uber Zap

\- Già implementati: matchmaking, timer per lato con increment, resign, draw offer/accept/decline, reconnection mid-game, rate limiting per IP e per client WS, graceful shutdown con salvataggio match attivi, CORS, health check DB, Stockfish crash recovery



\### Struttura attuale

```

chess-server/

├── main.go

├── internal/

│   ├── api/           # router Chi

│   ├── handlers/      # HTTP + WebSocket handlers

│   ├── game/          # stato partita, integrazione Stockfish

│   ├── db/            # query PostgreSQL

│   ├── config/        # configurazione da env

│   └── logger/        # zap

```



\## Principio architetturale guida



\*\*Il motore scacchi resta puro.\*\* Stockfish ragiona solo su FEN standard: non inquinare la FEN o `internal/game` con stato magico. Il sistema delle magie vive in package separati e un nuovo package `match` orchestra scacchi + magie.



Struttura target:

```

internal/

├── game/      # scacchi puri (esistente, non modificare la logica core)

├── phase/     # FSM delle fasi del turno (nuovo)

├── spells/    # definizione magie, mazzi, mani, mana (nuovo)

├── effects/   # stato persistente buff/debuff sui pezzi (nuovo)

└── match/     # orchestratore che combina game + spells + effects (nuovo)

```



\## Decisioni di design



\### Fasi del turno (FSM)

Ogni turno passa attraverso queste fasi nell'ordine:

1\. `draw` — pesca automatica di 1 carta all'ingresso fase

2\. `main1` — il giocatore può castare magie

3\. `move` — il giocatore deve fare una mossa scacchistica (obbligatoria, niente pass)

4\. `main2` — il giocatore può castare magie

5\. `end\_turn` — fase di transizione automatica gestita dal server (trigger end-of-turn, decremento contatori effetti). Subito dopo, server avanza a `draw` dell'avversario.



Azioni permesse per fase (per il giocatore attivo):

\- `draw`: `pass\_phase`, `resign`, `offer\_draw`

\- `main1`: `pass\_phase`, `cast\_spell`, `resign`, `offer\_draw`

\- `move`: `make\_move`, `resign`, `offer\_draw` (NO `pass\_phase`)

\- `main2`: `pass\_phase`, `cast\_spell`, `resign`, `offer\_draw`

\- `end\_turn`: nessuna azione client (transizione server-side)



La mossa scacchistica fa avanzare automaticamente la fase a `main2` — il client non manda `pass\_phase` dopo aver mosso.



\### Sistema mana

\- Mana iniziale: 1

\- Crescita: +1 ogni 2 turni del giocatore

\- Cap: 10

\- \*\*Niente terre/risorse da pescare\*\* (stile Hearthstone, non MTG)

\- A inizio turno (entrando in `draw`), se è il turno giusto, mana cresce e si ricarica al massimo corrente



\### Mazzo, mano, pesca

\- Dimensione mazzo: \*\*40 carte\*\*

\- Mano iniziale: \*\*4 carte\*\*

\- Pesca: \*\*1 carta per turno\*\* all'ingresso della fase `draw`

\- Costi carte: range 1-8 mana (lascia 9-10 per casi speciali futuri)

\- Il mazzo è dimensionato per non finire quasi mai in una partita normale (\~40 turni per lato max). Se finisce: niente fatigue, semplicemente non si pesca più (decisione MVP, rivedibile).



\### Mazzo: simmetrico vs deckbuilding

\*\*Fase 1 (MVP)\*\*: mazzo condiviso fisso, identico per entrambi i giocatori, hardcoded server-side. Permette di iterare su engine, protocollo, UX senza dover bilanciare un meta.



\*\*Fase 2 (futura)\*\*: deckbuilding personale. \*\*L'architettura va fatta da subito per la Fase 2\*\*: ogni giocatore ha il suo `deck` separato nel DB, semplicemente in Fase 1 lo popoli identico per entrambi. Il passaggio a Fase 2 sarà aggiungere UI di costruzione mazzo + endpoint di salvataggio, non un cambio architetturale.



\### Magie: data-driven con effetti compositi

Ogni magia è un record dati, non codice. L'engine ha una libreria di handler di effetti standard, e ogni magia compone uno o più effetti.



```go

type Spell struct {

&#x20;   ID         string

&#x20;   Name       string

&#x20;   ManaCost   int

&#x20;   Phases     \[]Phase     // in quali fasi è giocabile (tipicamente main1, main2)

&#x20;   TargetType TargetType  // none | square | piece | own\_piece | enemy\_piece

&#x20;   Effects    \[]Effect    // applicati in ordine

}



type Effect struct {

&#x20;   Kind   string                 // "destroy\_piece", "freeze\_piece", "move\_piece", "draw\_card", "gain\_mana", ...

&#x20;   Params map\[string]interface{} // parametri specifici

}

```



Effetti standard da implementare nel MVP (in ordine di priorità):

1\. `destroy\_piece` (target: enemy\_piece)

2\. `freeze\_piece` (target: enemy\_piece, params: turns)

3\. `draw\_card` (target: none)

4\. `gain\_mana` (target: none, params: amount)

5\. `move\_piece` (target: own\_piece, sposta in casella legale)

6\. `shield\_piece` (target: own\_piece, params: turns — assorbe una cattura)



\### Effetti persistenti sui pezzi

Stockfish non sa nulla degli effetti magici. Stato parallelo lato match:



```go

type PieceState struct {

&#x20;   PieceID string           // ID univoco assegnato a ogni pezzo all'inizio del match

&#x20;   Square  string           // casella corrente (si aggiorna quando il pezzo si muove)

&#x20;   Effects \[]ActiveEffect

}



type ActiveEffect struct {

&#x20;   Kind           string

&#x20;   RemainingTurns int

&#x20;   SourceSpellID  string  // per debug/log

}

```



\*\*Regola critica\*\*: gli effetti seguono il \*\*pezzo\*\* (via PieceID), non la casella. Altrimenti spostare un cavallo congelato di una casella lo libererebbe.



Quando una mossa viene tentata, prima di passarla a Stockfish: check su `PieceState` del pezzo che si vuole muovere. Se ha effetto bloccante (`freeze`), rifiuta.



A fine turno (durante `end\_turn`): decrementa `RemainingTurns` di tutti gli effetti, rimuovi quelli a 0. Quando un pezzo viene catturato/distrutto, rimuovi la sua `PieceState`.



\### Determinismo

Ogni match ha un `seed int64` salvato nel DB. Il `\*rand.Rand` del match è inizializzato da questo seed. Tutto lo shuffle dei mazzi usa questo RNG. Serve per:

\- Debug ("rigioca la partita X")

\- Replay futuri

\- Verifica anti-cheat



\### Protocollo WebSocket — nuovi messaggi



\*\*Client → Server\*\*:

\- `pass\_phase` (nessun payload aggiuntivo)

\- `cast\_spell { spell\_id, targets\[] }`

\- `make\_move` (esistente, ma ora valido solo in fase `move`)



\*\*Server → Client\*\*:

\- `phase\_changed { phase, active\_player, turn\_number }`

\- `card\_drawn { card\_id }` — solo al giocatore che pesca; agli altri arriva solo `hand\_size\_changed`

\- `hand\_size\_changed { player, size }`

\- `mana\_changed { player, current, max }`

\- `spell\_cast { player, spell\_id, targets, effects\_applied\[] }` — il server invia esplicitamente gli effetti applicati, il client non li ricalcola

\- `effect\_expired { piece\_id, effect\_kind }`

\- `effect\_applied { piece\_id, effect\_kind, remaining\_turns }`



\*\*Principio anti-cheat\*\*: il client non vede mai il mazzo completo né la mano avversaria. Vede solo: propria mano, dimensione mazzo proprio + avversario, mano avversaria come "N carte coperte".



\### Persistenza DB

Estendi la tabella `match` con (o tabelle correlate, decidi tu il design migliore):

\- `current\_phase TEXT NOT NULL DEFAULT 'draw'`

\- `turn\_number INT NOT NULL DEFAULT 1`

\- `seed BIGINT NOT NULL`

\- `mana\_p1 INT NOT NULL DEFAULT 1`

\- `mana\_p2 INT NOT NULL DEFAULT 1`

\- `max\_mana\_p1 INT NOT NULL DEFAULT 1`

\- `max\_mana\_p2 INT NOT NULL DEFAULT 1`

\- `hand\_p1 JSONB NOT NULL` (array di spell\_id)

\- `hand\_p2 JSONB NOT NULL`

\- `deck\_p1 JSONB NOT NULL` (array di spell\_id, ordine = top of deck in posizione 0)

\- `deck\_p2 JSONB NOT NULL`

\- `discard\_p1 JSONB NOT NULL DEFAULT '\[]'`

\- `discard\_p2 JSONB NOT NULL DEFAULT '\[]'`

\- `piece\_effects JSONB NOT NULL DEFAULT '{}'` (mappa piece\_id → \[]ActiveEffect)



Il graceful shutdown esistente deve salvare anche questi campi. La reconnection deve ricostruirli.



\## Roadmap di implementazione



Da fare in questo ordine. Ogni step deve essere completo e testato prima di passare al successivo.



\### Step 1 — FSM delle fasi (senza magie reali)

\*\*Obiettivo\*\*: il match passa attraverso le fasi correttamente, `pass\_phase` e `make\_move` rispettano la fase corrente.



Deliverable:

\- Package `internal/phase` con `Phase`, `Order`, `Next`, `IsValid`, `AllowedActions`, `IsAllowed`

\- Campi `CurrentPhase`, `TurnNumber`, `ActivePlayer` nel match

\- Metodo `AdvancePhase()` che gestisce wrap EndTurn → Draw avversario con swap player

\- Hook `onPhaseEnter` con placeholder per Draw (TODO: pesca) e EndTurn (TODO: trigger fine turno)

\- Handler WebSocket `pass\_phase` con validazioni (turno giusto, fase consente pass)

\- `make\_move` aggiornato: rifiuta se fase ≠ `move`, dopo mossa valida chiama `AdvancePhase()` per andare a `main2`

\- Messaggio `phase\_changed` broadcast dopo ogni transizione

\- Migrazione DB per `current\_phase`, `turn\_number`

\- Graceful shutdown e reconnection salvano/ripristinano fase e turno



\*\*Criteri di accettazione\*\*:

\- Partita inizia in `draw` per il bianco, turno 1

\- Sequenza `pass → main1 → pass → move`, `pass` rifiutato in `move`

\- Dopo mossa valida la fase è `main2`

\- `pass` da `main2` porta a `draw` del nero, turno 2

\- Tentativo di azione fuori turno → rifiuto `not your turn`

\- Stockfish continua a validare mosse come prima

\- Restart server in mezzo a partita ripristina fase e turno correttamente



\### Step 2 — Mana, mazzo, mano (senza effetti reali)

\*\*Obiettivo\*\*: le risorse del card game esistono e si comportano correttamente. Le magie sono placeholder che costano mana e vanno in scarto senza effetti.



Deliverable:

\- Package `internal/spells` con `Spell`, `Effect`, `PlayerHand`

\- Definizione hardcoded di 5-6 magie placeholder (effetto `noop`, costi diversi 1-5)

\- Logica mana: init a 1, +1 ogni 2 turni, cap 10, ricarica a inizio turno

\- Logica mazzo: shuffle deterministico con seed all'init del match, pesca a inizio `draw`

\- Handler WebSocket `cast\_spell` con validazioni: fase consente cast, mana sufficiente, carta in mano, target valido (anche se per ora i target non fanno nulla)

\- Messaggi server → client: `card\_drawn`, `hand\_size\_changed`, `mana\_changed`, `spell\_cast`

\- Anti-cheat: client riceve solo propria mano, mai mazzo né mano avversaria

\- Migrazione DB per tutti i campi mana/mazzo/mano/scarto

\- Salvataggio/ripristino completo in graceful shutdown e reconnection



\*\*Criteri di accettazione\*\*:

\- Mano iniziale = 4 carte per entrambi

\- A inizio turno il giocatore attivo pesca 1

\- Mana cresce correttamente (turno 1: 1, turno 3: 2, turno 5: 3, ...)

\- Castare magia: mana scala, carta va in scarto, broadcast a entrambi

\- Castare con mana insufficiente o carta non in mano: rifiuto

\- Stessa partita con stesso seed = stesso ordine di pesca (test determinismo)



\### Step 3 — Primo effetto reale: `destroy\_piece`

\*\*Obiettivo\*\*: una magia ha un effetto concreto sulla scacchiera. Validare il flusso end-to-end "magia → modifica stato scacchi".



Deliverable:

\- Package `internal/effects` con handler `destroy\_piece`

\- Sistema di targeting: client manda `targets: \["e4"]`, server verifica che ci sia un pezzo nemico

\- L'handler modifica la FEN rimuovendo il pezzo target, aggiorna stato match

\- Logica per cancellare la `PieceState` del pezzo distrutto (se esiste)

\- Una magia "Disintegrate" (costo 4, target enemy\_piece, effetto destroy\_piece) sostituisce una delle placeholder

\- Verifica che Stockfish accetti la nuova FEN (es. non distruggere il re — re-only protection)

\- Messaggio `spell\_cast` include `effects\_applied: \[{kind: "destroy\_piece", target: "e4", piece\_destroyed: "knight"}]`



\*\*Criteri di accettazione\*\*:

\- Distruggere cavallo nemico in e4: FEN aggiornata, broadcast corretto

\- Tentativo di castare su casella vuota o pezzo proprio: rifiuto

\- Tentativo di distruggere il re: rifiuto (mai consentito, fine partita avviene solo per scacco matto/resa)

\- Mossa successiva continua a essere validata correttamente sulla nuova FEN



\### Step 4 — Effetti persistenti sui pezzi (`freeze\_piece`, `shield\_piece`)

\*\*Obiettivo\*\*: gli effetti durano nel tempo, sono legati al pezzo non alla casella, vengono gestiti correttamente a fine turno.



Deliverable:

\- Assegnazione di un `PieceID` univoco a ogni pezzo all'init del match (mantenuto in una mappa square → PieceID + PieceID → tipo pezzo, aggiornata a ogni mossa)

\- Handler `freeze\_piece` (params: turns) e `shield\_piece` (params: turns)

\- Check in `make\_move`: se il pezzo da muovere ha effetto freeze attivo, rifiuto

\- Hook end-of-turn: decrementa `RemainingTurns`, rimuove effetti a 0, broadcast `effect\_expired`

\- Quando un pezzo viene catturato (mossa normale) o distrutto (magia), rimuovi la sua `PieceState`

\- Quando un pezzo si muove, la sua `PieceState.Square` si aggiorna (effetti seguono il pezzo)

\- Migrazione DB per `piece\_effects`

\- Magie nuove: "Frost Bolt" (costo 2, freeze 2 turni), "Aegis" (costo 3, shield 2 turni)



\*\*Criteri di accettazione\*\*:

\- Pezzo congelato non può muoversi per N turni, poi torna mobile

\- Pezzo scudato non viene catturato la prima volta (cattura cancella lo scudo invece del pezzo) — decidi se shield assorbe anche distruzioni magiche

\- Spostare un pezzo congelato (se mai possibile, es. via altra magia): l'effetto lo segue

\- Restart server: effetti attivi e contatori ripristinati



\### Step 5 — Effetti rimanenti del set base

\*\*Obiettivo\*\*: completare la libreria di effetti standard del MVP.



Deliverable:

\- `draw\_card` (es. magia "Insight", costo 1, pesca 1 carta extra)

\- `gain\_mana` (es. magia "Surge", costo 0, +2 mana questo turno — utile per combo)

\- `move\_piece` (es. magia "Teleport", costo 3, sposta un pezzo proprio in qualsiasi casella vuota — verifica che la mossa risultante non sia illegale tipo lasciare il re sotto scacco)

\- Definizione completa del mazzo MVP: \~15-20 magie uniche, distribuzione costo bilanciata (tante low-cost, poche high-cost), in modo che 40 carte possano essere riempite con duplicati ragionevoli



\*\*Criteri di accettazione\*\*:

\- Tutti gli effetti funzionano isolatamente

\- Combo testate: gain\_mana + magia costosa nello stesso turno, draw\_card + cast immediato della carta pescata



\### Step 6 — Test end-to-end e pulizia

\*\*Obiettivo\*\*: il sistema è giocabile in modo completo e robusto.



Deliverable:

\- Script di test integrato (Go test o script bash con wscat) che simula una partita completa con magie

\- Logging strutturato di ogni cast e ogni effetto applicato (utile per debug bilanciamento)

\- Audit del flusso reconnection con magie attive

\- Documentazione protocollo WebSocket aggiornata (README o file dedicato)



\## Note operative



\- \*\*Non rompere il match esistente senza magie\*\*: se utile, aggiungi un flag `spells\_enabled` sul match (default true per i nuovi, false per quelli legacy). In alternativa, tratta come "match con mana 0 e mazzo vuoto" — ma valuta se vale la pena.

\- \*\*Test prima di proseguire\*\*: ogni step ha criteri di accettazione. Verifica con un client di test (wscat o script Go) prima di passare al successivo.

\- \*\*Commit per step\*\*: ogni step è un commit (o branch) separato, così è facile bisecare bug.

\- \*\*Errori sempre wrappati\*\*: `fmt.Errorf("context: %w", err)` come nel resto del codebase.

\- \*\*Logger zap, mai fmt.Println in produzione\*\*.

\- \*\*Mai global state per il nuovo codice\*\*: dependency injection via struct.



\## Da NON fare in questo round



\- Deckbuilding UI / endpoint (rimandato a Fase 2)

\- Bilanciamento fine delle magie (si fa giocando)

\- Magie istantanee castabili nel turno avversario (rimandato, ma la FSM è già predisposta perché passa per ogni fase)

\- Animazioni / effetti visivi (lato client UE5)

\- Sistema di rarità / progressione carte / unlock



Iniziamo dallo Step 1. Procedi creando il package `phase` e i campi nel match.

