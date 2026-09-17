# PROGRESS

> Punto di ripartenza, non diario. Massimo una pagina. Leggilo prima di tutto il resto.

## Step corrente
**Step 0-bis — Riallineamento al server reale: COMPLETO, in attesa di review.** Non iniziare lo Step 1
senza approvazione. Codice del server: `C:\Projects\chess-server` (sola lettura, commit `7f817e5`, qui non eseguibile).

## Completo
- **Documenti:** `CLAUDE.md` con la gerarchia delle fonti. `ASSUMPTIONS.md` riscritto sul codice
  (esiti di G1–G10 e A11–A19, aperte C1–C6, divergenze doc↔codice, regole R1–R12). `BACKEND-REQUESTS.md` con P0-5 e i bug B1–B15.
- **Client:** catalogo MVP da 11 magie; `model.ts`, `protocol.ts` (16 type) e `adapter.ts` sul contratto reale
  (inviluppo REST, refresh, player come colore, `hand`, effetti per casella, tabelle testo→codice degli errori);
  `connection.ts` con `?token=`.
- **Mock = porting di Go:** REST, rate limit, match FSM, magie, Tracker, orologio, coda e riconnessione.
  `MOCK_CONTRACT=current|proposed`, 9 scenari, bug del server replicati.
- **Verifica:** typecheck e lint puliti, 173 test verdi. `npm run mock:e2e` supera 18/18 scenari (9 × 2 contratti).
  Controllo manuale con curl fatto; repo del server invariato.

## Prossima azione concreta
Review dello Step 0-bis. Dopo l'approvazione, Plan Mode per lo **Step 1** (Vite + React + Tailwind + Router +
token + layout shell + i18n), con gli script `dev`/`build`.

## Decisioni prese
- Colore e avversario non si deducono: servono P0-5 al server; il client li legge da `game_state.white_player/black_player`.
- WebSocket con `?token=` in `connection.ts`; il ticket è la richiesta P1-8.
- Errori: testi del server mappati a codici nell'adapter; `tests/error-texts.test.ts` li incrocia con il mock.
- Il mock replica i bug ancora presenti (B1–B5, B7, B8, B10, B12–B15). Non replica quelli già corretti nel codice.
- Il contratto del mock si sceglie per processo (`MOCK_CONTRACT`), non per connessione: `/spells` dipende dal contratto.

## Decisioni aperte
- Portare P0-5 e B1 al server: senza P0-5 il client reale non conosce il proprio colore.
- `appId` (Step 6), testo di flavour sulle carte (Step 5), licenza del progetto (prima dello Step 4).

## Da ricordare negli Step successivi (da ASSUMPTIONS/BACKEND-REQUESTS)
- **Step 2:** login via email, refresh single-flight su 401.
- **Step 3:** chiudere del tutto il socket prima di riaprirlo (B2), ignorare gli eventi dopo `game_over` (B1),
  restare sotto i 5 messaggi/s, riconnettersi anche dopo un riavvio del server.
- **Step 4:** riallineare la mossa ottimista al `game_state` (scudo che assorbe la cattura).
- **Step 5:** `phase_changed` a raffica, `draw` compresa; auto-avanzamento anche dopo un cast; targeting di `piece_move`.

## Note d'ambiente
- La shell dello strumento non vede Node nel PATH: prima dei comandi npm va ricaricato il PATH di Machine e User.
- Identità git locale del repo: Riccardo Picozzi <riccardo.picozzi97@gmail.com>.
