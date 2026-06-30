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
- `internal/engine/stockfish.go` - Stockfish UCI interface, **FEN-based**: `IsMoveLegal(fen, move)`, `ApplyMove(fen, move) → newFEN`, `GetGameStatus(fen)`. The FEN is the source of truth (so board-editing spells are representable). `Room.Board.FEN` is updated after each move via `ApplyMove`; `Board.Moves` is kept only as history for PGN.
- `internal/game/` - Core game logic: WebSocket client, room management, matchmaking
- `internal/handlers/` - HTTP handlers for auth, stats, status, WebSocket upgrade
- `internal/middleware/` - JWT auth and per-IP rate limiting
- `internal/logger/` - Zap logger initialization
- `internal/models/` - Shared data structures
- `internal/validation/` - Input validation for registration (username/email/password rules)
- `internal/phase/` - Pure turn-phase definitions: the phase enum, ordering, and per-phase legal actions (see "Magic Chess" below)
- `internal/spells/` - Data-driven spell catalog, deck/hand model, and mana constants
- `internal/match/` - Phase/turn + card-game orchestration (FSM, mana, decks, casting); knows nothing about the board/FEN/Stockfish

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

Client→server message types: `move`, `pass_phase`, `cast_spell`, `resign`, `draw_offer`, `draw_accepted`, `draw_declined`. Server→client magic events: `phase_changed`, `spell_cast`, `mana_changed`, `hand_size_changed` (broadcast), and `hand`/`card_drawn` (private to the owner — anti-cheat). `game_state` carries public match state (phase, turn, both players' mana / hand sizes / deck sizes). See "Magic Chess" below.

The server-side message dispatch lives in `Room.HandleMessage` (`internal/game/room.go`); message type constants are in `internal/models/response.go`.

### Game Lifecycle

1. Player joins queue via WebSocket (`Manager.JoinQueue`)
2. When two players are waiting, a `Room` is created with timers
3. Moves are validated by Stockfish before application
4. Game ends on checkmate, timeout, resignation, or draw agreement
5. Result is saved to DB and ELO ratings updated

### "Magic Chess" Feature (in progress)

A turn-based magic layer (Magic: The Gathering / Hearthstone–style phases, mana, decks, and spells) is being built on top of standard chess. The full plan and step-by-step roadmap live in `update.md`. The guiding principle: **chess stays pure** — Stockfish only ever sees standard FEN, so the magic state lives in separate packages and never pollutes `internal/game`'s chess logic.

Packages:
- `internal/phase/` — `Phase` enum and the fixed turn sequence `draw → main1 → move → main2 → end_turn` (`Next` wraps `end_turn → draw`), plus `ActionKind` and `AllowedActions`/`IsAllowed`. `move` is mandatory (no pass); spells are castable only in `main1`/`main2`.
- `internal/spells/` — `Spell` (data-driven: `ManaCost`, `Phases`, `TargetType`, composable `Effect`s), the hardcoded `Catalog` (Step 2: 6 placeholders, cost 1–5, `noop` effect), `BuildDeck` (40-card recipe), and `PlayerState` (hand/deck/discard/mana). Mana constants: `InitialMana=1`, `MaxManaCap=10`, `StartingHand=4`, `DeckSize=40`.
- `internal/match/` — `match.State` orchestrates phase/turn **and** the card game. `New(seed)` builds+shuffles both decks deterministically and deals opening hands. `Advance()` advances the FSM and returns an `AdvanceResult`; reaching `end_turn` rolls over to the opponent's `draw` (swap `ActivePlayer`, `TurnNumber++`, refresh mana, draw a card) — callers never observe `end_turn`. `CastSpell(player, id, targets)` validates turn/phase/mana/hand/targets, spends mana, and discards the card.

**Status — Step 2 done (mana, decks, hands; spell effects are still `noop`):**
- `game.Room` holds a `*match.State` (seeded from `time.Now().UnixNano()` in `NewRoom`). `HandleMessage` dispatches `pass_phase` and `cast_spell`; `handleMove` gates on the `move` phase and advances to `main2`.
- Mana: starts at 1, +1 per the player's own turn (white turns 1/3/5 → 1/2/3), capped at 10, refilled at the start of each turn. Opening hand = 4 each; the active player draws 1 at the start of their turn (the starting player, white, skips the turn-1 draw — Hearthstone style).
- **Anti-cheat**: a player only ever receives their own hand (`hand`/`card_drawn`); opponents see only sizes/mana via `game_state` and `hand_size_changed`.
- Determinism: each match stores a `seed`; same seed ⇒ same shuffle and draw order (covered by tests).
- Reconnection re-sends the reconnecting player's private hand + public state from the in-memory `Room`. **Still no DB persistence of live matches** — a server restart loses active games. A match-persistence layer (and the DB schema for mana/deck/hand/effects) is deferred to a dedicated step.
- Known limitation: clocks follow `Board.Turn` (chess side-to-move), not `match.ActivePlayer`; revisit when spells give the main phases real duration.
- Not yet implemented (later steps in `update.md`): real spell effects (`destroy_piece`, `freeze_piece`, …) in `internal/effects`, per-piece persistent effects with `PieceID` tracking, targeting that touches the board, and DB persistence.

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
