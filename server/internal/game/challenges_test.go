package game

import (
	"chess-server/internal/config"
	"chess-server/internal/gameerr"
	"chess-server/internal/models"
	"encoding/json"
	"testing"
	"time"
)

var (
	alice = ChallengePlayer{ID: 1, Username: "alice", Elo: 1200}
	bob   = ChallengePlayer{ID: 2, Username: "bob", Elo: 1300}
	carol = ChallengePlayer{ID: 3, Username: "carol", Elo: 1100}
)

func challengeSetup(t *testing.T) {
	t.Helper()
	resetManager()
	config.C = &config.Config{PhaseTimeMain: 90 * time.Second, PhaseTimeMove: 120 * time.Second, ReconnectTimeout: time.Minute}
	prev := ChallengeTTL
	t.Cleanup(func() { ChallengeTTL = prev })
}

func mustChallenge(t *testing.T, from, to ChallengePlayer) ChallengeView {
	t.Helper()
	view, err := GameManager.CreateChallenge(from, to)
	if err != nil {
		t.Fatalf("CreateChallenge: %v", err)
	}
	return view
}

// gameStateOf restituisce il primo game_state ricevuto dal client.
func gameStateOf(t *testing.T, msgs []models.WSMessage) map[string]json.RawMessage {
	t.Helper()
	for _, m := range msgs {
		if m.Type == models.MsgGameState {
			var state map[string]json.RawMessage
			if err := json.Unmarshal(m.Payload, &state); err != nil {
				t.Fatalf("game_state non valido: %v", err)
			}
			return state
		}
	}
	t.Fatal("nessun game_state ricevuto")
	return nil
}

func checkFriendlyRoom(t *testing.T, a, b *Client) {
	t.Helper()
	if a.Room == nil || a.Room != b.Room {
		t.Fatal("i due giocatori devono essere nella stessa room")
	}
	if !a.Room.Friendly {
		t.Error("una partita da sfida è amichevole")
	}
	if GameManager.userRooms[a.UserID] != a.Room.ID || GameManager.userRooms[b.UserID] != a.Room.ID {
		t.Error("la room va registrata per i due giocatori")
	}
	for _, c := range []*Client{a, b} {
		if string(gameStateOf(t, drain(c))["friendly"]) != "true" {
			t.Errorf("game_state di %s senza friendly", c.Username)
		}
	}
	if len(GameManager.challenges) != 0 {
		t.Error("la sfida partita va tolta")
	}
}

func TestChallenge_PairChallengerFirst(t *testing.T) {
	challengeSetup(t)
	ch := mustChallenge(t, alice, bob)
	if got := GameManager.IncomingChallenges(bob.ID); len(got) != 1 || got[0].ID != ch.ID {
		t.Fatalf("sfide ricevute = %+v", got)
	}

	ca, cb := newTestClient(alice.ID, alice.Username), newTestClient(bob.ID, bob.Username)
	if GameManager.JoinChallenge(ca, ch.ID) {
		t.Fatal("non è una riconnessione")
	}
	if ca.Room != nil {
		t.Fatal("da solo si aspetta")
	}
	GameManager.JoinChallenge(cb, ch.ID)
	checkFriendlyRoom(t, ca, cb)
}

func TestChallenge_PairTargetFirst(t *testing.T) {
	challengeSetup(t)
	ch := mustChallenge(t, alice, bob)
	ca, cb := newTestClient(alice.ID, alice.Username), newTestClient(bob.ID, bob.Username)
	GameManager.JoinChallenge(cb, ch.ID)
	GameManager.JoinChallenge(ca, ch.ID)
	checkFriendlyRoom(t, ca, cb)

	// Ricollegarsi con la sfida ormai partita riporta nella partita.
	again := newTestClient(alice.ID, alice.Username)
	if !GameManager.JoinChallenge(again, ch.ID) {
		t.Error("con una partita in corso è una riconnessione")
	}
}

