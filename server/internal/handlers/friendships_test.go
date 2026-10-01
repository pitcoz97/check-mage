package handlers

import (
	"chess-server/internal/db"
	mw "chess-server/internal/middleware"
	"chess-server/internal/presence"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/golang-jwt/jwt/v5"
)

func TestPlanFriendRequest(t *testing.T) {
	pending := func(from, to int) *db.FriendLink {
		return &db.FriendLink{Requester: from, Addressee: to, Status: db.LinkPending}
	}
	accepted := &db.FriendLink{Requester: 2, Addressee: 1, Status: db.LinkAccepted}
	cases := []struct {
		name   string
		state  requestState
		plan   string
		status int
		msg    string
	}{
		{"nuova", requestState{Me: 1, To: 2, Exists: true}, planRequest, 0, ""},
		{"se stessi", requestState{Me: 1, To: 1, Exists: true}, "", http.StatusBadRequest, msgFriendSelf},
		{"inesistente", requestState{Me: 1, To: 2}, "", http.StatusNotFound, msgChallengeNoPlayer},
		{"bloccato", requestState{Me: 1, To: 2, Exists: true, Blocked: true}, "", http.StatusNotFound, msgChallengeNoPlayer},
		{"già amici", requestState{Me: 1, To: 2, Exists: true, Link: accepted}, "", http.StatusConflict, msgFriendAlready},
		{"già inviata", requestState{Me: 1, To: 2, Exists: true, Link: pending(1, 2)}, "", http.StatusConflict, msgFriendPending},
		{"incrociata", requestState{Me: 1, To: 2, Exists: true, Link: pending(2, 1), MyPendingOut: MaxPendingOut}, planAccept, 0, ""},
		{"miei amici al limite", requestState{Me: 1, To: 2, Exists: true, MyFriends: MaxFriendsPerUser}, "", http.StatusConflict, msgFriendLimit},
		{"suoi amici al limite", requestState{Me: 1, To: 2, Exists: true, Link: pending(2, 1), TheirFriends: MaxFriendsPerUser}, "", http.StatusConflict, msgFriendTheirLimit},
		{"troppe in sospeso", requestState{Me: 1, To: 2, Exists: true, MyPendingOut: MaxPendingOut}, "", http.StatusConflict, msgFriendPendingLimit},
	}
	for _, c := range cases {
		plan, status, msg := planFriendRequest(c.state)
		if plan != c.plan || status != c.status || msg != c.msg {
			t.Errorf("%s: %q %d %q, atteso %q %d %q", c.name, plan, status, msg, c.plan, c.status, c.msg)
		}
	}
}

// friendCall esegue un handler delle amicizie come userID, con other nel percorso (0 = nessuno).
func friendCall(t *testing.T, h http.HandlerFunc, userID, other int, method string, body interface{}) (int, deckResp) {
	t.Helper()
	id := ""
	if other > 0 {
		id = strconv.Itoa(other)
	}
	return callAs(t, h, userID, method, id, body)
}

// request manda la richiesta from → to e pretende 201.
func request(t *testing.T, from, to int) friendListView {
	t.Helper()
	code, resp := friendCall(t, RequestFriend, from, 0, "POST", challengeRequest{To: to})
	if code != http.StatusCreated {
		t.Fatalf("richiesta %d→%d = %d %q", from, to, code, resp.Error)
	}
	var list friendListView
	_ = json.Unmarshal(resp.Data, &list)
	return list
}

func expectError(t *testing.T, label string, code int, resp deckResp, status int, msg string) {
	t.Helper()
	if code != status || resp.Error != msg {
		t.Errorf("%s: %d %q, atteso %d %q", label, code, resp.Error, status, msg)
	}
}

func contains(list []friendView, id int) bool {
	for _, f := range list {
		if f.ID == id {
			return true
		}
	}
	return false
}

