# CheckMage

Scacchi con un sistema di magie: ogni turno si pesca, si lanciano magie col mana, si muove, e si possono lanciare
altre magie. Il server è autoritativo; il client gira nel browser e su Android.

| Cartella | Contenuto | Stack |
|---|---|---|
| [`server/`](server/) | Backend: REST, WebSocket, matchmaking, ELO, persistenza, logica di gioco e magie | Go, PostgreSQL, Stockfish |
| [`client/`](client/) | Client web e mobile, più il mock server usato per sviluppo e test | React, TypeScript, Vite, Capacitor |

## Avvio rapido

Server (serve PostgreSQL e Stockfish; configurazione in `server/.env`, vedi `server/.env.example`):

```bash
cd server
go run main.go
```

Client contro il mock, senza server Go:

```bash
cd client
npm install
npm run mock   # mock REST + WebSocket su :8080
npm run dev    # client su :5173
```

Per puntare il client al server vero basta cambiare `VITE_API_BASE_URL` e `VITE_WS_URL` in `client/.env`
(vedi `client/.env.example`).

## Documentazione

- Protocollo WebSocket: [`server/PROTOCOL.md`](server/PROTOCOL.md)
- Modifiche al server fatte per il client: [`server/docs/SERVER-CHANGES.md`](server/docs/SERVER-CHANGES.md)
- Catalogo magie e roadmap: [`client/docs/BRIEFING-MAGIE.md`](client/docs/BRIEFING-MAGIE.md)
- Stato del lavoro: [`client/docs/PROGRESS.md`](client/docs/PROGRESS.md)

Dettagli di ciascuna parte nei rispettivi README e `CLAUDE.md`.