func TestChallenge_DeclineNotifiesWaiting(t *testing.T) {
	challengeSetup(t)
	ch := mustChallenge(t, alice, bob)
	ca := newTestClient(alice.ID, alice.Username)
	GameManager.JoinChallenge(ca, ch.ID)

	if err := GameManager.CancelChallenge(carol.ID, ch.ID); err != ErrChallengeNotFound {
		t.Errorf("un estraneo non chiude la sfida: %v", err)
	}
	if err := GameManager.CancelChallenge(bob.ID, ch.ID); err != nil {
		t.Fatalf("rifiuto: %v", err)
	}
	if code := lastErrorCode(t, drain(ca)); code != string(gameerr.ChallengeDeclined) {
		t.Errorf("code = %s, atteso challenge_declined", code)
	}
	if got := GameManager.IncomingChallenges(bob.ID); len(got) != 0 {
		t.Errorf("sfida rifiutata ancora aperta: %+v", got)
	}
}

func TestChallenge_Expires(t *testing.T) {
	challengeSetup(t)
	ChallengeTTL = 20 * time.Millisecond
	ch := mustChallenge(t, alice, bob)
	ca := newTestClient(alice.ID, alice.Username)
	GameManager.JoinChallenge(ca, ch.ID)

	time.Sleep(80 * time.Millisecond)
	GameManager.mu.Lock()
	open := len(GameManager.challenges)
	GameManager.mu.Unlock()
	if open != 0 {
		t.Fatal("la sfida scaduta va tolta")
	}
	if code := lastErrorCode(t, drain(ca)); code != string(gameerr.ChallengeExpired) {
		t.Errorf("code = %s, atteso challenge_expired", code)
	}
}

func TestChallenge_ChallengerLeaves(t *testing.T) {
	challengeSetup(t)
	ch := mustChallenge(t, alice, bob)
	ca := newTestClient(alice.ID, alice.Username)
	GameManager.JoinChallenge(ca, ch.ID)
	GameManager.LeaveChallenge(ca)

	if got := GameManager.IncomingChallenges(bob.ID); len(got) != 0 {
		t.Fatalf("chi sfida se ne va: la sfida è annullata, invece %+v", got)
	}
	cb := newTestClient(bob.ID, bob.Username)
	GameManager.JoinChallenge(cb, ch.ID)
	if code := lastErrorCode(t, drain(cb)); code != string(gameerr.ChallengeUnavailable) {
		t.Errorf("code = %s, atteso challenge_unavailable", code)
	}
}

func TestChallenge_TargetLeavesKeepsChallenge(t *testing.T) {
	challengeSetup(t)
	ch := mustChallenge(t, alice, bob)
	cb := newTestClient(bob.ID, bob.Username)
	GameManager.JoinChallenge(cb, ch.ID)
	GameManager.LeaveChallenge(cb)
	if got := GameManager.IncomingChallenges(bob.ID); len(got) != 1 {
		t.Fatalf("se lo sfidato se ne va la sfida resta: %+v", got)
	}
}

func TestChallenge_UnknownOrStranger(t *testing.T) {
	challengeSetup(t)
	ch := mustChallenge(t, alice, bob)
	for _, tc := range []struct {
		client *Client
		id     string
	}{
		{newTestClient(alice.ID, alice.Username), "nessuna"},
		{newTestClient(carol.ID, carol.Username), ch.ID},
	} {
		GameManager.JoinChallenge(tc.client, tc.id)
		if code := lastErrorCode(t, drain(tc.client)); code != string(gameerr.ChallengeUnavailable) {
			t.Errorf("code = %s, atteso challenge_unavailable", code)
		}
	}
	if GameManager.challenges[ch.ID].slot != nil {
		t.Error("nessuno dei due entra nello slot")
	}
}

func TestChallenge_DeckInvalid(t *testing.T) {
	challengeSetup(t)
	ch := mustChallenge(t, alice, bob)
	cb := newTestClient(bob.ID, bob.Username)
	cb.DeckInvalid = true
	GameManager.JoinChallenge(cb, ch.ID)
	if code := lastErrorCode(t, drain(cb)); code != string(gameerr.DeckInvalid) {
		t.Errorf("code = %s, atteso deck_invalid", code)
	}
	if GameManager.challenges[ch.ID].slot != nil {
		t.Error("con un mazzo non valido non si aspetta")
	}
}