func TestFriendships_RequestAcceptRemove(t *testing.T) {
	friendsSetup(t)

	list := request(t, 5, 6)
	if got := ids(list.Outgoing); len(got) != 1 || got[0] != 6 {
		t.Fatalf("inviate = %v", got)
	}
	if contains(list.Others, 6) {
		t.Error("chi ha una richiesta non sta negli altri giocatori")
	}
	if got := ids(friendsOf(t, 6).Incoming); len(got) != 1 || got[0] != 5 {
		t.Fatalf("ricevute da 6 = %v", got)
	}
	code, resp := callAs(t, Presence, 6, "POST", "", nil)
	var pres presenceView
	_ = json.Unmarshal(resp.Data, &pres)
	if code != http.StatusOK || pres.FriendRequests != 1 {
		t.Errorf("presenza di 6: %d, richieste %d", code, pres.FriendRequests)
	}

	code, resp = friendCall(t, RequestFriend, 5, 0, "POST", challengeRequest{To: 6})
	expectError(t, "richiesta doppia", code, resp, http.StatusConflict, msgFriendPending)
	code, resp = friendCall(t, AcceptFriend, 5, 6, "POST", nil)
	expectError(t, "chi ha inviato non accetta", code, resp, http.StatusNotFound, msgFriendRequestAbsent)
	if code, resp = friendCall(t, AcceptFriend, 6, 5, "POST", nil); code != http.StatusOK {
		t.Fatalf("6 accetta = %d %q", code, resp.Error)
	}
	if got := ids(friends(t).Friends); len(got) != 1 || got[0] != 6 {
		t.Fatalf("amici di 5 = %v", got)
	}
	code, resp = friendCall(t, RequestFriend, 6, 0, "POST", challengeRequest{To: 5})
	expectError(t, "già amici", code, resp, http.StatusConflict, msgFriendAlready)
	code, resp = friendCall(t, RequestFriend, 5, 0, "POST", challengeRequest{To: 5})
	expectError(t, "se stessi", code, resp, http.StatusBadRequest, msgFriendSelf)

	// Richiesta incrociata: 7 aveva già chiesto a 5, la richiesta di 5 diventa amicizia.
	request(t, 7, 5)
	if got := ids(request(t, 5, 7).Friends); len(got) != 2 {
		t.Fatalf("la richiesta incrociata diventa amicizia: %v", got)
	}

	// Rimuovi, rifiuta, annulla.
	if code, resp = friendCall(t, RemoveFriend, 5, 6, "DELETE", nil); code != http.StatusOK {
		t.Fatalf("rimuovi 6 = %d %q", code, resp.Error)
	}
	code, resp = friendCall(t, RemoveFriend, 5, 6, "DELETE", nil)
	expectError(t, "rimuovere chi non è amico", code, resp, http.StatusNotFound, msgFriendAbsent)
	request(t, 8, 5)
	if code, resp = friendCall(t, DeleteFriendRequest, 5, 8, "DELETE", nil); code != http.StatusOK {
		t.Fatalf("5 rifiuta 8 = %d %q", code, resp.Error)
	}
	if len(friendsOf(t, 8).Outgoing) != 0 {
		t.Error("la richiesta rifiutata sparisce anche per chi l'ha inviata")
	}
	code, resp = friendCall(t, DeleteFriendRequest, 5, 8, "DELETE", nil)
	expectError(t, "rifiutare due volte", code, resp, http.StatusNotFound, msgFriendRequestAbsent)
	request(t, 5, 9)
	if code, resp = friendCall(t, DeleteFriendRequest, 5, 9, "DELETE", nil); code != http.StatusOK || len(friends(t).Outgoing) != 0 {
		t.Errorf("annullare la richiesta inviata: %d %q", code, resp.Error)
	}
}

func searchAs(t *testing.T, userID int, q string) (int, []searchResultView, string) {
	t.Helper()
	req := httptest.NewRequest("GET", "/users/search?q="+q, nil)
	req = req.WithContext(context.WithValue(req.Context(), mw.UserKey, jwt.MapClaims{"user_id": float64(userID)}))
	rr := httptest.NewRecorder()
	SearchUsers(rr, req)
	var resp deckResp
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	var out []searchResultView
	_ = json.Unmarshal(resp.Data, &out)
	return rr.Code, out, resp.Error
}

