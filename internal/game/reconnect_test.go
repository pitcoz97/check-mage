package game

import (
	"encoding/json"
	"testing"
	"time"

	"chess-server/internal/effects"
	"chess-server/internal/match"
	"chess-server/internal/models"
)

// drain raccoglie i messaggi già presenti nel canale Send di un client mock.
func drain(c *Client) []models.WSMessage {
	var out []models.WSMessage
	for {
		select {
		case b := <-c.Send:
			var m models.WSMessage
			if err := json.Unmarshal(b, &m); err == nil {
				out = append(out, m)
			}
		default:
			return out
		}
	}
}

// TestReconnect_RestoresMagicState verifica che un giocatore che si riconnette
// riceva lo stato pubblico (con gli effetti attivi) e la propria mano privata.
func TestReconnect_RestoresMagicState(t *testing.T) {
	const startFEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
	room := &Room{
		ID:                "room-1-2",
		Board:             &Board{FEN: startFEN, Turn: "white", Status: "active", Moves: []string{}},
		Match:             match.New(0),
		Tracker:           effects.NewTracker(startFEN),
		White:             createMockClient(1, "white"),
		Black:             createMockClient(2, "black"),
		disconnectedTimer: map[int]*time.Timer{},
		posCounts:         map[string]int{},
	}
	// Un effetto attivo su un pezzo bianco.
	if err := effects.FreezePiece(room.Tracker, "e7", effects.White, 2, "frostbolt"); err != nil {
		t.Fatalf("setup freeze fallito: %v", err)
	}

	// Il Bianco si riconnette con una nuova connessione.
	newClient := createMockClient(1, "white")
	room.Reconnect(newClient)

	msgs := drain(newClient)
	var gotState, gotHand bool
	var statePayload map[string]json.RawMessage
	for _, m := range msgs {
		switch m.Type {
		case models.MsgGameState:
			gotState = true
			_ = json.Unmarshal(m.Payload, &statePayload)
		case models.MsgHand:
			gotHand = true
		}
	}

	if !gotState {
		t.Error("il giocatore riconnesso dovrebbe ricevere game_state")
	}
	if !gotHand {
		t.Error("il giocatore riconnesso dovrebbe ricevere la propria mano (hand)")
	}
	if _, ok := statePayload["active_effects"]; !ok {
		t.Error("game_state dovrebbe includere active_effects")
	}
	if _, ok := statePayload["reconnected"]; !ok {
		t.Error("game_state di riconnessione dovrebbe avere reconnected=true")
	}
}
