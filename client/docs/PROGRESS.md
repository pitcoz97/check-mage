# PROGRESS

> Punto di ripartenza, non diario. Massimo una pagina. Leggilo prima di tutto il resto.

## Step corrente
**Step 5 — Layer magie: COMPLETO, in attesa di review.** Non iniziare lo Step 6 senza approvazione.
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
- **Verifica:** typecheck, lint e build puliti; 330 test verdi; e2e 10/10 scenari. Bundle: 519 kB iniziali (162 kB
  gzip, due chunk) più 66 kB per la schermata di partita; `/dev/cards` non esiste nella build di produzione. `tests/match-ui.test.tsx` copre i
  criteri dello Step 5 cliccando sulla UI vera: tutti e sette i kind di effetto, cast in main1 e main2, targeting
  annullato, carte disabilitate col motivo, scudo che segue il pedone, Teleport che non avanza la fase, pickup
  rifiutato su un pezzo congelato dal bot.

## Prossima azione concreta
Review dello Step 5 e prova a mano con due schede (vedi note). Poi Plan Mode per lo **Step 6** (build Android).

## Decisioni prese
- React 19 + Router 8, i18n tipizzato, font self-hosted. Token in `localStorage` sul web (C7).
- WebSocket con ticket monouso; il colore arriva da `game_state`, non si deduce mai.
- Pezzi e icone degli effetti: SVG disegnati qui, nessuna dipendenza da set di terzi (CREDITS.md).
- Storico in UCI: la notazione SAN non è ricostruibile con le magie di mezzo (B7).
- Niente flavour text nel client: il testo di regole si genera dai parametri del catalogo (richiesta P2-15).
- La carta spenta si distingue per superficie e cornice, non per opacità: il contrasto del testo deve restare AA.

## Decisioni aperte
- **Licenza del progetto**: serve, il repo contiene grafica originale (CREDITS.md).
- Merge di `fix/backend-requests` in `main` e deploy (lato server). P2-1 (cadenze, UI lobby) da decidere insieme.
  P2-11 sospesa. Aperte anche P2-12, P2-13, P2-14, P2-15.
- Capacitor 6 o 8, `appId` → Step 6.

## Da ricordare negli Step successivi
- **Step 6:** in background il socket cade: alla ripresa `nudge()`/`resume()` e ticket nuovo. Safe area già nel layout.
  La mano è una riga che scorre: su schermo stretto va verificata con le safe area vere.
- **Step 7:** verifica a runtime sulla VM (C1, C4, C9–C14, G4, G6, G10, A15, scudo/en passant, patta decaduta).
  C13: i turni residui restano indietro finché non arriva un `game_state` (P2-14).
- B16: con soli pezzi congelati non ci sono mosse da evidenziare e resta la resa, sempre abilitata.

## Note d'ambiente
- La shell dello strumento non vede Node nel PATH: prima dei comandi npm va ricaricato il PATH di Machine e User.
- `.env` locale da `.env.example` (ignorato da git). `.claude/launch.json`: `dev` (5173), `mock` (8080).
- `tests/match-ui.test.tsx` usa la libreria `ws` come socket: il `WebSocket` di jsdom e quello di Node litigano.
- Prove a mano rimaste a te (io non creo account né digito password nel browser): due schede con due utenti, magie
  castate da entrambe le parti, targeting annullato, e una scheda chiusa e riaperta a metà partita.
- Identità git locale del repo: Riccardo Picozzi <riccardo.picozzi97@gmail.com>.
