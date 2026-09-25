# PROGRESS

> Punto di ripartenza, non diario. Massimo una pagina. Leggilo prima di tutto il resto.

## Step corrente
**Redesign, step R1 (fondamenta) — fatto, in attesa di review.** Branch `feat/redesign`. Analisi, decisioni (D1–D22)
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
    `npm run fonts:pieces`, riproducibile), non ancora usato dalla scacchiera (R2);
  - `Button` (primario, secondario, oro, pericolo; `md` 48px e `lg` 60px), `Panel` senza bordo, `TextField`, `Spinner`;
  - `tests/contrast.test.ts`: ogni coppia testo/superficie ≥ 4.5:1. Unico colore corretto: #7F786E → #928B81 (D4);
  - sfondo nativo Android #1B1A1F; icona non toccata (D22).
- **Verifica R1:** typecheck, lint, build puliti; 416 test verdi; e2e 10/10; `cap sync android` pulito. JS invariato
  (520 kB iniziali); i font si scaricano per sottoinsieme Unicode, solo quelli usati.

## Prossima azione concreta
Review di R1 (login e registrazione mostrano già il nuovo linguaggio; lobby e partita cambiano davvero da R2 in poi).
Poi R2 — scacchiera e pezzi.

## Decisioni prese
- Redesign: tutte in `REDESIGN_PLAN.md` §10 (D1–D22). Il design vince sulla resa, CLAUDE.md sul resto.
- Pezzi: glifi di Noto Sans Symbols 2 ritagliati (D2), al posto del set SVG disegnato allo Step 4.
- Storico in UCI (D18). Niente flavour text nel client (P2-15). Cadenza unica (P2-1 non più necessaria).
- WebSocket con ticket monouso; il colore arriva da `game_state`. Token in `localStorage` sul web, in
  `@capacitor/preferences` su dispositivo.

## Decisioni aperte
- **Licenza del progetto** (il repo contiene grafica originale, CREDITS.md). **Icona dell'app** (D22: dopo).
- Merge di `fix/backend-requests` in `main` e deploy. Richieste aperte: P2-11 (sospesa), P2-12…P2-21.

## Da ricordare negli Step successivi
- R2: la scacchiera deve impostare `data-board-theme` dalla preferenza (Impostazioni in R5); ridisegnare
  `--board-hint/-check/-select/-cast`, oggi ai valori pre-redesign.
- R3: ASSUMPTIONS C14 dice "motivo scritto sulla carta": cambia con D5.
- R4: `--mana-*`, `--spell-frame`, `--effect-*` sono valori ponte.
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
