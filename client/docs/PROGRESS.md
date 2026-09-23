# PROGRESS

> Punto di ripartenza, non diario. Massimo una pagina. Leggilo prima di tutto il resto.

## Step corrente
**Step 6 — Build Android: preparato, in attesa dell'APK.** Il criterio (APK che gioca contro una scheda desktop) si
chiude solo quando lo costruisci: qui non ci sono JDK, Android SDK né Android Studio. Istruzioni in `docs/ANDROID.md`.
Non iniziare lo Step 7 prima.
Server: `C:\Projects\chess-server` (sola lettura, qui non eseguibile), branch `fix/backend-requests` (`62475c9`).

## Completo
- **Step 0 / 0-bis:** contratto sul codice Go, mock come porting di Go.
- **Step 1:** Vite 8, React 19, Router 8, Tailwind 4 legato ai token, i18n tipizzato, layout shell.
- **Step 2:** client REST con refresh condiviso, sessione persistente, guardie, login/registrazione, profilo.
- **Step 2-bis:** mock, adapter e test riallineati al branch `fix/backend-requests` (un solo contratto).
- **Step 3:** connessione con ticket, backoff e heartbeat; `applyServerEvent`; sessione; coda e banner.
- **Step 4:** scacchiera orientata con tap-tap e drag, set di pezzi disegnato qui, promozione, mossa ottimista come
  sola anteprima, orologi interpolati, pannelli, azioni, storico, fine partita; schermata di partita (con chess.js)
  caricata a richiesta.
- **Step 5:**
  - `src/spells/`: catalogo da `GET /spells` con riserva `fallback.json`; registry degli effetti (icona, tono, testo
    di regole generato dai parametri) e dei bersagli (quante caselle, quali evidenziare); giocabilità di una carta
    nello stesso ordine di controlli del server;
  - `src/game/targeting.ts`: macchina pura dalla carta ai bersagli; `src/game/hand/`, `src/game/mana/`: carte e cristalli;
  - scacchiera in modalità targeting (solo i bersagli sono cliccabili, Esc o tap fuori annullano) e badge di stato
    sul pezzo, che seguono il pezzo perché il server manda gli effetti per casella;
  - `matchStore`: `pendingCast` (solo per non mandare due volte) e `lastCast` (per il lampeggio). Nessun ottimismo.
  - rotta `/dev/cards` con tutto il catalogo nei suoi stati, solo in sviluppo;
  - mock: scenario `spellbook`, che prepara mano e mana **del client**.
  - `tests/match-ui.test.tsx` copre i criteri dello Step 5 cliccando sulla UI vera: tutti e sette i kind di effetto,
    cast in main1 e main2, targeting annullato, carte disabilitate col motivo, scudo che segue il pedone, Teleport
    che non avanza la fase, pickup rifiutato su un pezzo congelato dal bot.
- **Step 6 (la parte che si può fare qui):**
  - Capacitor 8, `appId` `com.checkmage.app`, progetto `android/` versionato, portrait bloccato, traffico in chiaro
    solo nel manifest di debug (serve per il mock sulla LAN);
  - grafica del template Capacitor rimossa: icona adattiva col nostro re, splash a colore pieno, `minSdk` 24 → 26;
  - `createNativeStorage` su `@capacitor/preferences`: su dispositivo token e lingua stanno nello storage di sistema;
  - `src/platform/native.ts`: unico posto che conosce Capacitor, con import dinamici (il bundle web non cresce);
  - `connection.wake()`: alla ripresa dal background il socket riparte con un ticket nuovo;
  - la mano non finisce più sotto la barra di navigazione (`sticky-bottom-safe`).
- **Verifica:** typecheck, lint e build puliti; 341 test verdi; e2e 10/10; `npx cap sync android` pulito. Bundle:
  519 kB iniziali (162 kB gzip, due chunk) più 66 kB per la partita; i pacchetti Capacitor restano fuori dal
  caricamento iniziale del web; `/dev/cards` non esiste nella build di produzione.

## Prossima azione concreta
Costruire l'APK seguendo `docs/ANDROID.md` e provarlo contro una scheda desktop sullo stesso mock. Poi Plan Mode per
lo **Step 7** (integrazione col server reale).

## Decisioni prese
- React 19 + Router 8, i18n tipizzato, font self-hosted. Token in `localStorage` sul web (C7), in
  `@capacitor/preferences` su dispositivo.
- WebSocket con ticket monouso; il colore arriva da `game_state`, non si deduce mai.
- Pezzi, icone degli effetti e icona dell'app: SVG disegnati qui, nessuna dipendenza da set di terzi (CREDITS.md).
- Storico in UCI: la notazione SAN non è ricostruibile con le magie di mezzo (B7).
- Niente flavour text nel client: il testo di regole si genera dai parametri del catalogo (richiesta P2-15).
- La carta spenta si distingue per superficie e cornice, non per opacità: il contrasto del testo deve restare AA.
- Capacitor 8, `appId` `com.checkmage.app`, `minSdk` 26 (icona solo adattiva, nessun PNG del logo Capacitor).

## Decisioni aperte
- **Licenza del progetto**: serve, il repo contiene grafica originale (CREDITS.md).
- **Icona dell'app**: oggi è il nostro re, riportato dal set dei pezzi. Se vuoi un logo vero, è lì che si cambia.
- Merge di `fix/backend-requests` in `main` e deploy (lato server). P2-1 (cadenze, UI lobby) da decidere insieme.
  P2-11 sospesa. Aperte anche P2-12, P2-13, P2-14, P2-15.

## Da ricordare negli Step successivi
- **Step 6, quello che manca:** APK costruito e provato sul telefono (`docs/ANDROID.md`). Qui non c'è il toolchain
  Android, quindi la build non è mai stata eseguita: se Gradle si lamenta di una risorsa, il punto da guardare sono
  le modifiche in `android/app/src/main/res/`.
- **Step 7:** verifica a runtime sulla VM (C1, C4, C9–C14, G4, G6, G10, A15, scudo/en passant, patta decaduta).
  C13: i turni residui restano indietro finché non arriva un `game_state` (P2-14).
- B16: con soli pezzi congelati non ci sono mosse da evidenziare e resta la resa, sempre abilitata.
- iOS non è mai stato aggiunto: `src/platform/native.ts` e `capacitor.config.ts` sono già scritti per reggerlo.

## Note d'ambiente
- La shell dello strumento non vede Node nel PATH: prima dei comandi npm va ricaricato il PATH di Machine e User.
- Niente JDK, Android SDK o Android Studio su questa macchina: `cap sync` funziona, `gradlew` no.
- `.env` locale da `.env.example` (ignorato da git). `.claude/launch.json`: `dev` (5173), `mock` (8080).
- `tests/match-ui.test.tsx` usa la libreria `ws` come socket: il `WebSocket` di jsdom e quello di Node litigano.
- Prove a mano rimaste a te (io non creo account né digito password nel browser): due schede con due utenti, magie
  castate da entrambe le parti, e la prova sul telefono descritta in `docs/ANDROID.md`.
- Identità git locale del repo: Riccardo Picozzi <riccardo.picozzi97@gmail.com>.
