# CheckMage — Briefing magie per Claude Code

Sep 25, 2026 · @Riccardo

## Obiettivo e contesto

L'obiettivo è portare il catalogo magie di CheckMage da 6 a 37 carte (32 nuove più le 5 esistenti non duplicate), divise in 6 archetipi, e aggiungere al server Go gli handler e le estensioni di schema che servono. Il lavoro procede per step: ogni step si chiude con test verdi prima di passare al successivo.

**Cosa esiste già nel server:**

- FSM di turno con fasi Draw → Main 1 → Move → Main 2, poi end\_turn automatico.
- Mana stile Hearthstone: +1 ogni 2 turni del giocatore, cap 10.
- Mazzo da 40 carte, mano iniziale di 4, 1 pesca per turno, shuffle deterministico con seed per partita.
- Sistema magie data-driven: `Spell` con `ID`, `Name`, `ManaCost`, `Phase []Phase`, `TargetType`, `Effects []Effect`; `Effect` con `Kind` e `Params map[string]interface{}`.
- Handler esistenti: `destroy_piece`, `freeze_piece`, `shield_piece`, `draw_card`, `gain_mana`, `move_piece`, `summon_pawn`.
- `PieceState` con effetti attivi legati al `PieceID`, non alla casa.
- Stockfish per la validazione delle mosse; il re non può mai essere distrutto.
- Catalogo attuale: Fireball, Ice Age, Greed, Recover, Teleport, Shield.

**Cosa va costruito:** le estensioni di schema della sezione 4, gli handler nuovi della sezione 6 e il catalogo della sezione 5, nell'ordine della roadmap (sezione 7). Il file di riferimento con le definizioni è `internal/spells/catalog.go`, fornito insieme a questo documento.

**Regola di lavoro:** prima di implementare uno step, presentare un piano e aspettare conferma. Ogni assunzione nuova va annotata in `docs/ASSUMPTIONS.md`, mai inventata in silenzio. Nessuno `switch` su `spell_id`: il comportamento di una magia deriva solo dai suoi `Effects`.

## Regole di design e bilanciamento

Le magie preparano o modificano la mossa degli scacchi, non la sostituiscono. Queste regole valgono per tutto il catalogo e vanno imposte dal validatore globale, non dalle singole magie.

1. **Il re è intoccabile dagli effetti ostili.** Nessuna magia avversaria può distruggere, congelare, spostare o trasformare il re. Il re non è mai un bersaglio valido per effetti ostili.
2. **Niente scacco da magia.** Gli effetti con `no_check: true` vengono rifiutati se la posizione risultante mette sotto scacco il re avversario. La partita finisce solo per scacco matto, resa, tempo o patta.
3. **Niente auto-scacco.** Un effetto non può lasciare il re del lanciatore sotto scacco. Il controllo avviene sulla FEN risultante, come per una mossa normale.
4. **Rimozioni limitate.** Le magie che eliminano pezzi colpiscono solo pedoni e pezzi minori, oppure richiedono una condizione (es. bersaglio congelato). La regina non è mai rimovibile direttamente.
5. **Durate brevi.** Gli effetti ostili durano 1–2 turni avversari. Solo le aure sono permanenti, e hanno sempre una condizione.
6. **Deckbuilding:** mazzo da 40 carte, massimo 2 copie per carta `common`, 1 per carta `legendary`.

Curva dei costi di riferimento: 0–2 mana per effetti piccoli o di setup, 3–5 per effetti decisivi su un pezzo, 6–8 per effetti di massa o permanenti.

## Stati, oggetti e convenzioni

Gli stati sui pezzi seguono il `PieceID`; gli oggetti sulle case restano sulla casa. Questa distinzione è voluta e va rispettata.