func TestChallenge_ReplaceAndSameUserConnection(t *testing.T) {
	challengeSetup(t)
	first := mustChallenge(t, alice, bob)
	ca := newTestClient(alice.ID, alice.Username)
	GameManager.JoinChallenge(ca, first.ID)

	// Una nuova sfida di alice chiude la precedente.
	second := mustChallenge(t, alice, carol)
	if code := lastErrorCode(t, drain(ca)); code != string(gameerr.ChallengeUnavailable) {
		t.Errorf("code = %s, atteso challenge_unavailable", code)
	}
	if got := GameManager.IncomingChallenges(bob.ID); len(got) != 0 {
		t.Errorf("la prima sfida va chiusa: %+v", got)
	}

	// Una seconda connessione di alice prende il posto della prima (4001).
	ca1, ca2 := newTestClient(alice.ID, alice.Username), newTestClient(alice.ID, alice.Username)
	GameManager.JoinChallenge(ca1, second.ID)
	GameManager.JoinChallenge(ca2, second.ID)
	if code := lastErrorCode(t, drain(ca1)); code != string(gameerr.ReplacedByNewConnection) {
		t.Errorf("code = %s, atteso replaced_by_new_connection", code)
	}
	if GameManager.challenges[second.ID].slot != ca2 {
		t.Error("nello slot c'è la connessione nuova")
	}
}

func TestChallenge_BusyAndOthersClosed(t *testing.T) {
	challengeSetup(t)
	// carol sfida bob e aspetta; intanto alice e bob partono con un'altra sfida.
	pending := mustChallenge(t, carol, bob)
	cc := newTestClient(carol.ID, carol.Username)
	GameManager.JoinChallenge(cc, pending.ID)

	ch := mustChallenge(t, alice, bob)
	ca, cb := newTestClient(alice.ID, alice.Username), newTestClient(bob.ID, bob.Username)
	GameManager.JoinChallenge(ca, ch.ID)
	GameManager.JoinChallenge(cb, ch.ID)

	if code := lastErrorCode(t, drain(cc)); code != string(gameerr.ChallengeUnavailable) {
		t.Errorf("code = %s, atteso challenge_unavailable", code)
	}
	if len(GameManager.challenges) != 0 {
		t.Error("le altre sfide di bob vanno chiuse")
	}

	// In partita non si sfida e non si è sfidati.
	if _, err := GameManager.CreateChallenge(alice, carol); err != ErrChallengerBusy {
		t.Errorf("err = %v, atteso ErrChallengerBusy", err)
	}
	if _, err := GameManager.CreateChallenge(carol, bob); err != ErrTargetBusy {
		t.Errorf("err = %v, atteso ErrTargetBusy", err)
	}
	if !GameManager.InMatch(alice.ID) || GameManager.InMatch(carol.ID) {
		t.Error("InMatch sbagliato")
	}
	if ids := GameManager.PlayingIDs(); len(ids) != 2 {
		t.Errorf("PlayingIDs = %v", ids)
	}
}

func TestChallenge_FriendlySnapshot(t *testing.T) {
	challengeSetup(t)
	ch := mustChallenge(t, alice, bob)
	ca, cb := newTestClient(alice.ID, alice.Username), newTestClient(bob.ID, bob.Username)
	GameManager.JoinChallenge(ca, ch.ID)
	GameManager.JoinChallenge(cb, ch.ID)

	room := ca.Room
	room.mu.Lock()
	snap := room.buildSnapshot()
	end := room.finishLocked(models.ResultDraw, "agreement", StatusDraw)
	room.mu.Unlock()
	if !snap.Friendly || !roomFromSnapshot(snap).Friendly {
		t.Error("l'amichevole sopravvive al riavvio")
	}
	if end == nil || end.rated {
		t.Error("un'amichevole non è classificata")
	}
}

func TestChallenge_CloseBetween(t *testing.T) {
	challengeSetup(t)
	ab := mustChallenge(t, alice, bob)
	mustChallenge(t, carol, alice) // carol → alice resta
	ca := newTestClient(alice.ID, alice.Username)
	GameManager.JoinChallenge(ca, ab.ID)

	GameManager.CloseChallengesBetween(bob.ID, alice.ID)
	if code := lastErrorCode(t, drain(ca)); code != string(gameerr.ChallengeUnavailable) {
		t.Errorf("code = %s, atteso challenge_unavailable", code)
	}
	if got := GameManager.IncomingChallenges(bob.ID); len(got) != 0 {
		t.Errorf("la sfida fra i due va chiusa: %+v", got)
	}
	if got := GameManager.IncomingChallenges(alice.ID); len(got) != 1 {
		t.Errorf("le sfide con altri restano: %+v", got)
	}
}
