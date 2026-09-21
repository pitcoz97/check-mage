# PROGRESS

> Punto di ripartenza, non diario. Massimo una pagina. Leggilo prima di tutto il resto.

## Step corrente
**Step 4 — Scacchiera e partita classica: COMPLETO, in attesa di review.** Non iniziare lo Step 5 senza approvazione.
Server: `C:\Projects\chess-server` (sola lettura, qui non eseguibile), branch `fix/backend-requests` (`62475c9`).

## Completo
- **Step 0 / 0-bis:** contratto sul codice Go, mock come porting di Go.
- **Step 1:** Vite 8, React 19, Router 8, Tailwind 4 legato ai token, i18n tipizzato, layout shell.
- **Step 2:** client REST con refresh condiviso, sessione persistente, guardie, login/registrazione, profilo.
- **Step 2-bis:** mock, adapter e test riallineati al branch `fix/backend-requests` (un solo contratto).
- **Step 3:** connessione con ticket, backoff e heartbeat; `applyServerEvent`; sessione; coda e banner.
- **Step 4:**
  - `src/game/position.ts`: pezzi, mosse legali, promozione e scacco dalla FEN con chess.js, solo come suggerimento;
  - `src/game/pieces/PieceIcon.tsx`: set di pezzi disegnato qui (CREDITS.md), colorato con i token;
  - `src/game/board/`: scacchiera orientata, evidenziazioni, tap-tap e drag (`selection.ts` è la parte pura), promozione;
  - mossa ottimista come sola anteprima grafica, riallineata dal `game_state` e annullata dall'`error`;
  - `src/screens/Match/`: pannelli con orologi interpolati, track delle fasi, azioni (passa, patta, resa con conferma),
    storico mosse, avvisi tradotti per ogni codice d'errore, riepilogo di fine partita;
  - la schermata di partita si carica a richiesta: bundle iniziale da 564 a 305 kB, chunk della partita 54 kB.
- **Verifica:** typecheck, lint e build puliti; 291 test verdi (291 comprende `tests/match-ui.test.tsx`: partita
  completa fino al matto cliccando sulle caselle, e riconnessione a metà partita); e2e 10/10 scenari.

## Prossima azione concreta
Review dello Step 4 e prova a mano con due schede (vedi note). Poi Plan Mode per lo **Step 5** (layer magie).

## Decisioni prese
- React 19 + Router 8, i18n tipizzato, font self-hosted. Token in `localStorage` sul web (C7).
- WebSocket con ticket monouso; il colore arriva da `game_state`, non si deduce mai.
- Pezzi: set originale in SVG, nessuna dipendenza da set di terzi.
- Storico in UCI: la notazione SAN non è ricostruibile con le magie di mezzo (B7).

## Decisioni aperte
- **Licenza del progetto**: ora serve davvero, perché il repo contiene grafica originale (CREDITS.md).
- Merge di `fix/backend-requests` in `main` e deploy (lato server). P2-1 (cadenze, UI lobby) da decidere insieme.
  P2-11 sospesa. Aperte anche P2-12, P2-13, P2-14.
- Capacitor 6 o 8, `appId` → Step 6. Flavour text sulle carte → Step 5.

## Da ricordare negli Step successivi
- **Step 5:**
  - la mano è un segnaposto con il solo conteggio: le carte vere, il mana e il targeting arrivano ora;
  - catalogo da `fetchSpellCatalog`, riserva `fallback.json`; 5 carte `noop`; rotta `/dev/cards`;
  - i badge degli effetti vanno sul pezzo (gli effetti sono già nello store, per casella);
  - C13: i turni residui restano indietro finché non arriva un `game_state` (P2-14);
  - B16: con soli pezzi congelati resta la resa.
- **Step 6:** in background il socket cade: alla ripresa `nudge()`/`resume()` e ticket nuovo. Safe area già nel layout.
- **Step 7:** verifica a runtime sulla VM (C1, C4, C9–C13, G4, G6, G10, A15, scudo/en passant, patta decaduta).

## Note d'ambiente
- La shell dello strumento non vede Node nel PATH: prima dei comandi npm va ricaricato il PATH di Machine e User.
- `.env` locale da `.env.example` (ignorato da git). `.claude/launch.json`: `dev` (5173), `mock` (8080).
- `tests/match-ui.test.tsx` usa la libreria `ws` come socket: il `WebSocket` di jsdom e quello di Node litigano.
- Prove a mano rimaste a te (io non creo account né digito password nel browser): due schede con due utenti, partita
  fino al matto, timer coerenti, e una scheda chiusa e riaperta a metà partita.
- Identità git locale del repo: Riccardo Picozzi <riccardo.picozzi97@gmail.com>.
