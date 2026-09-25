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
- `internal/db/` - PostgreSQL connection and persistence: finished games + ELO (`games`), and **live-match persistence** (`live_matches`, `livematch.go`: `SaveLiveMatch`/`DeleteLiveMatch`/`LoadLiveMatches`, state stored as a JSONB blob)
- `internal/engine/stockfish.go` - Stockfish UCI interface, **FEN-based**: `IsMoveLegal(fen, move)`, `ApplyMove(fen, move) → newFEN`, `GetGameStatus(fen)`. The FEN is the source of truth (so board-editing spells are representable). `Room.Board.FEN` is updated after each move via `ApplyMove`; `Board.Moves` is kept only as history for PGN.
- `internal/game/` - Core game logic: WebSocket client, room management, matchmaking
- `internal/handlers/` - HTTP handlers for auth, stats, status, WebSocket upgrade
- `internal/middleware/` - JWT auth (`ParseAccessToken`: HS256 + `type == "access"`), one-time WebSocket tickets (`wsticket.go`, `WSAuth`), and per-IP rate limiting (`getIP` trusts `X-Forwarded-For` only from `TRUSTED_PROXIES`)
- `internal/gameerr/` - Game errors with a machine-readable `Code` + `Details`; sent to clients as `error {message, code, details?}`. `match` and `effects` return these; `Client.sendErr` serializes them
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

Clients connect to `/ws` via `WSAuth`: preferably with a one-time ticket (`GET /ws/ticket` → `/ws?ticket=…`, 30s TTL), otherwise with an access token in the `Authorization: Bearer <token>` header or `?token=<token>`. The server pings every ~54s and drops connections silent for 60s. A second connection of the same user replaces the first (close code 4001). Messages are JSON:

Client → Server: `{"type": "move", "payload": {"move": "e2e4"}}`
Server → Client: `{"type": "game_state", "payload": {...}}`