| Nome | Dove vive | Effetto | Scadenza |
| --- | --- | --- | --- |
| `frozen` | PieceState | Il pezzo non può muovere né catturare | `duration` turni avversari |
| `shielded` | PieceState | Il pezzo non può essere catturato | Fino all'inizio del prossimo turno del proprietario |
| `phasing` | PieceState | Nella Move ignora i pezzi in mezzo, non può catturare | Fine del turno corrente |
| `borrowed_movement` | PieceState | Muove come un altro tipo di pezzo | Fine del turno corrente |
| `wall` | SquareState | Casa bloccata: nessun pezzo ci entra né la attraversa | `duration` turni avversari |
| `no_capture` | SquareState | Nessuna cattura può avvenire su quella casa | `duration` turni avversari |
| `rune` | SquareState | Nascosta all'avversario; scatta quando un pezzo nemico ci entra | Finché non scatta o viene detonata |
| Trigger | PlayerState | Reagisce a un evento (es. pezzo perso) | `duration` turni avversari |
| Aura | PlayerState | Effetto permanente attivo se vale una condizione | Permanente (`duration: -1`) |
| Cimitero | PlayerState | Lista ordinata dei pezzi persi, con tipo e PieceID originale | Tutta la partita |

**Convenzioni sui parametri:**

- `duration` = numero di turni **avversari** in cui l'effetto resta attivo. `0` = solo il turno corrente, `-1` = permanente.
- `no_check: true` = dopo l'effetto, la posizione non deve dare scacco al re avversario, altrimenti il cast viene rifiutato e lo stato non cambia.
- `no_capture: true` = il movimento concesso non può catturare.
- Le traverse in `OwnRanks` e `MinRank` sono relative al lanciatore: 1 = la sua prima traversa.
- Un pezzo congelato su cui passa `shielded` mantiene entrambi gli stati: non si esclude nulla a vicenda.
- Un pezzo trasformato (Metamorfosi) o promosso mantiene il suo `PieceID` e gli effetti attivi.
- Un pezzo resuscitato riceve un `PieceID` nuovo e nessun effetto.

## Estensioni allo schema

Servono quattro estensioni: bersagli multipli con filtri, metadati di deckbuilding, uno stato per casa e uno stato per giocatore. Sono proposte: se il codice esistente suggerisce una forma migliore, proporla nel piano dello step 1.

```go
type Spell struct {
    ID        string
    Name      string
    ManaCost  int
    Phase     []Phase
    Targets   []TargetSpec   // NUOVO: sostituisce TargetType
    Effects   []Effect
    Tags      []string       // NUOVO: archetipi (gelo, necro, arcano, sacro, rune, falange)
    Rarity    Rarity         // NUOVO: common | legendary
    Limits    map[string]int // NUOVO: es. {"per_turn": 1}
}

type TargetSpec struct {
    Type          TargetType  // square, own_piece, enemy_piece
    Pieces        []PieceKind // ammessi; vuoto = tutti tranne il re
    RequireEffect string      // es. "frozen"
    EmptySquare   bool
    MaxDistance   int         // distanza di Chebyshev dal bersaglio precedente; 0 = nessun limite
    OwnRanks      []int       // traverse relative al lanciatore
    MinRank       int
}

type SquareState struct {
    Square  string
    Effects []SquareEffect // wall, no_capture, rune
}

type SquareEffect struct {
    Kind           string
    Owner          Color
    Hidden         bool
    RemainingTurns int
    Params         map[string]any // on_enter, only, fallback...
    Source         string         // ID della magia
}

type PlayerState struct {
    Graveyard []CapturedPiece
    Triggers  []Trigger
    Auras     []Aura
    CastsThisTurn map[string]int // per Limits
}
```

**Migrazione di `TargetType`:** le 6 magie esistenti vanno convertite a `Targets` con un solo elemento. Il messaggio WebSocket `cast_spell` passa da un bersaglio a una lista ordinata `targets`, nello stesso ordine di `Spell.Targets`.

**Persistenza:** `SquareState` e `PlayerState` vanno salvati e ripristinati come `PieceState`, sia nel graceful shutdown sia nella reconnection. Serve una migrazione DB.

## Catalogo delle magie

Il catalogo ha 32 magie, 5 leggendarie. Fase "Main" = Main 1 e Main 2; "Main 1" = solo prima della Move, perché la magia modifica la mossa di quel turno. La colonna Handler indica gli effect kind usati; quelli in corsivo sono nuovi.

