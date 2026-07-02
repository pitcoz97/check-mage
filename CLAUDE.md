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
- `internal/spells/` - Data-driven spell catalog, deck/hand model, mana constants, and effect-kind constants
- `internal/effects/` - Spell effect handlers + the persistent per-piece effect layer. FEN-only board edits (`DestroyPiece`, `PieceAt`) plus a `Tracker` (assigns a `PieceID` to every piece from the FEN, follows pieces across moves/captures/castling/en-passant/promotion) that holds persistent effects (`freeze`, `shield`). No Stockfish dependency, fully unit-tested.
- `internal/match/` - Phase/turn + card-game orchestration (FSM, mana, decks, casting); knows nothing about the board/FEN/Stockfish (board effects are delegated via an `ApplyEffects` callback)

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

Client→server message types: `move`, `pass_phase`, `cast_spell`, `resign`, `draw_offer`, `draw_accepted`, `draw_declined`. Server→client magic events: `phase_changed`, `spell_cast`, `mana_changed`, `hand_size_changed`, `effect_expired` (broadcast), and `hand`/`card_drawn` (private to the owner — anti-cheat). `game_state` carries public match state (phase, turn, both players' mana / hand sizes / deck sizes, plus `active_effects` = persistent per-piece effects). See "Magic Chess" below.

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
- `internal/spells/` — `Spell` (data-driven: `ManaCost`, `Phases`, `TargetType`, composable `Effect`s with `Params`), the hardcoded `Catalog`, `BuildDeck` (40-card recipe), and `PlayerState` (hand/deck/discard/mana). Effect kinds: `noop`, `destroy_piece`, `freeze_piece`, `shield_piece`. Mana constants: `InitialMana=1`, `MaxManaCap=10`, `StartingHand=4`, `DeckSize=40`.
- `internal/effects/` — board-edit handlers on the FEN (`DestroyPiece`, `PieceAt`) **and** the `Tracker`: per-piece identity + persistent effects. `FreezePiece`/`ShieldPiece` validate enemy/own target and attach an `ActiveEffect{Kind, RemainingTurns}`; `TickColor(color)` decrements the finishing player's effects and returns the expired ones (so `freeze 2` lasts 2 of the victim's turns). No Stockfish needed, fully unit-tested.
- `internal/match/` — `match.State` orchestrates phase/turn **and** the card game. `New(seed)` builds+shuffles both decks deterministically and deals opening hands. `Advance()` advances the FSM and returns an `AdvanceResult` (which carries a `Phase`/`ActivePlayer`/`TurnNumber` snapshot so a multi-step cascade can be broadcast accurately); reaching `end_turn` rolls over to the opponent's `draw` (swap `ActivePlayer`, `TurnNumber++`, refresh mana, draw a card) — callers never observe `end_turn`. `AutoAdvance()` keeps advancing while `shouldAutoAdvance()` holds (draw always auto-skips; a main phase auto-skips when `CanCastAny()` is false), stopping at `move` or a castable main phase. `CastSpell(player, id, targets, apply)` validates turn/phase/mana/hand/target-cardinality, then runs the `apply` callback (board effects, owned by `game.Room`) **before** spending mana — so a failed/invalid effect aborts the cast at zero cost.

**Status — Step 4 done (persistent per-piece effects: `freeze`, `shield`):**
- `game.Room` holds a `*match.State` and an `*effects.Tracker` (both built in `NewRoom`). `HandleMessage` dispatches `pass_phase` and `cast_spell`; `handleMove` gates on the `move` phase. After a move/pass/cast the Room runs `match.AutoAdvance()`, broadcasts each step, and on a turn rollover ticks the finishing player's effects (`effect_expired` broadcast). `Room.applySpellEffects` is the `ApplyEffects` callback: it dispatches each `spells.Effect` — `destroy_piece` edits `Board.FEN` (and removes the piece from the `Tracker`), `freeze_piece`/`shield_piece` attach a persistent effect via the `Tracker`.
- Spells: `noop` placeholders + **Disintegrate** (4, `destroy_piece`), **Frost Bolt** (2, `freeze_piece` 2 turns), **Aegis** (3, `shield_piece` 2 turns). `spell_cast.effects_applied` carries `{kind, target, piece_destroyed|remaining_turns}`. A spell never changes the FEN side-to-move, so the next move is still validated on the updated FEN. Destroying a rook on its home square clears the matching castling right.
- Persistent effects (Tracker, parallel to the FEN since FEN has no piece identity): a **frozen** piece can't move (move rejected); **shield** absorbs one capture — the shielded piece survives but the attacker's move is still spent: `handleMove` applies `effects.PassTurn` (a null move: flip the FEN side-to-move, no piece moves), consumes the shield, and lets the turn advance (`effect_expired` with `reason: "shield_absorbed"`). The Tracker follows pieces by `PieceID` across captures/castling/en-passant/promotion, so effects stick to the piece, not the square. Decisions: shield protects against chess captures only (not magic `destroy_piece`); en-passant capture of a shielded pawn isn't blocked (edge case).
- Mana: starts at 1, +1 per the player's own turn (white turns 1/3/5 → 1/2/3), capped at 10, refilled at turn start. Opening hand = 4; active player draws 1 at turn start (white skips the turn-1 draw — Hearthstone style).
- **Anti-cheat**: a player only ever receives their own hand (`hand`/`card_drawn`); opponents see only sizes/mana.
- Determinism: each match stores a `seed`; same seed ⇒ same shuffle and draw order.
- Reconnection re-sends the player's private hand + public state from the in-memory `Room`. **Still no DB persistence of live matches** — a restart loses active games; deferred to a dedicated step.
- Draws: `engine.GetGameStatus` uses perft for checkmate/stalemate and `isInCheck` reads Stockfish's `Checkers:` line; `isDrawByRule` covers fifty-move + insufficient material (pure, no engine eval — the old `score cp 0` heuristic caused false draws). Threefold repetition is tracked in `Room.posCounts` (normalized FEN, counted after each board change).
- Known limitation: clocks follow `Board.Turn` (chess side-to-move), not `match.ActivePlayer`.
- Not yet implemented (later steps in `update.md`): Step 5 effects `draw_card`/`gain_mana`/`move_piece`, the full ~15–20 card MVP deck, and DB persistence of live matches.

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
