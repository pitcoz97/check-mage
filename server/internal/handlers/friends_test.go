package handlers

import (
	"chess-server/internal/db"
	"chess-server/internal/presence"
	"encoding/json"
	"net/http"
	"testing"
)

// friendsSetup prepara gli utenti in memoria (l'utente 5 è chi chiama) e chi è
// in partita; presenza, amicizie e blocchi azzerati.
func friendsSetup(t *testing.T, playing ...int) {
	t.Helper()
	db.SetMemUsers([]db.UserSummary{
		{ID: 5, Username: "io", Elo: 1200},
		{ID: 6, Username: "zeta", Elo: 1300},
		{ID: 7, Username: "Beta", Elo: 1100},
		{ID: 8, Username: "alfa", Elo: 1250},
		{ID: 9, Username: "gamma", Elo: 1000},
	})
	db.ResetMemFriends()
	presence.Default.Reset()
	prev := playingIDs
	playingIDs = func() []int { return playing }
	t.Cleanup(func() {
		playingIDs = prev
		presence.Default.Reset()
		db.ResetMemFriends()
		AllFriends = true
	})
}

func friendsOf(t *testing.T, userID int) friendListView {
	t.Helper()
	code, resp := callAs(t, ListFriends, userID, "GET", "", nil)
	if code != http.StatusOK {
		t.Fatalf("GET /me/friends = %d %s", code, resp.Error)
	}
	var out friendListView
	_ = json.Unmarshal(resp.Data, &out)
	return out
}

func friends(t *testing.T) friendListView {
	t.Helper()
	return friendsOf(t, 5)
}

func ids(list []friendView) []int {
	out := []int{}
	for _, f := range list {
		out = append(out, f.ID)
	}
	return out
}

func TestFriends_OrderAndStatus(t *testing.T) {
	friendsSetup(t, 9)
	presence.Default.Touch(6)
	presence.Default.Touch(9) // in partita vale più di online
	presence.Default.Touch(5) // se stessi non compaiono

	got := friends(t)
	want := []friendView{
		{ID: 6, Username: "zeta", Elo: 1300, Status: StatusOnline},
		{ID: 9, Username: "gamma", Elo: 1000, Status: StatusPlaying},
		{ID: 8, Username: "alfa", Elo: 1250, Status: StatusOffline},
		{ID: 7, Username: "Beta", Elo: 1100, Status: StatusOffline},
	}
	if len(got.Friends) != 0 || len(got.Others) != len(want) {
		t.Fatalf("senza amicizie tutti in others: %+v", got)
	}
	for i := range want {
		if got.Others[i] != want[i] {
			t.Errorf("altro %d = %+v, atteso %+v", i, got.Others[i], want[i])
		}
	}
	if got.Online != 1 || got.MaxFriends != MaxFriendsPerUser {
		t.Errorf("online = %d, max = %d", got.Online, got.MaxFriends)
	}
}

func TestFriends_Disabled(t *testing.T) {
	friendsSetup(t)
	AllFriends = false
	got := friends(t)
	if len(got.Friends) != 0 || len(got.Others) != 0 || got.Online != 0 {
		t.Fatalf("senza AllFriends e senza amicizie la lista è vuota: %+v", got)
	}
}