func TestFriendships_Search(t *testing.T) {
	friendsSetup(t)
	if code, _, msg := searchAs(t, 5, "a"); code != http.StatusBadRequest || msg != msgSearchShort {
		t.Errorf("ricerca corta: %d %q", code, msg)
	}
	request(t, 5, 8)
	// "ta" è in zeta e Beta, senza badare alle maiuscole; nessuno inizia con "ta": per nome.
	code, out, _ := searchAs(t, 5, "TA")
	if code != http.StatusOK || len(out) != 2 || out[0].Username != "Beta" || out[1].Username != "zeta" || out[0].Relation != relationNone {
		t.Fatalf("risultati = %d %+v", code, out)
	}
	if _, out, _ = searchAs(t, 5, "al"); len(out) != 1 || out[0].ID != 8 || out[0].Relation != relationOutgoing {
		t.Fatalf("relazione = %+v", out)
	}
	if _, out, _ = searchAs(t, 5, "io"); len(out) != 0 {
		t.Errorf("se stessi non si trovano: %+v", out)
	}
}

func TestFriendships_Block(t *testing.T) {
	challengeSetup(t)
	presence.Default.Touch(5)
	presence.Default.Touch(6)
	request(t, 5, 6)

	code, resp := callAs(t, BlockUser, 5, "POST", "", blockRequest{UserID: 6})
	if code != http.StatusOK {
		t.Fatalf("5 blocca 6 = %d %q", code, resp.Error)
	}
	var blocked []blockedView
	_ = json.Unmarshal(resp.Data, &blocked)
	if len(blocked) != 1 || blocked[0] != (blockedView{ID: 6, Username: "zeta"}) {
		t.Fatalf("bloccati = %+v", blocked)
	}
	mine, theirs := friendsOf(t, 5), friendsOf(t, 6)
	for _, list := range [][]friendView{mine.Friends, mine.Others, mine.Incoming, mine.Outgoing} {
		if contains(list, 6) {
			t.Error("5 vede ancora 6")
		}
	}
	for _, list := range [][]friendView{theirs.Friends, theirs.Others, theirs.Incoming, theirs.Outgoing} {
		if contains(list, 5) {
			t.Error("6 vede ancora chi l'ha bloccato")
		}
	}
	code, resp = friendCall(t, RequestFriend, 6, 0, "POST", challengeRequest{To: 5})
	expectError(t, "richiesta da un bloccato", code, resp, http.StatusNotFound, msgChallengeNoPlayer)
	code, resp = callAs(t, CreateChallenge, 6, "POST", "", challengeRequest{To: 5})
	expectError(t, "sfida da un bloccato", code, resp, http.StatusNotFound, msgChallengeNoPlayer)
	if _, out, _ := searchAs(t, 6, "io"); len(out) != 0 {
		t.Errorf("chi ti ha bloccato non si trova: %+v", out)
	}

	code, resp = callAs(t, BlockUser, 5, "POST", "", blockRequest{UserID: 5})
	expectError(t, "bloccare se stessi", code, resp, http.StatusBadRequest, msgBlockSelf)
	if code, resp = friendCall(t, UnblockUser, 5, 6, "DELETE", nil); code != http.StatusOK {
		t.Fatalf("sblocca 6 = %d %q", code, resp.Error)
	}
	code, resp = friendCall(t, UnblockUser, 5, 6, "DELETE", nil)
	expectError(t, "sbloccare due volte", code, resp, http.StatusNotFound, msgBlockAbsent)
	if !contains(friendsOf(t, 6).Others, 5) {
		t.Error("dopo lo sblocco 6 rivede 5")
	}
}

func TestFriendships_ChallengeOnlyFriendsWithoutAllFriends(t *testing.T) {
	challengeSetup(t)
	AllFriends = false
	presence.Default.Touch(6)
	code, resp := callAs(t, CreateChallenge, 5, "POST", "", challengeRequest{To: 6})
	expectError(t, "sfida a un non amico", code, resp, http.StatusNotFound, msgChallengeNoPlayer)

	_ = db.Friends().Request(5, 6)
	_, _ = db.Friends().Accept(5, 6)
	if code, resp = callAs(t, CreateChallenge, 5, "POST", "", challengeRequest{To: 6}); code != http.StatusCreated {
		t.Fatalf("sfida a un amico = %d %q", code, resp.Error)
	}
	if view := friends(t); len(view.Friends) != 1 || len(view.Others) != 0 {
		t.Errorf("senza AllFriends solo gli amici veri: %+v", view)
	}
}
