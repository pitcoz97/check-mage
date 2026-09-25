# PROGRESS

> Punto di ripartenza, non diario. Massimo una pagina. Leggilo prima di tutto il resto.

## Step corrente
**Redesign, step R3 (carta e mano) — fatto, in attesa di review.** R1 e R2 approvati. Branch `feat/redesign`. Analisi, decisioni (D1–D22)
e step R1–R6 in `REDESIGN_PLAN.md`; il design sta in `design-reference/` (fuori da git).
Prima del redesign: Step 0–7 completi, Step 6 in attesa dell'APK (`docs/ANDROID.md`).
Server: `C:\Projects\chess-server` (sola lettura, qui non eseguibile), branch `fix/backend-requests` (`62475c9`).

## Completo
- **Step 0–5:** contratto sul codice Go e mock che lo porta; shell, i18n, token; REST con refresh, sessione, guardie;
  WebSocket con ticket e `applyServerEvent`; scacchiera, orologi, partita; layer magie (catalogo, registry di effetti
  e bersagli, targeting, giocabilità, `/dev/cards` solo in sviluppo).
- **Step 6 (la parte fattibile qui):** Capacitor 8, `android/` versionato, storage nativo, `connection.wake()`.
- **Step 7:** `npm run verify:server` (47/0 contro il server reale, 45/0 contro il mock), `docs/INTEGRAZIONE.md`,
  fix del socket rifiutato in Node.
- **Redesign R1:**
  - `tokens.css` con la palette del design, per ruolo (l'accento diventa l'oro, il verde è solo la CTA), i tre temi
    della scacchiera (arcano di default, salvia e noce sotto `[data-board-theme]`), bordi 3D, anelli e aloni;
  - `theme.css` con scale **numeriche** (`text-13`, `rounded-10`, `shadow-edge-play`…); classi esistenti migrate a
    parità di valore;
  - Figtree, Cinzel 600–800, JetBrains Mono; font dei pezzi ritagliato ai sei glifi pieni (4,5 KB,
    `npm run fonts:pieces`, riproducibile);
  - `Button` (primario, secondario, oro, pericolo; `md` 48px e `lg` 60px), `Panel` senza bordo, `TextField`, `Spinner`;
  - `tests/contrast.test.ts`: ogni coppia testo/superficie ≥ 4.5:1. Unico colore corretto: #7F786E → #928B81 (D4);
  - sfondo nativo Android #1B1A1F; icona non toccata (D22).
- **Redesign R2:**
  - pezzi = glifi pieni del font ritagliato (80% della casa con le container query, contorni del design; U+FE0E contro
    la forma emoji di ♟), il set SVG dello Step 4 esce;
  - `BoardSquare`: strati del componente Scacchiera del design (ultima mossa, congelato, protetto, bersagli viola,
    badge in alto a destra coi turni residui, coordinate dentro le case); mosse legali, selezione e scacco ridisegnati
    (D3); lampeggio della magia in viola. Il registry degli stati possiede velo e badge;
  - temi con preferenza salvata (`board-theme`), letta prima del primo render; manca il selettore (R5);
  - `MiniBoard` senza chess.js per la home; `fen.ts` legge la FEN senza regole;
  - `/dev/board`: la posizione del design in tutti gli stati e nei tre temi. Confronto via DOM col design: casa 70px,
    glifo 56px, colori, ombre, coordinate 13px, badge 18px a 3px dall'angolo — coincidono.
- **Redesign R3:**
  - carta nella struttura del componente Carta (200×280: cornice per rarità, moneta del costo, arte per kind, riga del
    tipo, regole su pergamena); rarità comune finché il catalogo non la manda (P2-15); icone a tratto del design;
  - nome lungo: scende fino a 10px, poi va a capo (anche dentro un id senza spazi);
  - carta spenta: velo scuro al **30%**, il massimo che tiene ogni testo AA (al 50% la moneta scende a 3:1, lo ha
    trovato il test di contrasto); resta toccabile e il motivo compare nell'avviso (in R4 nel box);
  - mano a ventaglio del design, geometria in CSS (`.hand-fan`), passo che si stringe se le carte non entrano; secondo
    tocco annulla, niente pulsante Annulla; anteprima grande al passaggio, al focus e alla pressione prolungata;
  - `/dev/cards` a grandezza di design, con la mano a ventaglio.
- **Verifica R3:** typecheck, lint, build puliti; 439 test verdi; e2e 10/10. Confronto via DOM col componente Carta:
  tutte le misure coincidono.
- **Verifica R2:** typecheck, lint, build puliti; 432 test verdi; e2e 10/10. JS iniziale invariato (311 + 210 kB).
- **Verifica R1:** typecheck, lint, build puliti; 416 test verdi; e2e 10/10; `cap sync android` pulito. JS invariato
  (520 kB iniziali); i font si scaricano per sottoinsieme Unicode, solo quelli usati.

## Prossima azione concreta
Review di R3: `/dev/cards` in sviluppo, e la partita vera col login. Poi R4 — la partita.

## Decisioni prese
- Redesign: tutte in `REDESIGN_PLAN.md` §10 (D1–D22). Il design vince sulla resa, CLAUDE.md sul resto.
- Pezzi: glifi di Noto Sans Symbols 2 ritagliati (D2), al posto del set SVG disegnato allo Step 4.
- Mosse legali = stessa forma dei bersagli di magia in un altro colore; scacco = alone arancio "Mitica" (D3).
- Storico in UCI (D18). Niente flavour text nel client (P2-15). Cadenza unica (P2-1 non più necessaria).
- WebSocket con ticket monouso; il colore arriva da `game_state`. Token in `localStorage` sul web, in
  `@capacitor/preferences` su dispositivo.

## Decisioni aperte
- **Licenza del progetto** (il repo contiene grafica originale, CREDITS.md). **Icona dell'app** (D22: dopo).
- Merge di `fix/backend-requests` in `main` e deploy. Richieste aperte: P2-11 (sospesa), P2-12…P2-21.

## Da ricordare negli Step successivi
- R5: selettore del tema (`boardThemeStore.set`) nelle Impostazioni; la miniatura della home è `MiniBoard`.
- R4: `--mana-*` sono valori ponte; il motivo della carta spenta e gli avvisi vanno nel box del suggerimento; la
  mano va sovrapposta al bordo inferiore come nelle tavole.
- APK mai costruito qui: se Gradle si lamenta, guardare `android/app/src/main/res/`.
- Rilanciare `verify:server` a ogni cambiamento del server.

## Note d'ambiente
- La shell dello strumento non vede Node nel PATH: prima dei comandi npm va ricaricato il PATH di Machine e User.
- Niente JDK/Android SDK: `cap sync` funziona, `gradlew` no.
- `.env` punta al server reale `http://192.168.222.128:8080`; per il mock `localhost:8080` e `npm run mock`.
  `.claude/launch.json`: `dev` (5173), `mock` (8080). Il design si apre su `http://localhost:5173/design-reference/Design.html`.
- `tests/auth-flow.test.ts` aspetta 2,1 s una scadenza vera: sotto carico ha fallito una volta; alzare quel tempo.
- Prove a mano rimaste a te (io non creo account né digito password nel browser): lobby e partita nel nuovo
  aspetto, due schede con due utenti, prova sul telefono.
- Identità git locale del repo: Riccardo Picozzi <riccardo.picozzi97@gmail.com>.