Client→server message types: `move`, `pass_phase`, `cast_spell`, `resign`, `draw_offer`, `draw_accepted`, `draw_declined`. Server→client magic events: `phase_changed`, `spell_cast`, `mana_changed`, `hand_size_changed`, `effect_expired` (broadcast), and `hand`/`card_drawn` (private to the owner — anti-cheat). `game_state` carries public match state (phase, turn, both players' mana / hand sizes / deck sizes, plus `active_effects` = persistent per-piece effects). See "Magic Chess" below.

The server-side message dispatch lives in `Room.HandleMessage` (`internal/game/room.go`); message type constants are in `internal/models/response.go`.

### Game Lifecycle

1. Player joins queue via WebSocket (`Manager.JoinQueue`)
2. When two players are waiting, a `Room` is created with timers
3. Moves are validated by Stockfish before application
4. Game ends on checkmate, stalemate, rule draw, agreement, resignation, timeout or abandonment. `Room.finishLocked` (under `r.mu`) marks the room `ended` exactly once and sets the terminal `Board.Status` (`checkmate`, `stalemate`, `draw`, `resigned`, `timeout`, `abandoned`); after unlocking, `announceEnd` broadcasts `game_over`. Any later action gets `error {code: "game_over"}`.
5. Result is saved to DB and ELO ratings updated (once); the `live_matches` row is removed and no later snapshot can re-create it (`writeSnapshot` is ordered by `persistSeq` and disabled by `removeLiveMatch`)

### "Magic Chess" Feature (in progress)

A turn-based magic layer (Magic: The Gathering / Hearthstone–style phases, mana, decks, and spells) is being built on top of standard chess. The full plan and step-by-step roadmap live in `update.md`. The guiding principle: **chess stays pure** — Stockfish only ever sees standard FEN, so the magic state lives in separate packages and never pollutes `internal/game`'s chess logic.

Packages:
- `internal/phase/` — `Phase` enum and the fixed turn sequence `draw → main1 → move → main2 → end_turn` (`Next` wraps `end_turn → draw`), plus `ActionKind` and `AllowedActions`/`IsAllowed`. `move` is mandatory (no pass); spells are castable only in `main1`/`main2`.
- `internal/spells/` — `Spell` (data-driven: `ManaCost`, `Phases`, `Targets []TargetSpec`, composable `Effect`s with `Params`, `Tags`, `Rarity`, `Limits`), the hardcoded catalog in `catalog.go` (grows per step of `docs/BRIEFING-MAGIE.md`; only spells whose effect kinds exist), `BuildDeck` (40-card recipe), and `PlayerState` (hand/deck/discard/mana/`CastsThisTurn`). A `TargetSpec` is one target (`square`/`own_piece`/`enemy_piece`) with filters (`Pieces`, `RequireEffect`, `EmptySquare`, `MaxDistance`, `OwnRanks`, `MinRank`); the target count is `len(Targets)`. Effect kinds: `destroy_piece`, `freeze_piece`, `shield_piece`, `draw_card`, `gain_mana`, `move_piece`, `summon_pawn`. Mana constants: `InitialMana=1`, `MaxManaCap=10`, `StartingHand=4`, `DeckSize=40`.
- `internal/effects/` — board-edit handlers on the FEN (`DestroyPiece`, `MovePieceFEN`, `PlacePiece`, `ForwardSquare`, `ClearStaleEnPassant`, `PieceAt`), target validation (`ValidateTargets`: checks every `TargetSpec`, targets distinct, king never a target; rejects with `invalid_target` + `details.reason`) **and** the `Tracker`: per-piece identity + persistent effects. `FreezePiece`/`ShieldPiece` attach an `ActiveEffect{Kind, RemainingTurns, Caster}`; `TickTurnEnd(finishing)` decrements the effects cast by the finishing player's opponent and returns the expired ones (durations count the caster's opponent's turns: `freeze 1` covers the victim's next turn, `shield 1` the opponent's next turn; 0 = until the end of the caster's turn, -1 = permanent). `Clone` lets a spell work on a copy. No Stockfish needed, fully unit-tested.
- `internal/match/` — `match.State` orchestrates phase/turn **and** the card game. `New(seed)` builds+shuffles both decks deterministically and deals opening hands. `Advance()` advances the FSM and returns an `AdvanceResult` (which carries a `Phase`/`ActivePlayer`/`TurnNumber` snapshot so a multi-step cascade can be broadcast accurately); reaching `end_turn` rolls over to the opponent's `draw` (swap `ActivePlayer`, `TurnNumber++`, refresh mana, draw a card) — callers never observe `end_turn`. `AutoAdvance()` keeps advancing while `shouldAutoAdvance()` holds (draw always auto-skips; a main phase auto-skips when `CanCastAny()` is false), stopping at `move` or a castable main phase. `CastSpell(player, id, targets, apply)` validates turn/phase/mana/hand/target-cardinality, then runs the `apply` callback (board effects, owned by `game.Room`) **before** spending mana — so a failed/invalid effect aborts the cast at zero cost.