| ID | Nome | Costo | Archetipo | Fase | Bersagli | Effetto | Handler | Rarità |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `frost` | Brina | 1 | Gelo | Main | Pedone nemico | Congela per 1 turno | freeze\_piece | common |
| `ice_wall` | Muro di ghiaccio | 2 | Gelo | Main | Casa vuota | Muro per 2 turni | *create\_wall* | common |
| `ice_chain` | Catena di ghiaccio | 3 | Gelo | Main | Cavallo o alfiere nemico | Congela per 1 turno | freeze\_piece | common |
| `shatter` | Frantumare | 4 | Gelo | Main | Pezzo nemico congelato, non regina | Lo cattura | destroy\_piece | common |
| `eternal_winter` | Inverno eterno | 7 | Gelo | Main | Nessuno | Congela tutti i pedoni nemici per 1 turno | *freeze\_all* | legendary |
| `blood_pact` | Patto di sangue | 0 | Necro | Main | Tuo pedone | Lo sacrifica, +2 mana (non oltre il cap), 1 volta per turno | destroy\_piece, gain\_mana | common |
| `restless_soul` | Anima inquieta | 2 | Necro | Main | Nessuno | Per 1 turno, ogni tuo pezzo perso = pesca 1 | *add\_trigger* | common |
| `recall` | Richiamo | 3 | Necro, Falange | Main | Casa vuota della tua 2ª traversa | Rimette un tuo pedone dal cimitero | *revive\_piece* | common |
| `echo_of_fallen` | Eco del caduto | 4 | Necro, Arcano | Main 1 | Tuo pedone | Muove come un pezzo minore del tuo cimitero, per questo turno | *borrow\_movement* | common |
| `resurrection` | Resurrezione | 8 | Necro | Main | Casa vuota della tua 1ª traversa | Rimette cavallo, alfiere o torre dal cimitero | *revive\_piece* | legendary |
| `phase_step` | Passo sfasato | 2 | Arcano | Main 1 | Tuo pezzo minore | Nella Move ignora i pezzi in mezzo, senza cattura | *add\_effect* | common |
| `swap` | Scambio | 3 | Arcano | Main | Due tuoi pezzi, non il re | Li scambia di posto | *swap\_pieces* | common |
| `blink` | Blink | 4 | Arcano | Main | Tuo pezzo minore + casa vuota entro 2 | Teletrasporto | move\_piece | common |
| `metamorphosis` | Metamorfosi | 5 | Arcano | Main | Tuo cavallo o alfiere | Cavallo ↔ alfiere, permanente | *transform\_piece* | common |
| `haste` | Fretta | 6 | Arcano, Falange | Main 1 | Nessuno | Seconda mossa di un pedone nella Move, senza cattura | *extra\_move* | legendary |
| `shield` | Scudo | 2 | Sacro | Main | Tuo pezzo, non regina né re | Scudo | shield\_piece | common |
| `royal_shield` | Scudo reale | 4 | Sacro | Main | Tua regina | Scudo | shield\_piece | common |
| `royal_guard` | Guardia reale | 3 | Sacro | Main | Nessuno | Scudo ai tuoi pezzi adiacenti al re | *shield\_area* | common |
| `divine_castling` | Arrocco divino | 4 | Sacro | Main 1 | Nessuno | Ripristina i diritti di arrocco | *restore\_castling\_rights* | common |
| `sanctuary` | Santuario | 5 | Sacro | Main | Una casa | Nessuna cattura lì per 3 turni | *create\_square\_effect* | common |
| `reflection` | Riflesso | 3 | Sacro, Rune | Main | Nessuno | Trappola: chi cattura o attacca un tuo pezzo scudato viene congelato | *add\_trigger* | common |
| `revelation` | Rivelazione | 1 | Rune | Main | Nessuno | Rivela le rune nemiche, pesca 1 | *reveal\_runes*, draw\_card | common |
| `stasis_rune` | Runa di stasi | 2 | Rune, Gelo | Main | Casa vuota | Chi entra viene congelato per 2 turni | *place\_rune* | common |
| `repel_rune` | Runa di respinta | 2 | Rune | Main | Casa vuota | Chi entra torna alla casa di partenza | *place\_rune* | common |
| `explosive_rune` | Runa esplosiva | 3 | Rune | Main | Casa vuota | Cattura pedone o minore che entra; torre o regina vengono congelate | *place\_rune* | common |
| `detonation` | Detonazione | 4 | Rune, Gelo | Main | Nessuno | Consuma le tue rune e congela i nemici adiacenti a ciascuna | *detonate\_runes* | common |
| `minefield` | Campo minato | 7 | Rune | Main | Tre case vuote | Tre Rune di stasi | *place\_rune* | legendary |
| `forced_march` | Marcia forzata | 1 | Falange | Main | Tuo pedone | Avanza di 1, senza cattura né promozione | move\_piece | common |
| `phalanx` | Falange | 3 | Falange, Sacro | Main | Nessuno | Scudo ai tuoi pedoni adiacenti ad altri tuoi pedoni | *shield\_area* | common |
| `conscription` | Leva militare | 4 | Falange | Main | Casa vuota della tua 2ª traversa | Crea un pedone (massimo 8) | summon\_pawn | common |
| `banner` | Stendardo | 2 | Falange | Main | Nessuno | Con 6+ pedoni, i pedoni possono muovere di 1 di lato | *add\_aura* | common |
| `early_promotion` | Promozione anticipata | 6 | Falange | Main | Tuo pedone dalla 6ª traversa | Promozione a scelta | *promote\_piece* | legendary |

