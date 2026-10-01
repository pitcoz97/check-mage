package handlers

import (
	"bytes"
	"chess-server/internal/game"
	"chess-server/internal/logger"
	mw "chess-server/internal/middleware"
	"chess-server/internal/presence"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
)

func init() {
	_ = logger.Init("test") // le sfide registrano nel log
}

// callAs esegue un handler come l'utente userID.
func callAs(t *testing.T, h http.HandlerFunc, userID int, method, id string, body interface{}) (int, deckResp) {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(method, "/me/challenges", &buf)
	ctx := context.WithValue(req.Context(), mw.UserKey, jwt.MapClaims{"user_id": float64(userID)})
	if id != "" {
		rc := chi.NewRouteContext()
		rc.URLParams.Add("id", id)
		ctx = context.WithValue(ctx, chi.RouteCtxKey, rc)
	}
	rr := httptest.NewRecorder()
	h(rr, req.WithContext(ctx))
	var resp deckResp
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("risposta non valida: %v", err)
	}
	return rr.Code, resp
}

// challengeSetup: utenti in memoria (friendsSetup), manager nuovo, nessuno in
// partita tranne busy.
func challengeSetup(t *testing.T, busy ...int) {
	t.Helper()
	friendsSetup(t)
	game.GameManager = game.NewManager()
	prev := inMatch
	inMatch = func(id int) bool {
		for _, b := range busy {
			if b == id {
				return true
			}
		}
		return false
	}
	t.Cleanup(func() { inMatch = prev })
}

func incoming(t *testing.T, userID int) []game.ChallengeView {
	t.Helper()
	code, resp := callAs(t, Presence, userID, "POST", "", nil)
	if code != http.StatusOK {
		t.Fatalf("POST /me/presence = %d %s", code, resp.Error)
	}
	var out presenceView
	_ = json.Unmarshal(resp.Data, &out)
	return out.Incoming
}

func TestChallenges_Errors(t *testing.T) {
	challengeSetup(t, 9)
	presence.Default.Touch(6)
	presence.Default.Touch(9)

	cases := []struct {
		name   string
		body   interface{}
		status int
		msg    string
	}{
		{"corpo non valido", map[string]string{"to": "x"}, http.StatusBadRequest, msgInvalidBody},
		{"se stessi", challengeRequest{To: 5}, http.StatusBadRequest, msgChallengeSelf},
		{"inesistente", challengeRequest{To: 99}, http.StatusNotFound, msgChallengeNoPlayer},
		{"offline", challengeRequest{To: 7}, http.StatusConflict, msgChallengeOffline},
		{"in partita", challengeRequest{To: 9}, http.StatusConflict, msgChallengeTargetBusy},
	}
	for _, c := range cases {
		code, resp := callAs(t, CreateChallenge, 5, "POST", "", c.body)
		if code != c.status || resp.Error != c.msg {
			t.Errorf("%s: %d %q, atteso %d %q", c.name, code, resp.Error, c.status, c.msg)
		}
	}

	// Chi sfida è in partita.
	code, resp := callAs(t, CreateChallenge, 9, "POST", "", challengeRequest{To: 6})
	if code != http.StatusConflict || resp.Error != msgChallengeSelfBusy {
		t.Errorf("sfidante in partita: %d %q", code, resp.Error)
	}

	// Senza AllFriends nessuno è amico.
	AllFriends = false
	code, resp = callAs(t, CreateChallenge, 5, "POST", "", challengeRequest{To: 6})
	if code != http.StatusNotFound || resp.Error != msgChallengeNoPlayer {
		t.Errorf("non amico: %d %q", code, resp.Error)
	}
}

func TestChallenges_CreateReplaceDecline(t *testing.T) {
	challengeSetup(t)
	presence.Default.Touch(6)
	presence.Default.Touch(7)

	code, resp := callAs(t, CreateChallenge, 5, "POST", "", challengeRequest{To: 6})
	if code != http.StatusCreated {
		t.Fatalf("POST /me/challenges = %d %s", code, resp.Error)
	}
	var first game.ChallengeView
	_ = json.Unmarshal(resp.Data, &first)
	if first.ID == "" || first.From.ID != 5 || first.From.Username != "io" || first.To.ID != 6 || first.To.Elo != 1300 {
		t.Fatalf("sfida = %+v", first)
	}
	if first.ExpiresIn < 59 || first.ExpiresIn > 60 {
		t.Errorf("expires_in = %d", first.ExpiresIn)
	}
	if got := incoming(t, 6); len(got) != 1 || got[0].ID != first.ID {
		t.Fatalf("sfide ricevute da 6 = %+v", got)
	}
	if !presence.Default.Online(5) {
		t.Error("sfidare vale come segnale di presenza")
	}

	// Una nuova sfida di 5 sostituisce la precedente.
	code, resp = callAs(t, CreateChallenge, 5, "POST", "", challengeRequest{To: 7})
	if code != http.StatusCreated {
		t.Fatalf("seconda sfida = %d %s", code, resp.Error)
	}
	var second game.ChallengeView
	_ = json.Unmarshal(resp.Data, &second)
	if got := incoming(t, 6); len(got) != 0 {
		t.Errorf("la prima sfida va sostituita: %+v", got)
	}

	// Solo i due giocatori possono chiuderla; lo sfidato la rifiuta.
	if code, _ := callAs(t, DeleteChallenge, 8, "DELETE", second.ID, nil); code != http.StatusNotFound {
		t.Errorf("DELETE da estraneo = %d, atteso 404", code)
	}
	if code, _ := callAs(t, DeleteChallenge, 7, "DELETE", second.ID, nil); code != http.StatusOK {
		t.Errorf("DELETE dallo sfidato = %d", code)
	}
	if got := incoming(t, 7); len(got) != 0 {
		t.Errorf("la sfida rifiutata non va più mostrata: %+v", got)
	}
	if code, resp := callAs(t, DeleteChallenge, 5, "DELETE", second.ID, nil); code != http.StatusNotFound || resp.Error != msgChallengeNotFound {
		t.Errorf("DELETE di una sfida chiusa = %d %q", code, resp.Error)
	}
}
