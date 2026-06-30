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
- `internal/validation/` - Input validation for registration (username/email/password rules)
- `internal/phase/` - Pure turn-phase definitions: the phase enum, ordering, and per-phase legal actions (see "Magic Chess" below)
- `internal/match/` - Phase/turn orchestration (FSM) layered on top of pure chess; knows nothing about the board/FEN/Stockfish

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

Clients connect to `/ws` with a JWT. The `Auth` middleware (`internal/middleware/auth.go`) accepts the token either in the `Authorization: Bearer <token>` header or, as a fallback for browser WebSocket connections (which cannot set custom headers), as a `?token=<token>` query parameter. Messages are JSON:

Client → Server: `{"type": "move", "payload": {"move": "e2e4"}}`
Server → Client: `{"type": "game_state", "payload": {...}}`

Message types: `move`, `pass_phase`, `resign`, `draw_offer`, `draw_accepted`, `draw_declined`. The server emits `phase_changed` (and includes `phase`/`active_player`/`turn_number` in `game_state`) — see "Magic Chess" below.

The server-side message dispatch lives in `Room.HandleMessage` (`internal/game/room.go`); message type constants are in `internal/models/response.go`.

### Game Lifecycle

1. Player joins queue via WebSocket (`Manager.JoinQueue`)
2. When two players are waiting, a `Room` is created with timers
3. Moves are validated by Stockfish before application
4. Game ends on checkmate, timeout, resignation, or draw agreement
5. Result is saved to DB and ELO ratings updated

### "Magic Chess" Feature (in progress)

A turn-based magic layer (Magic: The Gathering / Hearthstone–style phases, mana, decks, and spells) is being built on top of standard chess. The full plan and step-by-step roadmap live in `update.md`. The guiding principle: **chess stays pure** — Stockfish only ever sees standard FEN, so the magic state lives in separate packages and never pollutes `internal/game`'s chess logic.

Two foundation packages:
- `internal/phase/` — `Phase` enum and the fixed turn sequence `draw → main1 → move → main2 → end_turn` (`Next` wraps `end_turn → draw`), plus `ActionKind` and `AllowedActions`/`IsAllowed`. `move` is mandatory (no pass); spells are castable only in `main1`/`main2`.
- `internal/match/` — `match.State` (`CurrentPhase`, `TurnNumber`, `ActivePlayer`) with `Advance(hooks)`. `Advance` treats `end_turn` as a server-side transition: reaching it fires `OnEndTurn`, then immediately rolls over to the opponent's `draw` (swapping `ActivePlayer`, incrementing `TurnNumber`, firing `OnDraw`) — callers never observe the match resting in `end_turn`. `Hooks` (`OnDraw`/`OnEndTurn`) are the seams for later steps (card draw, effect ticks); in Step 1 they are logging placeholders.

**Status — Step 1 done (phase FSM, no real magic yet):**
- `game.Room` holds a `*match.State` (created in `NewRoom`). `HandleMessage` dispatches `pass_phase`; `handleMove` rejects moves outside the `move` phase and calls `Advance` (→ `main2`) after a legal move; the server broadcasts `phase_changed` and includes phase/turn in `game_state`.
- Reconnection restores phase/turn from the in-memory `Room` (preserved while the server is up). **There is no DB persistence of live matches** — a server restart still loses active games (`Manager.Shutdown` ends them as a draw). A match-persistence layer is deferred to a dedicated step.
- Known limitation: clocks still follow `Board.Turn` (chess side-to-move), which flips at the move, not `match.ActivePlayer`. Harmless in Step 1 (players pass the main phases instantly); revisit when spells give the main phases real duration.
- Not yet implemented (later steps in `update.md`): mana, decks/hands, `cast_spell`, spell effects (`internal/spells`, `internal/effects`), per-piece persistent effects, deterministic seeding, and the related DB schema.

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
