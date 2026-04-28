# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A production-ready online chess backend built in Go, designed to power a full-featured chess game client. Uses WebSocket for real-time gameplay, Stockfish for move validation, and PostgreSQL for persistence.

## Development Commands

```bash
# Run the server (requires PostgreSQL and Stockfish installed)
go run main.go

# Build the binary
go build -o chess-server main.go

# Run with specific environment file
ENV=production go run main.go
```

## Architecture

### Project Structure

Standard Go layout with `internal/` packages:

- `main.go` - Entry point: wires config, logger, DB, Stockfish, and starts HTTP server
- `internal/api/router.go` - Chi router with route groups and middleware chain
- `internal/config/` - Environment-based config loader using godotenv
- `internal/db/` - PostgreSQL connection and persistence (games, ELO updates)
- `internal/engine/stockfish.go` - Stockfish UCI interface for move validation and game status
- `internal/game/` - Core game logic: WebSocket client, room management, matchmaking
- `internal/handlers/` - HTTP handlers for auth, stats, status, WebSocket upgrade
- `internal/middleware/` - JWT auth and per-IP rate limiting
- `internal/logger/` - Zap logger initialization
- `internal/models/` - Shared data structures

### Key Global Singletons

The codebase uses global singletons for shared state (common pattern in Go servers):

- `config.C` - Loaded configuration instance
- `logger.L` - Zap logger instance
- `engine.SF` - Stockfish engine instance
- `game.GameManager` - Room registry and matchmaking queue

### Concurrency Model

- `game.Manager` uses `sync.RWMutex` to protect rooms map and matchmaking queue
- Each WebSocket connection spawns two goroutines: `readPump` and `writePump`
- Stockfish engine uses mutex to serialize UCI commands (one at a time)

### WebSocket Protocol

Clients connect to `/ws` with JWT in `Authorization` header. Messages are JSON:

Client → Server: `{"type": "move", "payload": {"move": "e2e4"}}`
Server → Client: `{"type": "game_state", "payload": {...}}`

Message types: `move`, `resign`, `draw_offer`, `draw_accepted`, `draw_declined`

### Game Lifecycle

1. Player joins queue via WebSocket (`Manager.JoinQueue`)
2. When two players are waiting, a `Room` is created with timers
3. Moves are validated by Stockfish before application
4. Game ends on checkmate, timeout, resignation, or draw agreement
5. Result is saved to DB and ELO ratings updated

### Dependencies

External requirements:
- PostgreSQL 16+ (schema in README.md)
- Stockfish chess engine (`stockfish` command in PATH)

Go dependencies (see go.mod):
- Chi v5 for HTTP routing
- Gorilla WebSocket
- golang-jwt/jwt v5
- Uber Zap for logging
- lib/pq for PostgreSQL driver
