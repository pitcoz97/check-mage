package game

import (
	"chess-server/internal/gameerr"
	"testing"
)

// D6: con il mazzo attivo non valido non si entra in coda.
func TestJoinQueue_DeckInvalid(t *testing.T) {
	resetManager()
	client := newTestClient(9, "dora")
	client.DeckInvalid = true
	if GameManager.JoinQueue(client) {
		t.Fatal("non è una riconnessione")
	}
	if GameManager.waiting != nil {
		t.Error("un mazzo non valido non deve entrare in coda")
	}
	if code := lastErrorCode(t, drain(client)); code != string(gameerr.DeckInvalid) {
		t.Errorf("code = %s, atteso deck_invalid", code)
	}
}
