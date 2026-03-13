# ♟️ Chess Server

A production-ready online chess backend built in **Go**, designed to power a full-featured chess game client (Unreal Engine 5). Inspired by the architecture of platforms like Chess.com and MTG Arena.

---

## Features

- **Real-time gameplay** via WebSocket — moves, timers, and game state streamed live to both players
- **Move validation** powered by [Stockfish](https://stockfishchess.org/) running server-side — the client is never trusted
- **Per-side countdown timers** with configurable increment, managed entirely server-side
- **Matchmaking queue** — players are automatically paired when two are waiting
- **ELO rating system** following the standard FIDE algorithm, updated after every game
- **JWT authentication** — stateless, secure, with 24-hour token expiry
- **Resign & draw offers** — including draw acceptance/rejection and automatic offer expiry on move
- **Mid-game reconnection** — disconnected players have a configurable window to reconnect before forfeiting
- **Game history** saved in PGN format to PostgreSQL
- **Leaderboard** and per-user game history API endpoints
- **Rate limiting** — per-IP, with stricter limits on auth endpoints to prevent brute force
- **Structured logging** with [Uber Zap](https://github.com/uber-go/zap) — JSON in production, colored output in development
- **Graceful shutdown** — active games are saved before the server exits
- **Environment-based configuration** via `.env` — no hardcoded credentials

---

## Tech Stack

| Component | Technology |
|---|---|
| Language | Go 1.23+ |
| HTTP Router | [Chi v5](https://github.com/go-chi/chi) |
| WebSocket | [Gorilla WebSocket](https://github.com/gorilla/websocket) |
| Database | PostgreSQL 16 |
| Cache / Queue | Redis *(planned)* |
| Chess Engine | Stockfish 16 |
| Auth | JWT ([golang-jwt/jwt v5](https://github.com/golang-jwt/jwt)) |
| Password Hashing | bcrypt (`golang.org/x/crypto`) |
| Logging | [Uber Zap](https://go.uber.org/zap) |
| Config | [godotenv](https://github.com/joho/godotenv) |
| Rate Limiting | `golang.org/x/time/rate` |

---

## Project Structure

```
chess-server/
├── main.go                        # Entry point — wires everything together
├── go.mod
├── go.sum
├── .env                           # Local config (not committed)
├── .env.example                   # Config reference template
├── .gitignore
└── internal/
    ├── api/
    │   └── router.go              # HTTP routes and middleware chain
    ├── config/
    │   └── config.go              # Environment config loader
    ├── db/
    │   └── db.go                  # PostgreSQL connection, SaveGame, ELO calculation
    ├── engine/
    │   └── stockfish.go           # Stockfish UCI interface (move validation, best move)
    ├── game/
    │   ├── client.go              # WebSocket client (read/write pumps)
    │   ├── room.go                # Game room (move handling, timers, draw/resign)
    │   └── manager.go             # Room registry and matchmaking queue
    ├── handlers/
    │   ├── auth.go                # Register, Login, Me
    │   ├── status.go              # Health check
    │   ├── stats.go               # Leaderboard, GameHistory
    │   └── ws.go                  # WebSocket upgrade handler
    ├── logger/
    │   └── logger.go              # Zap logger initialization
    └── middleware/
        ├── auth.go                # JWT validation middleware
        └── ratelimit.go           # Per-IP rate limiter middleware
```

---

## Getting Started

### Prerequisites

- Go 1.23+
- PostgreSQL 16
- Stockfish (`sudo apt install stockfish`)

### 1. Clone the repository

```bash
git clone https://github.com/yourusername/chess-server.git
cd chess-server
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_USER=chessuser
DB_PASSWORD=your_password
DB_NAME=chessdb

# JWT — use a long random string in production
JWT_SECRET=your-secret-here

# Server
SERVER_PORT=8080
ENV=development

# Game
DEFAULT_BASE_TIME=10m
DEFAULT_INCREMENT=5s
RECONNECT_TIMEOUT=30s

# Rate limiting (requests/second)
RATE_GENERAL=10
RATE_AUTH=3
RATE_WS=1
```

### 3. Set up the database

```bash
sudo -u postgres psql
```

```sql
CREATE USER chessuser WITH PASSWORD 'your_password';
CREATE DATABASE chessdb OWNER chessuser;
GRANT ALL PRIVILEGES ON DATABASE chessdb TO chessuser;
\q
```

```bash
psql -U chessuser -d chessdb -h localhost
```

```sql
CREATE TABLE users (
    id          SERIAL PRIMARY KEY,
    username    VARCHAR(50) UNIQUE NOT NULL,
    email       VARCHAR(255) UNIQUE NOT NULL,
    password    VARCHAR(255) NOT NULL,
    elo         INTEGER DEFAULT 1200,
    created_at  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE games (
    id           SERIAL PRIMARY KEY,
    white_id     INTEGER REFERENCES users(id),
    black_id     INTEGER REFERENCES users(id),
    pgn          TEXT,
    result       VARCHAR(10),
    time_control VARCHAR(20),
    played_at    TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_games_white ON games(white_id);
CREATE INDEX idx_games_black ON games(black_id);
CREATE INDEX idx_users_elo ON users(elo DESC);
```

### 4. Run

```bash
go run main.go
```

```
INFO  Configurazione caricata
INFO  Connesso al database   {"host": "localhost", "db": "chessdb"}
INFO  Stockfish pronto
INFO  Chess server avviato   {"addr": ":8080", "env": "development"}
```

---

## API Reference

### Public endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/status` | Health check |
| `POST` | `/auth/register` | Register a new user |
| `POST` | `/auth/login` | Login, returns JWT token |
| `GET` | `/leaderboard` | Top 10 players by ELO |

### Protected endpoints (require `Authorization: Bearer <token>`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/me` | Current user profile |
| `GET` | `/users/{id}/games` | Game history for a user |
| `GET` | `/ws` | WebSocket — join matchmaking queue |

---

## WebSocket Protocol

Connect to `/ws` with a valid JWT token in the `Authorization` header. You will be automatically queued for matchmaking. When two players are connected, a game starts immediately.

### Messages: Client → Server

```jsonc
// Make a move (UCI notation)
{ "type": "move", "payload": { "move": "e2e4" } }

// Resign
{ "type": "resign", "payload": {} }

// Offer a draw
{ "type": "draw_offer", "payload": {} }

// Accept a draw offer
{ "type": "draw_accepted", "payload": {} }

// Decline a draw offer
{ "type": "draw_declined", "payload": {} }
```

### Messages: Server → Client

```jsonc
// Game started
{ "type": "game_start", "payload": { "room_id": "room-1-2", "white": "mario", "black": "luigi", "fen": "rnbqkbnr/..." } }

// Game state after each move
{ "type": "game_state", "payload": { "board": { "fen": "...", "moves": ["e2e4"], "turn": "black", "status": "active" }, "white_time": 598000, "black_time": 600000 } }

// Timer update (every second)
{ "type": "timer_update", "payload": { "white_time": 597000, "black_time": 600000, "turn": "white" } }

// Game over
{ "type": "game_over", "payload": { "result": "1-0", "reason": "checkmate", "winner": "mario" } }

// Draw offer received
{ "type": "draw_offer", "payload": { "from": "mario" } }

// Opponent disconnected
{ "type": "opponent_disconnected", "payload": { "message": "mario si è disconnesso, aspettando riconnessione..." } }
```

### Game over reasons

| Reason | Description |
|--------|-------------|
| `checkmate` | Checkmate |
| `stalemate` | Stalemate |
| `draw` | Draw by insufficient material or 50-move rule |
| `agreement` | Draw by mutual agreement |
| `resign` | Player resigned |
| `timeout` | Player ran out of time |
| `abandonment` | Player failed to reconnect within the timeout window |
| `server_shutdown` | Server was shut down gracefully |

---

## ELO Rating

Ratings follow the standard FIDE ELO algorithm with a K-factor of 32. All players start at **1200**. Ratings are updated automatically at the end of every game.

```
Expected score  = 1 / (1 + 10^((opponent_elo - player_elo) / 400))
New ELO         = old_elo + K * (actual_score - expected_score)
```

---

## Reconnection

If a player disconnects mid-game, the server waits `RECONNECT_TIMEOUT` seconds (default 30s) before declaring the game forfeited. If the player reconnects within the window, the full game state is restored and play continues.

---

## Roadmap

- [ ] Redis-backed matchmaking queue with time control selection (Bullet / Blitz / Rapid)
- [ ] Unreal Engine 5 client
- [ ] Spectator mode
- [ ] Post-game analysis with Stockfish
- [ ] Docker + Docker Compose setup
- [ ] CI/CD pipeline

---

## License

MIT
