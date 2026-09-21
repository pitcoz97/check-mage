# PROGRESS

> Punto di ripartenza, non diario. Massimo una pagina. Leggilo prima di tutto il resto.

## Step corrente
**Step 3 — Layer WebSocket: COMPLETO, in attesa di review.** Non iniziare lo Step 4 senza approvazione.
Server: `C:\Projects\chess-server` (sola lettura, qui non eseguibile), branch `fix/backend-requests` (`62475c9`).

## Completo
- **Step 0 / 0-bis:** contratto sul codice Go, mock come porting di Go.
- **Step 1:** Vite 8, React 19, Router 8, Tailwind 4 legato ai token, i18n tipizzato, layout shell.
- **Step 2:** client REST con un solo refresh condiviso, sessione persistente, guardie, login/registrazione, profilo.
- **Step 2-bis:** mock, adapter e test riallineati al branch `fix/backend-requests` (un solo contratto).
- **Step 3:**
  - `src/lib/log.ts`: unico accesso alla console, attivo solo in sviluppo;
  - `src/ws/connection.ts`: ticket a ogni apertura, backoff 1s→30s con jitter, niente rientro su 4001 / chiusura voluta /
    ticket rifiutato, heartbeat sul silenzio (C10), invii distanziati di 220 ms, `nudge()` sull'evento `online`;
  - `src/store/matchStore.ts`: `applyServerEvent` puro ed esaustivo, mano riconciliata (C5), effetti dichiarati da
    `spell_cast`, interpolazione degli orologi, eventi dopo `game_over` ignorati;
  - `src/ws/dispatch.ts`: frame non decodificabile = no-op loggato;
  - `src/store/matchSession.ts`: coda, ripresa della partita salvata (C11), chiusura su logout;
  - UI minima: coda in lobby con Annulla, banner di connessione (countdown, "Riprendi qui"), fine partita testuale.
- **Verifica:** typecheck, lint, build puliti; 259 test verdi; e2e 10/10 scenari, ora guidati dallo stack vero
  (connessione, dispatch, reducer) con confronto reducer ↔ server in `pvp`, `spells` e `checkmate`.

## Prossima azione concreta
Review dello Step 3 e prove a mano nel browser (vedi sotto). Poi Plan Mode per lo **Step 4** (scacchiera e partita classica).

## Decisioni prese
- React 19 + Router 8, i18n tipizzato, font self-hosted. Login automatico dopo la registrazione.
- Token in `localStorage` sul web (C7). Il colore non si deduce: arriva da `game_state`.
- Mock e adapter seguono solo il contratto nuovo. WebSocket con ticket monouso.
- Dopo un ricaricamento `/match` riapre il socket solo se il client ricorda una partita aperta (C11).

## Decisioni aperte
- Merge di `fix/backend-requests` in `main` e deploy (lato server). P2-1 (cadenze, UI lobby) da decidere insieme.
  P2-11 sospesa finché non si decide il dominio di produzione. Nuove: P2-12, P2-13, P2-14.
- Capacitor 6 o 8, `appId` → Step 6. Flavour text → Step 5. Licenza → prima dello Step 4.

## Da ricordare negli Step successivi
- **Step 4:**
  - la scacchiera legge `matchStore`; le azioni passano da `session.send()`, che restituisce `false` a socket chiuso;
  - mossa ottimista riallineata al `game_state` (scudo che assorbe o si rompe);
  - `absorbed` nello storico; timer da `clockRemaining` (la formattazione manca ancora);
  - pannelli giocatore, resa e patta (l'offerta ricevuta si scarta da sé dopo la propria mossa);
  - il bundle è a 511 kB e Vite avvisa sopra i 500: valutare il caricamento differito della schermata Match.
- **Step 5:**
  - catalogo da `fetchSpellCatalog`, riserva `fallback.json`; 5 carte `noop`;
  - messaggi per i codici d'errore con i `details` (già normalizzati nell'adapter);
  - C13: i turni residui degli effetti restano indietro finché non arriva un `game_state` (P2-14);
  - B16: con solo pezzi congelati resta la resa; rotta `/dev/cards`.
- **Step 6:** in background il socket cade: alla ripresa chiamare `nudge()`/`resume()` e chiedere un ticket nuovo.
- **Step 7:** verifica a runtime sulla VM (C1, C4, C9–C13, G4, G6, G10, A15, scudo/en passant, patta decaduta).

## Note d'ambiente
- La shell dello strumento non vede Node nel PATH: prima dei comandi npm va ricaricato il PATH di Machine e User.
- `.env` locale da `.env.example` (ignorato da git). `.claude/launch.json`: `dev` (5173), `mock` (8080).
- Prove a mano dello Step 3 (da fare con un tuo login, io non digito password né creo account nel browser):
  Gioca → coda → Annulla; due schede che si accoppiano; riavvio del mock → banner con countdown e rientro automatico;
  stessa partita aperta in una terza scheda → "Riprendi qui".
- Identità git locale del repo: Riccardo Picozzi <riccardo.picozzi97@gmail.com>.