**Sinergie da preservare nei test di bilanciamento:**

- Brina / Catena di ghiaccio / Runa di stasi / Detonazione → Frantumare.
- Leva militare / Richiamo → Patto di sangue → magie da 6+ mana; Anima inquieta ripaga i sacrifici.
- Scambio + Scudo reale; Metamorfosi + Passo sfasato.
- Muro di ghiaccio per incanalare i pezzi verso le rune.
- Scudo + Riflesso.

**Magie esistenti:** Fireball, Ice Age, Greed, Recover, Teleport e Shield restano nel gioco. Shield coincide con `shield`: vanno unificate mantenendo l'ID esistente. Le altre 5 vanno migrate a `Targets` e ricevono Tags e Rarity.

## Effect handler

Servono 17 handler nuovi e piccole estensioni a 4 handler esistenti. Ogni handler riceve lo stato della partita e i bersagli già validati, e restituisce il nuovo stato più la lista di `effects_applied` da trasmettere.

**Estensioni agli handler esistenti:**

| Handler | Parametri nuovi |
| --- | --- |
| `destroy_piece` | `to_graveyard` (sempre true di default: ogni pezzo distrutto va nel cimitero) |
| `gain_mana` | `can_exceed_cap` (false di default) |
| `move_piece` | `relative` + `squares` (movimento relativo al colore), `no_capture`, `no_promotion`, `no_check` |
| `summon_pawn` | `max_pawns` |

**Handler nuovi, gruppo A — solo FEN e PieceState:**

| Handler | Cosa fa | Parametri |
| --- | --- | --- |
| `freeze_all` | Congela tutti i pezzi di un lato che rispettano il filtro | `side`, `pieces`, `duration` |
| `shield_area` | Scudo ai pezzi selezionati da un filtro spaziale | `around` + `radius`, oppure `filter`; `duration` |
| `swap_pieces` | Scambia due pezzi, mantenendo PieceID ed effetti | `no_check` |
| `transform_piece` | Cambia il tipo di pezzo nella FEN, mantiene PieceID | `map`, `no_check` |
| `promote_piece` | Promuove un pedone; il client indica la scelta | `choices`, `no_check` |
| `revive_piece` | Riporta in gioco un pezzo dal cimitero del lanciatore; il client indica quale | `pieces`, `no_check` |
| `restore_castling_rights` | Riscrive i diritti di arrocco del lanciatore nella FEN | nessuno |

**Handler nuovi, gruppo B — richiedono SquareState:**

| Handler | Cosa fa | Parametri |
| --- | --- | --- |
| `create_wall` | Muro su una casa vuota | `duration` |
| `create_square_effect` | Effetto generico su una casa | `effect`, `duration` |
| `place_rune` | Runa nascosta su ogni casa bersaglio | `on_enter`, `duration`, `only`, `fallback`, `fallback_duration` |
| `reveal_runes` | Rende visibili le rune di un lato | `side` |
| `detonate_runes` | Consuma le rune del lanciatore e applica un effetto nel raggio | `radius`, `do`, `duration` |

**Handler nuovi, gruppo C — eventi e generazione mosse:**

| Handler | Cosa fa | Parametri |
| --- | --- | --- |
| `add_trigger` | Registra un trigger sul PlayerState del lanciatore | `on`, `do`, `amount`, `duration`, `hidden` |
| `add_aura` | Registra un'aura condizionale | `condition`, `grant`, `duration` |
| `add_effect` | Aggiunge uno stato di movimento a un pezzo | `effect`, `no_capture`, `duration` |
| `borrow_movement` | Il pedone muove come un pezzo del cimitero; il client indica quale | `from_graveyard`, `duration` |
| `extra_move` | La fase Move accetta una seconda mossa vincolata | `pieces`, `no_capture` |

