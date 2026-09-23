# Integrazione col server reale

Procedura per passare dal mock al server Go, e per verificare che il contratto regga davvero.

> **Stato.** Il client è allineato al branch `fix/backend-requests` (commit `62475c9`) del server: le patch P0 sono
> già dentro, non c'è niente da riportare. Quello che manca è la **verifica a runtime**, che qui non si può fare —
> il server non è eseguibile su questa macchina (niente Go, Postgres, Stockfish) e non c'è un deploy da interrogare.

---

## 1. Portare su il server

1. Unire `fix/backend-requests` in `main` (oggi è 6 commit avanti) e fare il deploy.
2. Nel CORS del server (`AllowedOrigins`, `config/config.go:74-75`) devono essere accettate:
   - `http://localhost:5173` — sviluppo web;
   - `https://localhost` — WebView Android (`androidScheme: 'https'`);
   - il dominio di produzione del client.
   La configurazione di default (`https://*`, `http://*`, `capacitor://localhost`) le copre già tutte.
3. In produzione il server deve stare **dietro HTTPS**: il client web moderno non apre un WebSocket in chiaro da una
   pagina sicura, e la build Android di release non ha il permesso per il traffico non cifrato.

## 2. Puntare il client

Solo due variabili, in `.env` (sviluppo) o nell'ambiente di build (produzione):

```bash
VITE_API_BASE_URL=https://api.checkmage.it
```

```bash
VITE_WS_URL=wss://api.checkmage.it/ws
```

`src/config/env.ts` le valida all'avvio: schema mancante, `ws://` sotto `https`, barra finale o path del WebSocket
assente fanno fallire subito con il motivo scritto, invece di diventare un errore di connessione dopo il login.

## 3. Verificare il contratto

Con il server raggiungibile:

```bash
npm run verify:server -- --http https://api.checkmage.it --ws wss://api.checkmage.it/ws
```

Cosa fa: registra due account usa-e-getta (`verify_<stamp>_a/b`), li fa giocare una partita vera con **lo stack del
client** — adapter, connessione con ticket, dispatch, reducer — e stampa una riga per ogni voce di
`ASSUMPTIONS.md`: REST e testi d'errore, catalogo, ticket monouso, avvio partita e colori, rifiuti con i loro
codici, cadenza dei `timer_update`, magie ed effetti dichiarati, riconnessione con stato completo, patta offerta,
rifiutata e decaduta, connessione sostituita (4001), fine partita.

Varianti utili:

```bash
npm run verify:server -- --http … --ws … --users mario@x.it:Password1,luigi@x.it:Password1
```

usa due account già esistenti invece di registrarne di nuovi;

```bash
npm run verify:server -- --http … --ws … --slow
```

aggiunge i controlli lenti: sopravvivenza del socket oltre il minuto (heartbeat) e rate limit per IP su `/auth`;

```bash
npm run verify:server -- --http … --ws … --json > rapporto.json
```

produce il rapporto in JSON, da allegare ad `ASSUMPTIONS.md`.

**Prima di lanciarlo:** il server deve essere tranquillo. I due client si accoppiano dalla coda di matchmaking, e
se un terzo giocatore è in attesa lo strumento se ne accorge e salta la parte di partita invece di dare esiti falsi.

Senza `--http`/`--ws` il comando gira contro il mock in-process: serve a tenere lo strumento stesso verificato, ed è
il modo di controllare che una modifica al client non abbia rotto la suite.

## 4. Leggere il rapporto

| Esito | Significato | Cosa fare |
|---|---|---|
| `✔ ok` | il server si comporta come il client assume | segnare la voce come verificata a runtime in `ASSUMPTIONS.md` |
| `✘ diverso` | il server fa altro | correggere **solo** `src/api/adapter.ts` o `src/ws/connection.ts` |
| `· saltato` | non verificabile in automatico | verifica a mano, o resta coperto dal mock |
| `i nota` | informazione, non un esito | per esempio una richiesta al backend che risulta applicata |

**La regola dello Step 7 non cambia:** una divergenza si corregge nell'adapter o nella connessione, mai nei
componenti e mai duplicando logica di gioco. Dopo ogni correzione:

1. aggiornare il **mock** perché rifletta il server vero (resta l'ambiente di test, non si abbandona);
2. aggiornare i test che ne dipendono e rilanciare `npm test` e `npm run mock:e2e`;
3. aggiornare la voce in `ASSUMPTIONS.md` e, se serve, aprire o chiudere una voce in `BACKEND-REQUESTS.md`.

## 5. Android contro il server vero

Stessa procedura di `docs/ANDROID.md`, con due differenze: le variabili puntano al dominio vero (`https`/`wss`) e
serve una build di **release**, che non ha il permesso per il traffico in chiaro. L'origine della WebView è
`https://localhost`, quindi deve essere accettata dal CORS del server.

## 6. Cosa resta comunque a mano

- Scudo sull'en passant, posizioni costruite, matto con soli pezzi congelati: servono mazzi pilotati, che il server
  vero non permette. Restano coperti dal mock (`mock-server/game/room.test.ts`).
- Le scelte del client che il server non conosce: partita salvata dopo un ricaricamento (C11) e finestra di rientro
  mostrata nel banner (C12).
- Due schede vere e il telefono: partita completa, magie da entrambe le parti, chiusura e riapertura a metà partita.
