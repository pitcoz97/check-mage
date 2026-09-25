# PROGRESS

> Punto di ripartenza, non diario. Massimo una pagina. Leggilo prima di tutto il resto.

## Step corrente
**Redesign completo (R1–R6), in attesa di review.** Branch `feat/redesign`, locale, non ancora unito in `main`.
Analisi, decisioni D1–D22 ed esito in `REDESIGN_PLAN.md` (§10–11); il design sta in `design-reference/` (fuori da git).
Prima del redesign: Step 0–7 completi, Step 6 in attesa dell'APK (`docs/ANDROID.md`).
Server: `C:\Projects\chess-server` (sola lettura, qui non eseguibile), branch `fix/backend-requests` (`62475c9`).

## Completo
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
Review del redesign: le anteprime in sviluppo, poi il giro vero col mock e il login (coda → partita → home →
Riprendi → fine partita). Poi merge di `feat/redesign` in `main` e l'APK di `docs/ANDROID.md`.

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
- Quando il server manderà rarità e tipo (P2-15), la carta li ha già in token (`--rarity-*`): va solo letto il campo.

## Note d'ambiente
- La shell dello strumento non vede Node nel PATH: prima dei comandi npm va ricaricato il PATH di Machine e User.
- Niente JDK/Android SDK: `cap sync` funziona, `gradlew` no.
- `.env` punta al server reale `http://192.168.222.128:8080`; per il mock `localhost:8080` e `npm run mock`.
  `.claude/launch.json`: `dev` (5173), `mock` (8080). Il design si apre su `http://localhost:5173/design-reference/Design.html`.
- `tests/auth-flow.test.ts` aspetta 2,1 s una scadenza vera: sotto carico ha fallito una volta; alzare quel tempo.
- Prove a mano rimaste a te (io non creo account né digito password nel browser): giro completo col login, due
  schede con due utenti, prova sul telefono.
- Identità git locale del repo: Riccardo Picozzi <riccardo.picozzi97@gmail.com>.