**Validazione delle mosse con gli stati.** Oggi le mosse passano da Stockfish. Con muri, rune, phasing, aure e movimento preso in prestito, la pipeline diventa:

1. Filtri di stato che rifiutano: pezzo congelato, bersaglio scudato, cattura su casa `no_capture`, percorso che attraversa un muro.
2. Mosse speciali non standard (phasing, borrow\_movement, sidestep dello Stendardo): legalità calcolata dal server, poi verifica che il proprio re non resti sotto scacco sulla FEN risultante.
3. Mosse standard: Stockfish, come ora.
4. Dopo la mossa: controllo delle rune sulla casa d'arrivo, emissione degli eventi per i trigger.

**Eventi minimi da emettere:** `piece_lost` (per lato), `piece_attacked`, `piece_entered_square`, `turn_started`, `turn_ended`.

## Roadmap

Sei step, dal più semplice al più invasivo. Ogni step si apre con un piano da approvare e si chiude aggiornando `docs/PROGRESS.md`.

**Step 1 — Schema e catalogo base.** Introdurre `TargetSpec`, `Tags`, `Rarity`, `Limits`; migrare le 6 magie esistenti; aggiungere le magie che usano solo handler esistenti: Brina, Catena di ghiaccio, Frantumare, Patto di sangue, Blink, Scudo, Scudo reale, Marcia forzata, Leva militare.

- [ ] Un cast con bersagli che non rispettano `TargetSpec` viene rifiutato con motivo.
- [ ] Frantumare su un pezzo non congelato viene rifiutato.
- [ ] Patto di sangue due volte nello stesso turno: il secondo cast viene rifiutato.
- [ ] Blink che darebbe scacco viene rifiutato e lo stato resta invariato.
- [ ] Le partite salvate prima della migrazione si ricaricano senza errori.

**Step 2 — Cimitero e handler del gruppo A.** Aggiungere il cimitero al `PlayerState` e gli handler `freeze_all`, `shield_area`, `swap_pieces`, `transform_piece`, `promote_piece`, `revive_piece`, `restore_castling_rights`.

- [ ] Ogni cattura e distruzione finisce nel cimitero del proprietario.
- [ ] Richiamo senza pedoni nel cimitero viene rifiutato.
- [ ] Metamorfosi mantiene PieceID ed effetti attivi.
- [ ] Arrocco divino non permette di arroccare attraverso case attaccate.

**Step 3 — SquareState, muri e santuari.** Aggiungere `SquareState`, persistenza, `create_wall`, `create_square_effect` e i filtri di stato nella validazione delle mosse.

- [ ] Una torre non attraversa un muro; un cavallo lo scavalca ma non ci atterra.
- [ ] Un muro scade dopo il numero di turni previsto.
- [ ] Nessuna cattura è possibile su una casa Santuario.

**Step 4 — Rune.** `place_rune`, `reveal_runes`, `detonate_runes`, controllo rune dopo ogni mossa, stato nascosto all'avversario.

- [ ] L'avversario non riceve mai la posizione di una runa nascosta, né nello stato iniziale né nella reconnection.
- [ ] Una runa scatta solo con pezzi nemici e viene consumata.
- [ ] Runa esplosiva congela torre e regina invece di catturarle.

**Step 5 — Eventi, trigger e aure.** Bus di eventi interno, `add_trigger`, `add_aura`.

- [ ] Anima inquieta pesca una carta per ogni pezzo perso nel turno avversario, e smette alla scadenza.
- [ ] Riflesso resta nascosto finché non scatta.
- [ ] Lo Stendardo si attiva e disattiva quando il numero di pedoni attraversa la soglia di 6.

**Step 6 — Movimento speciale.** `add_effect` (phasing), `borrow_movement`, `extra_move` e la generazione di mosse fuori da Stockfish.

- [ ] Una mossa speciale che lascia il proprio re sotto scacco viene rifiutata.
- [ ] Fretta: la seconda mossa accetta solo pedoni senza cattura.
- [ ] Dopo una mossa speciale, la mossa successiva dell'avversario viene validata correttamente da Stockfish.

## Protocollo WebSocket e anti-cheat