**Status — Step 5 done (full base effect set: draw / mana / teleport):**
- `game.Room` holds a `*match.State` and an `*effects.Tracker` (both built in `NewRoom`). `HandleMessage` dispatches `pass_phase` and `cast_spell`; `handleMove` gates on the `move` phase. After a move/pass/cast the Room runs `match.AutoAdvance()`, broadcasts each step, and on a turn rollover ticks the finishing player's effects (`effect_expired` broadcast). `Room.applySpellEffects` is the `ApplyEffects` callback: it dispatches each `spells.Effect` — `destroy_piece` edits `Board.FEN` (and removes the piece from the `Tracker`), `freeze_piece`/`shield_piece` attach a persistent effect via the `Tracker`.
- Spells: the catalog of `docs/BRIEFING-MAGIE.md`, step 1 (9 spells: Brina, Catena di ghiaccio, Frantumare, Patto di sangue, Blink, Scudo, Scudo reale, Marcia forzata, Leva militare). `applySpellEffects` validates the targets, applies the effects in order on a copy of the FEN and of the `Tracker`, then checks the final position and only then commits (draw and mana run last): a rejected cast leaves no trace and costs nothing. Global rule: no spell gives check or leaves the caster's king in check, in main1 and main2 (`validateNoCheck`, pure `effects.IsKingAttacked`); a check already given by the turn's move is allowed. `move_piece` uses `Tracker.Relocate` (no castling/en-passant semantics) and supports `relative: "forward"` with one target. Per-turn limits (`Limits.per_turn`) reject with `limit_reached`. `draw_card` sends `card_drawn` privately to the caster; `gain_mana` bumps current mana (temporary, capped at 10). A spell never changes the FEN side-to-move, so the next move is still validated on the updated FEN. Destroying/teleporting a rook or king clears the matching castling rights.
- Persistent effects (Tracker, parallel to the FEN since FEN has no piece identity): a **frozen** piece can't move (move rejected); **shield** absorbs one capture — the shielded piece survives but the attacker's move is still spent: `handleMove` applies `effects.PassTurn` (a null move: flip the FEN side-to-move, no piece moves), consumes the shield, and lets the turn advance (`effect_expired` with `reason: "shield_absorbed"`). The Tracker follows pieces by `PieceID` across captures/castling/en-passant/promotion, so effects stick to the piece, not the square. Decisions: shield protects against chess captures only (not magic `destroy_piece`), including en passant; if the null move would leave the attacker in check (the capture was the only way out), the shield breaks and the capture happens. An absorbed move is recorded as `0000` in `Board.Moves` (`--` in the PGN).
- Mana: starts at 1, +1 per the player's own turn (white turns 1/3/5 → 1/2/3), capped at 10, refilled at turn start. Opening hand = 4; active player draws 1 at turn start (white skips the turn-1 draw — Hearthstone style).
- **Anti-cheat**: a player only ever receives their own hand (`hand`/`card_drawn`); opponents see only sizes/mana.
- Determinism: each match stores a `seed`; same seed ⇒ same shuffle and draw order.
- Reconnection re-sends the player's private hand + public state. **Live matches are persisted to Postgres** (`live_matches`): the full `Room` state (board FEN, moves, phase/turn, both players' mana/hand/deck/discard, active per-piece effects, `posCounts`) is serialized as a `roomSnapshot` JSON blob and saved (async) after every action and (sync) on graceful shutdown. On startup `Manager.LoadPersisted` rebuilds dormant rooms (placeholder clients, timer stopped); the first reconnect attaches the real client and starts the clock (`ensureTimer`) — the clock only runs while the timer is active, so downtime isn't charged. `endGame` deletes the row. All DB calls are nil-safe (no-op without a DB, e.g. in tests).
- Draws: `engine.GetGameStatus` uses perft for checkmate/stalemate and `isInCheck` reads Stockfish's `Checkers:` line; `isDrawByRule` covers fifty-move + insufficient material (pure, no engine eval — the old `score cp 0` heuristic caused false draws). Threefold repetition is tracked in `Room.posCounts` (normalized FEN, counted after each board change).
- Testing/logging (Step 6): `internal/match/integration_test.go` simulates a full magic game (mana growth, gain_mana combo, draw, freeze expiry, shield, deck depletion) with no Stockfish needed; `internal/game/reconnect_test.go` asserts reconnection re-sends the private hand + public state (incl. `active_effects`). Each cast, applied effect, and effect expiry is logged with structured zap fields. The WebSocket protocol is documented in `PROTOCOL.md`.
- Clocks: `runTimer` is the single authority and charges `match.ActivePlayer` in real time for their whole turn (all phases); a move only adds the increment. `timer_update.turn` is the active player, not the chess side-to-move. Game end uses `GetGameStatusFiltered` with `Room.isPlayable`: moves of frozen pieces don't count, and with no playable move it's checkmate (in check) or stalemate. It runs after every move, at every turn rollover (`checkRolloverGameEnd`) and after a board-changing spell in main1 (`checkActivePlayerEnd`).
- Known limitations: the PGN uses UCI moves and doesn't record spells; until the catalog is complete the 40-card recipe exceeds the rarity copy limits.
- Client-facing changes (backend-requests round, Sept 2026) are listed in `docs/SERVER-CHANGES.md`; the client's request registry is `docs/BACKEND-REQUESTS.md`.

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
