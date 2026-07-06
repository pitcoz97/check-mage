package game

import (
	"encoding/json"
	"testing"
	"time"

	"chess-server/internal/effects"
	"chess-server/internal/match"
)

// TestRoomSnapshot_RoundTrip verifica che lo stato completo di una partita
// sopravviva a serializzazione + ricostruzione (persistenza DB).
func TestRoomSnapshot_RoundTrip(t *testing.T) {
	const fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"

	orig := &Room{
		ID:                "room-1-2",
		White:             placeholderClient(1, "alice"),
		Black:             placeholderClient(2, "bob"),
		Board:             &Board{FEN: fen, Moves: []string{"e2e4"}, Turn: "black", Status: "active"},
		Match:             match.New(99),
		WhiteTime:         3 * time.Minute,
		BlackTime:         4 * time.Minute,
		Increment:         5 * time.Second,
		posCounts:         map[string]int{"foo": 2},
		disconnectedTimer: map[int]*time.Timer{},
	}
	orig.Tracker = effects.NewTracker(fen)
	// Stato di gioco non banale.
	orig.Match.CurrentPhase = "main2"
	orig.Match.TurnNumber = 3
	orig.Match.ActivePlayer = match.PlayerBlack
	orig.Match.White.Mana = 2
	orig.Match.White.Hand = []string{"spark", "nova"}
	// Un effetto persistente su un pezzo nero.
	if err := effects.FreezePiece(orig.Tracker, "e7", effects.White, 2, "frostbolt"); err != nil {
		t.Fatalf("setup freeze fallito: %v", err)
	}

	// Snapshot → JSON → snapshot → room.
	data, err := json.Marshal(orig.buildSnapshot())
	if err != nil {
		t.Fatalf("marshal fallito: %v", err)
	}
	var snap roomSnapshot
	if err := json.Unmarshal(data, &snap); err != nil {
		t.Fatalf("unmarshal fallito: %v", err)
	}
	got := roomFromSnapshot(snap)

	// Identità e board.
	if got.ID != "room-1-2" || got.White.UserID != 1 || got.Black.UserID != 2 {
		t.Errorf("identità non preservata: %s %d %d", got.ID, got.White.UserID, got.Black.UserID)
	}
	if got.White.Username != "alice" || got.Black.Username != "bob" {
		t.Error("username non preservati")
	}
	if got.Board.FEN != fen || got.Board.Turn != "black" {
		t.Errorf("board non preservata: %s %s", got.Board.FEN, got.Board.Turn)
	}

	// Tempi.
	if got.WhiteTime != 3*time.Minute || got.BlackTime != 4*time.Minute || got.Increment != 5*time.Second {
		t.Errorf("tempi non preservati: %v %v %v", got.WhiteTime, got.BlackTime, got.Increment)
	}

	// Stato del match.
	if got.Match.CurrentPhase != "main2" || got.Match.TurnNumber != 3 || got.Match.ActivePlayer != match.PlayerBlack {
		t.Errorf("fase/turno non preservati: %s %d %s", got.Match.CurrentPhase, got.Match.TurnNumber, got.Match.ActivePlayer)
	}
	if got.Match.Seed != 99 {
		t.Errorf("seed = %d, atteso 99", got.Match.Seed)
	}
	if got.Match.White.Mana != 2 || len(got.Match.White.Hand) != 2 {
		t.Errorf("stato carte bianco non preservato: mana %d, mano %d", got.Match.White.Mana, len(got.Match.White.Hand))
	}

	// posCounts (tripla ripetizione).
	if got.posCounts["foo"] != 2 {
		t.Errorf("posCounts non preservato: %v", got.posCounts)
	}

	// Effetto persistente ricostruito.
	if !got.Tracker.IsFrozen("e7") {
		t.Error("l'effetto freeze su e7 dovrebbe essere ripristinato")
	}
}
