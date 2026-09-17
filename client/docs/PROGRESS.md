# PROGRESS

> Punto di ripartenza, non diario. Massimo una pagina. Leggilo prima di tutto il resto.

## Step corrente
**Step 0-bis — Riallineamento di contratto e mock al server reale** (piano approvato il 2026-09-17).
Il codice del server è leggibile in `C:\Projects\chess-server` (sola lettura, qui non eseguibile).
Piano: `C:\Users\rpicozzi\.claude\plans\hidden-strolling-sunset.md`.

## Completo
- Step 0 originale (contratto ricostruito, mock, e2e): superato nei contenuti, resta l'impianto.
- 0-bis/1: `CLAUDE.md` (gerarchia delle fonti), `ASSUMPTIONS.md` riscritto sul codice,
  `BACKEND-REQUESTS.md` con P0-5 e i bug B1–B14.

## In corso
- 0-bis/2: catalogo MVP reale (11 magie) e target `piece_move`.

## Da fare nello Step 0-bis
3. `model.ts` / `protocol.ts` / `adapter.ts` (+ `connection.ts`) sul contratto reale, con tabelle dei testi d'errore.
4. Mock REST e matchmaking come porting di Go.
5. Mock partita (FSM, magie, Tracker, orologio) come porting di Go.
6. Contratti `current`/`proposed`, bug replicati, scenari.
7. e2e su entrambi i contratti e controllo incrociato dei testi d'errore.

## Prossima azione concreta
Riscrivere `src/spells/fallback.json` e `mock-server/spells.json` da `internal/spells/spells.go:83-95`.

## Decisioni prese
- Il colore del giocatore non si deduce: P0-5 (`white_player`/`black_player` in `game_state`), mock con contratto `proposed`.
- WebSocket con `?token=` in `connection.ts`; il ticket è la richiesta P1-8.
- Errori: tabella testo → codice ricavata dal codice Go; testo sconosciuto → messaggio generico legato all'azione.
- Il mock replica i bug ancora presenti nel server (B1, B2, B4, B5, B8, B10, B13, B14…).

## Decisioni aperte
- `appId` (Step 6), testo di flavour sulle carte (Step 5), licenza del progetto (prima dello Step 4).

## Note d'ambiente
- La shell dello strumento non vede Node nel PATH: prima dei comandi npm va ricaricato il PATH di Machine e User.
- Identità git locale del repo: Riccardo Picozzi <riccardo.picozzi97@gmail.com>.
