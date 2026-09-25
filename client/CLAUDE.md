# CheckMage — client

Client web e mobile (browser, Android, poi iOS) per CheckMage: scacchi con un sistema
di magie. Il backend è un server Go già esistente. React + TypeScript + Vite + Capacitor.

Il briefing completo è in `docs/BRIEFING-CLIENT.md`: leggilo a inizio sessione, è vincolante.

## Comandi

```bash
npm run dev        # dev server Vite (porta 5173)
npm run mock       # mock server REST + WebSocket (aggiunto allo Step 0)
npm run build
npm run test
npm run lint
npm run typecheck
npm run android:sync   # build del client + copia nel progetto nativo (dallo Step 6)
npm run android:open   # apre il progetto in Android Studio (l'APK si costruisce da lì, vedi docs/ANDROID.md)
```

Serve sempre `npm run mock` in parallelo a `npm run dev`: senza, il client non ha backend.

## Stato del backend

Il codice del server Go è nello stesso repository, in `../server` (monorepo `check-mage`: `client/` e `server/`).
Dal 25 settembre 2026 **si può modificare**, ma solo sul branch della feature in corso (oggi `feat/spell-catalog`);
`server/.env` non si legge. Le modifiche fatte per il client sono riassunte in `docs/SERVER-CHANGES.md` del server.

Qui il server **non è eseguibile** (niente Go, Postgres, Stockfish): i test del server (`go vet ./... && go test
./...`) li lancia l'utente sulla VM, e il client si sviluppa contro il mock in `mock-server/`, che è un porting
fedele della logica Go. Ogni modifica al server va portata anche nel mock.

Gerarchia delle fonti, dalla più autorevole: **codice Go** > `PROTOCOL.md` e `docs/SERVER-CHANGES.md` del server >
`docs/SERVER_API.md` e `docs/FRONTEND_TEST_SPEC.md` (ignora le parti Unreal; alcuni punti sono
superati dal codice, vedi `docs/ASSUMPTIONS.md`) > briefing §3.

- Ogni affermazione sul comportamento del server va verificata sul codice e citata come
  `file.go:riga`. Ciò che il codice non determina va in `docs/ASSUMPTIONS.md` **prima**
  di implementarlo, con il motivo.
- Ogni modifica che servirebbe al server va aggiunta a `docs/BACKEND-REQUESTS.md` con
  contratto proposto e priorità. Mai risolvere un limite del backend inventando un
  comportamento nel client.
- Il mock non è codice usa-e-getta: resta l'ambiente di test anche dopo l'integrazione.

## Regole di architettura

- **Il server è autoritativo.** Nessuna logica di gioco duplicata nel client: non validare
  mosse, non calcolare effetti di magie, non decidere fasi o turni. chess.js serve solo per
  evidenziare mosse legali, mai come autorità.
- **Ottimismo solo sulla propria mossa scacchistica**, con rollback su `error` e
  riallineamento al `game_state` successivo (uno scudo può assorbire la cattura). Mai su
  magie, mana, pesca o cambio di fase.
- **Informazione nascosta:** non deve esistere una struttura dati client-side che contenga
  il mazzo completo o la mano dell'avversario.
- **`src/api/adapter.ts` è l'unico posto** dove i payload grezzi del server vengono
  interpretati o normalizzati. Se stai scrivendo una normalizzazione altrove, fermati.
- **`src/ws/connection.ts` è l'unico posto** che conosce la strategia di autenticazione
  del WebSocket.
- **Tutti gli eventi server passano da `applyServerEvent`** nel matchStore. Nessun
  componente muta lo stato di gioco direttamente.
- **Niente `switch` su `spell_id`.** Le magie si renderizzano dai dati del catalogo; gli
  effetti e i tipi di bersaglio si aggiungono nei registry in `src/spells/`.
- **Nessun import da `mock-server/` dentro `src/`.** Le sue dipendenze stanno in
  `devDependencies`.

## Regole di codice

- TypeScript strict. Niente `any`, niente `@ts-ignore` senza commento che lo giustifichi.
- Nessun colore hardcoded: usa le variabili in `src/design/tokens.css`.
- Nessuna stringa UI hardcoded: passa da i18n (italiano default, inglese secondario).
- Non mostrare mai testo grezzo proveniente dal server: mappa il `type` del messaggio
  sulle stringhe localizzate.
- Nessun segreto nel repo. Solo variabili `VITE_*`. `.env` resta in `.gitignore`.
- Nessun `console.log` nel codice committato.
- Storage sempre tramite l'astrazione `src/lib/storage.ts`, mai `localStorage` diretto
  nei componenti.
- Test obbligatori su: reducer degli eventi WebSocket, macchina di targeting, abilitazione
  delle carte (mana + fase), formattazione dei timer.

## Processo

- Un solo Step della roadmap (§11 del briefing) per volta. Entra in Plan Mode, presenta il
  piano, aspetta approvazione, poi implementa. Al termine verifica i criteri di
  accettazione e fermati per la review.
- Commit atomici, Conventional Commits.
- Se il briefing è ambiguo o contraddittorio su un punto, chiedi invece di scegliere.
