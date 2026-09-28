package match

import (
	"testing"

	"chess-server/internal/spells"
)

// Ogni giocatore gioca col suo mazzo (D6); nil = la ricetta condivisa.
func TestNewWithDecks(t *testing.T) {
	white := make([]string, spells.DeckSize)
	for i := range white {
		white[i] = "frost"
	}
	s := NewWithDecks(7, white, nil)
	for _, id := range append(append([]string{}, s.White.Hand...), s.White.Deck...) {
		if id != "frost" {
			t.Fatalf("carta del Bianco fuori dal suo mazzo: %s", id)
		}
	}
	if n := len(s.White.Hand) + len(s.White.Deck); n != spells.DeckSize {
		t.Errorf("Bianco: %d carte", n)
	}
	if n := len(s.Black.Hand) + len(s.Black.Deck); n != spells.DeckSize {
		t.Errorf("Nero: %d carte", n)
	}
	other := false
	for _, id := range s.Black.Deck {
		if id != "frost" {
			other = true
		}
	}
	if !other {
		t.Error("il Nero deve avere la ricetta condivisa")
	}
}
