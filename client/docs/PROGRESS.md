# PROGRESS

> Punto di ripartenza, non diario. Massimo una pagina. Leggilo prima di tutto il resto.

## Step corrente
**Catalogo magie, Step 4 di 6 (`docs/BRIEFING-MAGIE.md`), in attesa di review e dei test Go sulla VM.** Fatto in una
sessione cloud sul branch `claude/vibrant-tesla-ckfrp4`, partito da `feat/spell-catalog`. Decisioni e verifiche del
brief in `docs/ASSUMPTIONS.md` §7 (M1–M44, S1–S11). Il redesign (R1–R6) è unito in `main`.
Monorepo `check-mage`: client in `client/`, server in `server/` (modificabile sul branch della feature; qui non
eseguibile).

## Completo
- **Catalogo magie, Step 4:** rune. Server: stato `rune` sulle case (una per giocatore per casa, permanente, `hidden`),
  Rivelazione, Runa di stasi, di respinta, esplosiva, Detonazione, Campo minato (26 magie, ricetta nei limiti di copie);
  la runa scatta dopo una mossa (`triggerRune`, M34–M36, M40, M44), `rune_triggered`; `game_state` e
  `square_effects_changed` per destinatario e `spell_cast` nascosto all'avversario (M42). Mock allineato, col nuovo
  scenario `runes`. Client: rune sulla scacchiera (tratteggiata se nascosta, piena se rivelata, icona da `on_enter`),
  magia nascosta nel registro e negli avvisi, avviso della runa scattata. `/dev/match?scenario=spells|rune`. 560 test,
  e2e 11/11 (nuovo: nessuna carta né runa nascosta dell'avversario nei frame).
- **Catalogo magie, Step 3:** stati delle case (`square_effects`, `square_effects_changed`), Muro di ghiaccio e
  Santuario, filtro delle mosse (`move_blocked`) anche per matto e stallo. Client: muro e santuario disegnati sulla casa,
  mosse bloccate non evidenziate, bersagli coerenti. `/dev/match?scenario=spells` li mostra. 532 test, e2e 10/10.
- **Catalogo magie, Step 2:** cimitero per giocatore (catture, en passant, magie), `choice` nel `cast_spell`,
  7 handler del gruppo A e 9 magie (Inverno eterno, Guardia reale, Falange, Scambio, Metamorfosi, Promozione
  anticipata, Richiamo, Resurrezione, Arrocco divino); `no_effect` e `invalid_choice`. Client: cimitero nella riga
  del giocatore, passo di scelta del pezzo, effetti di massa. `/dev/match?scenario=spells` per vederli. 512 test.
- **Catalogo magie, Step 1:** server, mock e client. Le 9 magie dello step (Brina, Catena di ghiaccio, Frantumare,
  Patto di sangue, Blink, Scudo, Scudo reale, Marcia forzata, Leva militare) al posto delle 11 vecchie; bersagli
  `TargetSpec` con filtri, tag, rarità, limite per turno; durate relative a chi lancia; niente scacco da magia;
  matto e stallo con i pezzi congelati. Client: schema e adapter nuovi, bersagli evidenziati dallo spec, nomi e
  testi i18n per id, cornice per rarità e riga dell'archetipo, messaggi per ogni `reason`. 490 test, e2e verdi.
- **Step 0–7:** contratto sul codice Go e mock che lo porta; REST, sessione, WebSocket con ticket e
  `applyServerEvent`; scacchiera, partita, layer magie; Capacitor 8 (`android/` versionato); `npm run verify:server`
  (47/0 contro il server reale).
- **Redesign:**
  - **R1** token del design per ruolo, temi della scacchiera, scale numeriche, Figtree/Cinzel/JetBrains Mono, font dei
    pezzi ritagliato (`npm run fonts:pieces`), pulsanti 3D, test di contrasto (unica correzione #7F786E → #928B81);
  - **R2** scacchiera del componente del design (glifi, coordinate, stati, bersagli viola), `MiniBoard`, temi salvati;
  - **R3** carta 200×280 del design (velo della carta spenta al 30%, il massimo AA), mano a ventaglio, anteprima grande;
  - **R4** partita desktop e Android delle tavole, box del suggerimento unico, 10 rombi del mana, schede con le magie
    della sessione nello storico, foglio del Menu;
  - **R5** barre di navigazione, home con la partita in background, Classifica, Impostazioni (tema, lingua, Esci);
  - **R6** accesso, stati dell'app, coda, profilo, banner, patta ricevuta, resa, promozione, fine partita nel
    linguaggio del design; pulizia di token e testi morti.
  - Anteprime solo di sviluppo, senza account: `/dev/cards`, `/dev/board`, `/dev/match` (`?scenario=over|draw|
    reconnecting|replaced|disconnected|promotion`), `/dev/home` (`?match=1`, `/leaderboard`, `/settings`, `/profile`).
- **Verifica finale:** typecheck, lint, build puliti; 457 test verdi; e2e 10/10; `cap sync android` pulito. JS
  iniziale 554 kB (172 kB gzip), partita 82 kB a richiesta.

## Prossima azione concreta
Tu: review dello Step 4 e della decisione M44 (il gelo di una runa non conta il turno in cui scatta), poi
`go build ./... && go vet ./... && go test ./...` sulla VM. Nella sessione cloud sono già passati, anche con Stockfish
16 (i test delle rune che passano da una mossa lo usano e senza Stockfish si saltano). Poi il merge in
`feat/spell-catalog` e il deploy sulla VM.
Dopo: piano dello Step 5 (eventi, trigger e aure: `add_trigger`, `add_aura`, Anima inquieta, Riflesso, Stendardo).

## Decisioni prese
- Redesign: `REDESIGN_PLAN.md` §10 (D1–D22). Il design vince su colori, tipografia, spaziature e layout; testi e
  vincoli di CLAUDE.md restano nostri. Le parti non disegnate le ho estese io (D20).
- Storico in UCI (D18). Cadenza unica (P2-1 non più necessaria). Funzioni senza backend visibili ma «Presto» (D9).
- WebSocket con ticket monouso; il colore arriva da `game_state`. Token in `localStorage` sul web, in
  `@capacitor/preferences` su dispositivo.

## Decisioni aperte
- **Licenza del progetto** (il repo contiene grafica originale, CREDITS.md). **Icona dell'app** (D22: dopo).
- Merge di `fix/backend-requests` in `main` e deploy. Richieste aperte: P2-11 (sospesa), P2-12…P2-21 (le nuove del
  redesign: rarità e tipo delle carte, tetto del mana, magie al rientro, delta ELO, posizione in classifica, «Presto»).

## Da ricordare
- APK mai costruito qui: se Gradle si lamenta, guardare `android/app/src/main/res/`.
- Rilanciare `verify:server` a ogni cambiamento del server.
- Il client e la VM vanno aggiornati insieme: il catalogo nuovo non è retrocompatibile col client vecchio e viceversa.
- `docs/catalog.go` è il catalogo di riferimento del brief e confluisce nel server step per step.
- `mock-server/spells.json` e `src/spells/fallback.json` si rigenerano dal catalogo Go (`spells.List()`), una voce per
  riga: allo Step 4 le 20 voci esistenti sono rimaste identiche.

## Note d'ambiente
- La shell dello strumento non vede Node nel PATH: prima dei comandi npm va ricaricato il PATH di Machine e User.
- Niente JDK/Android SDK: `cap sync` funziona, `gradlew` no.
- `.env` punta al server reale `http://192.168.222.128:8080`; per il mock `localhost:8080` e `npm run mock`.
  `.claude/launch.json`: `dev` (5173), `mock` (8080). Il design si apre su `http://localhost:5173/design-reference/Design.html`.
- `tests/auth-flow.test.ts` aspetta 2,1 s una scadenza vera: sotto carico ha fallito una volta; alzare quel tempo.
- Prove a mano rimaste a te (io non creo account né digito password nel browser): giro completo col login, due
  schede con due utenti, prova sul telefono.
- Identità git locale del repo: Riccardo Picozzi <riccardo.picozzi97@gmail.com>.