Il protocollo cambia in tre punti: bersagli multipli, scelte del giocatore e stato nascosto. Ogni modifica va riportata anche nel contratto usato dal client e dal mock server.

**`cast_spell` (client → server):**

```json
{
  "type": "cast_spell",
  "card_instance_id": "...",
  "targets": ["c3", "e5"],
  "choice": { "piece": "knight" }
}
```

`targets` segue l'ordine di `Spell.Targets`. `choice` serve solo a Richiamo, Resurrezione, Eco del caduto e Promozione anticipata.

**`spell_cast` (server → entrambi):** include `effects_applied`, un elemento per effetto, con `kind`, `targets`, `piece_id` coinvolti e la nuova FEN. Per le rune nascoste, l'avversario riceve solo `{"kind": "hidden_effect", "caster": "white"}`.

**Messaggi nuovi (server → client):**

| Messaggio | Quando | Destinatari |
| --- | --- | --- |
| `square_effects_changed` | Muro, santuario o runa creati o rimossi | Entrambi, rune nascoste filtrate |
| `rune_triggered` | Una runa scatta | Entrambi |
| `trigger_fired` | Un trigger o Riflesso si attiva | Entrambi |
| `aura_changed` | Un'aura si attiva o disattiva | Entrambi |
| `graveyard_changed` | Un pezzo entra o esce dal cimitero | Entrambi |

**Anti-cheat:**

- Posizione delle rune nascoste e dei trigger nascosti: solo al proprietario, anche nella reconnection.
- Il server calcola sempre gli esiti; il client non invia mai il risultato di un effetto.
- Ogni cast rifiutato risponde con un codice di errore esplicito (es. `target_invalid`, `would_give_check`, `limit_reached`) e non modifica lo stato.

## Test richiesti

Ogni magia ha almeno un test positivo e uno di rifiuto; in più servono test trasversali sulle regole globali.

- **Per magia:** cast valido con stato atteso; cast con bersaglio non valido rifiutato; cast con mana insufficiente rifiutato; fase sbagliata rifiutata.
- **Regole globali:** nessun effetto ostile può colpire il re; nessun effetto produce scacco al re avversario se ha `no_check`; nessun effetto lascia sotto scacco il proprio re.
- **Durate:** un effetto con `duration: 1` è attivo durante il turno avversario successivo e sparisce all'inizio del turno dopo.
- **Determinismo:** stessa partita, stesso seed, stessa sequenza di cast → stesso stato finale, cimitero compreso.
- **Persistenza:** salvataggio e ripristino a metà partita con muri, rune, trigger e aure attivi.
- **Stato nascosto:** snapshot del payload inviato all'avversario privo di rune e trigger nascosti.
- **Combo:** Brina → Frantumare nello stesso turno; Leva militare → Patto di sangue; Detonazione → Frantumare.

Un catalogo test-only con mazzi fissi aiuta a riprodurre le combo senza dipendere dallo shuffle.

## Assunzioni e punti da verificare

Questi punti dipendono dal codice attuale e vanno verificati all'inizio dello step 1, con esito annotato in `docs/ASSUMPTIONS.md`.

- [ ] **Decremento di `RemainingTurns`.** Il catalogo esprime `duration` in turni avversari. Se oggi il contatore scende a ogni fine turno di entrambi i giocatori, serve una conversione nell'handler o un cambio del decremento.
- [ ] **Validazione di `no_check`.** Verificare se Stockfish, dato una FEN, può dire se un lato è sotto scacco. Altrimenti serve una funzione di attacco scritta nel server.
- [ ] **Istanze delle carte.** Verificare che `card_drawn` e `cast_spell` usino un ID di istanza e non lo `spell_id`, necessario con 2 copie della stessa carta.
- [ ] **`piece_id` nel protocollo.** La FEN non contiene ID dei pezzi: verificare come il client associa gli effetti ai pezzi e se serve una mappa `square → piece_id` negli stati trasmessi.
- [ ] **Shield esistente.** Confermare che la magia Shield attuale abbia costo 2 e durata 1, per unificarla con `shield`.
- [ ] **Promozione nella Move.** Confermare che una promozione normale durante la Move continui a funzionare con gli stati del pedone promosso.
- [ ] **Cap del mana.** Patto di sangue non supera il cap di 10: verificare che `gain_mana` oggi rispetti il cap.
